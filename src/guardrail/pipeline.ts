/**
 * Guardrail Pipeline — Orchestrator
 *
 * Assembles the four built-in stages, runs them in sequence, aggregates
 * their verdicts into a single GuardrailResult, and appends the terminal
 * `guardrail-evaluated` audit record.
 *
 * Stage execution rules:
 *
 *   ┌─────────────┬────────────────────────────────────────────────────┐
 *   │ Verdict     │ Pipeline behaviour                                 │
 *   ├─────────────┼────────────────────────────────────────────────────┤
 *   │ pass        │ Continue to next stage                             │
 *   │ flag        │ Accumulate flag annotation; continue               │
 *   │ deny        │ HALT — build deny result immediately               │
 *   │ require-approval │ HALT — build require-approval result          │
 *   └─────────────┴────────────────────────────────────────────────────┘
 *
 * Final decision when all stages pass:
 *   - Flags present → "flag" decision (execution proceeds, annotated)
 *   - No flags     → "allow" decision
 *
 * The pipeline is a class to allow stage injection for testing and
 * extension (e.g. a rate-limit stage backed by Redis):
 *
 *   const pipeline = new GuardrailPipeline({
 *     stages: [...DEFAULT_STAGES, myRateLimitStage],
 *   });
 *
 * Usage:
 *
 *   const pipeline = new GuardrailPipeline();
 *   const result   = await pipeline.evaluate({
 *     request,
 *     frame,
 *     capability,
 *     policies,        // pre-sorted ascending by priority
 *     now,             // optional, defaults to Date.now()
 *   });
 *
 *   if (result.decision === "allow") { ... }
 */

import { createGuardrailEvaluatedRecord } from "./audit.js";
import { runAuthorizationStage } from "./stages/authorization.js";
import { runPolicyStage } from "./stages/policy.js";
import { runConstraintsStage } from "./stages/constraints.js";
import { runApprovalStage } from "./stages/approval.js";
import type {
  Capability,
  ExecutionRequest,
  GuardrailPolicy,
} from "../types.js";
import type { DecisionFrame } from "../projection/schema.js";
import type {
  GuardrailContext,
  GuardrailDecision,
  GuardrailFlag,
  GuardrailPipelineOptions,
  GuardrailResult,
  GuardrailStageFn,
  StageResult,
  VerdictDeny,
  VerdictFlag,
  VerdictRequireApproval,
} from "./types.js";

// ---------------------------------------------------------------------------
// Default stage list
// ---------------------------------------------------------------------------

/**
 * The canonical stage sequence for a GuardrailPipeline.
 * Callers may extend or replace this list via GuardrailPipelineOptions.stages.
 */
export const DEFAULT_STAGES: GuardrailStageFn[] = [
  runAuthorizationStage,
  runPolicyStage,
  runConstraintsStage,
  runApprovalStage,
];

// ---------------------------------------------------------------------------
// Pipeline input type
// ---------------------------------------------------------------------------

export interface GuardrailEvaluateInput {
  request: ExecutionRequest;
  frame: DecisionFrame;
  capability: Capability;
  /**
   * The active GuardrailPolicies to evaluate.
   * Must be sorted ascending by priority (lower number = higher priority).
   * Disabled policies will be skipped by Stage 2 even if present here.
   */
  policies: GuardrailPolicy[];
  /**
   * Reference clock for expiry checks. Defaults to `new Date()`.
   * Inject a fixed value in tests for deterministic assertions.
   */
  now?: Date;
}

// ---------------------------------------------------------------------------
// Pipeline class
// ---------------------------------------------------------------------------

/**
 * GuardrailPipeline orchestrates the four built-in guardrail stages and
 * produces a single, fully-audited GuardrailResult.
 *
 * Thread safety: each `evaluate()` call is fully isolated — the instance
 * holds no mutable state between evaluations.
 */
export class GuardrailPipeline {
  private readonly stages: GuardrailStageFn[];

  constructor(options: GuardrailPipelineOptions = {}) {
    this.stages = options.stages ?? DEFAULT_STAGES;
  }

  /**
   * Evaluate a single ExecutionRequest against the pipeline.
   *
   * Always resolves (never rejects). Any unexpected error in a stage
   * is caught and converted into a deny result with the error details
   * in the audit record.
   */
  async evaluate(input: GuardrailEvaluateInput): Promise<GuardrailResult> {
    const evaluatedAt = new Date().toISOString();
    const pipelineStart = Date.now();

    const ctx: GuardrailContext = {
      request: input.request,
      frame: input.frame,
      capability: input.capability,
      policies: input.policies,
      now: input.now ?? new Date(),
    };

    const stageResults: StageResult[] = [];
    const accumulatedFlags: GuardrailFlag[] = [];

    // ------------------------------------------------------------------
    // Run stages
    // ------------------------------------------------------------------
    for (const stageFn of this.stages) {
      let stageResult: StageResult;

      try {
        stageResult = await stageFn(ctx);
      } catch (err) {
        // Unexpected stage error — treat as a deny to preserve fail-closed semantics.
        stageResult = buildErrorStageResult(stageFn, err);
      }

      stageResults.push(stageResult);

      const { verdict } = stageResult;

      if (verdict.outcome === "flag") {
        // Non-halting: accumulate and continue.
        accumulatedFlags.push(extractFlag(stageResult.stage, verdict));
        continue;
      }

      if (verdict.outcome === "pass") {
        // Continue to next stage.
        continue;
      }

      if (verdict.outcome === "deny") {
        // Halting: build deny result immediately.
        return this.buildResult(
          ctx,
          stageResults,
          accumulatedFlags,
          evaluatedAt,
          pipelineStart,
          { type: "deny", verdict }
        );
      }

      if (verdict.outcome === "require-approval") {
        // Halting: build require-approval result.
        return this.buildResult(
          ctx,
          stageResults,
          accumulatedFlags,
          evaluatedAt,
          pipelineStart,
          { type: "require-approval", verdict }
        );
      }
    }

    // ------------------------------------------------------------------
    // All stages completed — determine final decision
    // ------------------------------------------------------------------
    const decision: GuardrailDecision =
      accumulatedFlags.length > 0 ? "flag" : "allow";

    return this.buildResult(
      ctx,
      stageResults,
      accumulatedFlags,
      evaluatedAt,
      pipelineStart,
      { type: decision }
    );
  }

  // ---------------------------------------------------------------------------
  // Result assembly
  // ---------------------------------------------------------------------------

  private buildResult(
    ctx: GuardrailContext,
    stageResults: StageResult[],
    flags: GuardrailFlag[],
    evaluatedAt: string,
    pipelineStart: number,
    outcome:
      | { type: "allow" | "flag" }
      | { type: "deny"; verdict: VerdictDeny }
      | { type: "require-approval"; verdict: VerdictRequireApproval }
  ): GuardrailResult {
    const totalDurationMs = Date.now() - pipelineStart;

    // Flatten all stage audit records into a single array.
    const stageAuditRecords = stageResults.flatMap((s) => s.auditRecords);

    // Build the partial result (without the terminal audit record).
    const partial: Omit<GuardrailResult, "auditRecords"> & {
      auditRecords: GuardrailResult["auditRecords"];
    } = buildPartialResult(
      ctx,
      stageResults,
      flags,
      evaluatedAt,
      totalDurationMs,
      outcome
    );

    // Append the terminal `guardrail-evaluated` record.
    const terminalRecord = createGuardrailEvaluatedRecord(
      ctx.request,
      ctx.frame,
      partial
    );

    return {
      ...partial,
      auditRecords: [...stageAuditRecords, terminalRecord],
    };
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildPartialResult(
  ctx: GuardrailContext,
  stageResults: StageResult[],
  flags: GuardrailFlag[],
  evaluatedAt: string,
  totalDurationMs: number,
  outcome:
    | { type: "allow" | "flag" }
    | { type: "deny"; verdict: VerdictDeny }
    | { type: "require-approval"; verdict: VerdictRequireApproval }
): GuardrailResult {
  const base = {
    executionRequestId: ctx.request.id,
    stageResults,
    auditRecords: [] as GuardrailResult["auditRecords"], // filled by caller
    flags,
    evaluatedAt,
    totalDurationMs,
  };

  switch (outcome.type) {
    case "allow":
      return { ...base, decision: "allow" };

    case "flag":
      return { ...base, decision: "flag" };

    case "deny":
      return {
        ...base,
        decision: "deny",
        denyCode: outcome.verdict.code,
        denyReason: outcome.verdict.reason,
      };

    case "require-approval":
      return {
        ...base,
        decision: "require-approval",
        approvalRequirementIds: outcome.verdict.requirementIds,
      };
  }
}

function extractFlag(stage: StageResult["stage"], verdict: VerdictFlag): GuardrailFlag {
  return {
    stage,
    reason: verdict.reason,
    ...(verdict.policyId !== undefined ? { policyId: verdict.policyId } : {}),
  };
}

/**
 * Convert an unexpected stage exception into a deny StageResult.
 * Preserves fail-closed semantics even when a stage throws.
 */
function buildErrorStageResult(
  stageFn: GuardrailStageFn,
  err: unknown
): StageResult {
  const errorMessage =
    err instanceof Error ? err.message : String(err);
  const stageName =
    (stageFn as { stageName?: string }).stageName ?? "unknown";

  return {
    stage: "authorization", // safe fallback stage name
    verdict: {
      outcome: "deny",
      code: "POLICY_DENY",
      reason: `Internal error in stage "${stageName}": ${errorMessage}`,
    },
    auditRecords: [],
    durationMs: 0,
  };
}
