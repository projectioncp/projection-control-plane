/**
 * Guardrail Stage 2 — Policy Evaluation
 *
 * Evaluates the policy library (GuardrailPolicy[]) against the
 * ExecutionRequest in priority order (ascending — lower number = higher
 * priority). This is the primary governance gate.
 *
 * Matching semantics — a policy applies to a request when ALL of:
 *   1. Scope filter passes   — request.capabilityId ∈ policy.scopedCapabilityIds
 *                              (or scopedCapabilityIds is unset → applies to all)
 *   2. Conditions match      — all policy.conditions evaluate to true
 *                              (empty conditions array → matches every request)
 *   3. Confidence check      — if policy.confidenceThreshold is set,
 *                              request.confidence < threshold triggers the policy
 *                              (i.e. the policy enforces a minimum confidence floor)
 *
 * Evaluation order and halting:
 *   - Policies are evaluated in ascending priority order.
 *   - "flag" and "rate-limit" actions are non-halting: they accumulate flag
 *     annotations and evaluation continues to the next policy.
 *   - "allow", "deny", and "require-approval" are halting: the first
 *     matching policy with one of these actions ends policy evaluation.
 *   - If no policy produces a halting verdict, the pipeline either:
 *       • passes with accumulated flags (if any flag policies matched), or
 *       • denies with NO_MATCHING_POLICY (if nothing at all matched).
 *     This makes the system fail-closed: an explicit allow or flag is required.
 *
 * Note on "rate-limit":
 *   Rate limiting requires external mutable state (counters, time windows).
 *   The built-in implementation treats it as "flag" and adds a note in the
 *   audit record. Callers that need true rate limiting should inject a custom
 *   stage via GuardrailPipelineOptions.stages.
 */

import type { AuditRecord, GuardrailPolicy } from "../../types.js";
import {
  createPolicyViolationRecord,
  createApprovalRequestedRecord,
} from "../audit.js";
import { evaluateConditions } from "../condition.js";
import type {
  GuardrailContext,
  GuardrailDenyCode,
  GuardrailFlag,
  StageResult,
  VerdictDeny,
  VerdictFlag,
  VerdictRequireApproval,
} from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function elapsed(start: number): number {
  return Date.now() - start;
}

// ---------------------------------------------------------------------------
// Policy activation check
// ---------------------------------------------------------------------------

/**
 * Determines whether a policy applies to the current request.
 *
 * Returns:
 *  - `{ applies: false }` — policy does not match this request
 *  - `{ applies: true, reason: "conditions" }` — matched by conditions
 *  - `{ applies: true, reason: "confidence" }` — matched because confidence < threshold
 */
function policyApplies(
  policy: GuardrailPolicy,
  ctx: GuardrailContext
): { applies: false } | { applies: true; reason: string; isConfidenceViolation: boolean } {
  const { request } = ctx;

  // Scope filter
  if (
    policy.scopedCapabilityIds !== undefined &&
    !policy.scopedCapabilityIds.includes(request.capabilityId)
  ) {
    return { applies: false };
  }

  // Conditions (AND semantics; empty = match-all)
  if (!evaluateConditions(policy.conditions, request)) {
    return { applies: false };
  }

  // Confidence threshold — if set, the policy only fires when confidence is below it.
  if (policy.confidenceThreshold !== undefined) {
    if (request.confidence < policy.confidenceThreshold) {
      return {
        applies: true,
        isConfidenceViolation: true,
        reason:
          policy.actionReason ??
          `Confidence ${request.confidence.toFixed(3)} is below the required ` +
            `threshold of ${policy.confidenceThreshold} set by policy "${policy.name}"`,
      };
    }
    // Conditions matched but confidence is sufficient — policy does NOT fire.
    // The threshold is a filter that limits the policy to low-confidence requests.
    return { applies: false };
  }

  // Conditions matched, no threshold — policy fires for the condition match.
  return {
    applies: true,
    isConfidenceViolation: false,
    reason: policy.actionReason ?? `Policy "${policy.name}" (priority ${policy.priority}) matched`,
  };
}

// ---------------------------------------------------------------------------
// Stage implementation
// ---------------------------------------------------------------------------

export function runPolicyStage(ctx: GuardrailContext): StageResult {
  const start = Date.now();
  const { request, frame, policies } = ctx;

  const auditRecords: AuditRecord[] = [];
  const accumulatedFlags: GuardrailFlag[] = [];

  // Policies are pre-sorted ascending by priority by the pipeline.
  const enabledPolicies = policies.filter((p) => p.enabled);

  for (const policy of enabledPolicies) {
    const match = policyApplies(policy, ctx);
    if (!match.applies) continue;

    const { reason, isConfidenceViolation } = match;
    const denyCode: GuardrailDenyCode = isConfidenceViolation
      ? "CONFIDENCE_BELOW_THRESHOLD"
      : "POLICY_DENY";

    // ----------------------------------------------------------------
    // Apply the policy action
    // ----------------------------------------------------------------

    switch (policy.action) {
      case "allow": {
        // Explicit allow — stop evaluation, request passes this stage.
        return {
          stage: "policy",
          verdict: { outcome: "pass" },
          auditRecords,
          durationMs: elapsed(start),
        };
      }

      case "deny": {
        const record = createPolicyViolationRecord(
          request,
          frame,
          policy,
          reason,
          "denied"
        );
        auditRecords.push(record);

        const verdict: VerdictDeny = {
          outcome: "deny",
          code: denyCode,
          reason,
          policyId: policy.id,
        };
        return { stage: "policy", verdict, auditRecords, durationMs: elapsed(start) };
      }

      case "require-approval": {
        const requirementIds = frame.approvalRequirements.map(
          (r) => r.requirementId
        );
        const approvalRecord = createApprovalRequestedRecord(
          request,
          frame,
          requirementIds,
          reason,
          policy.id
        );
        const violationRecord = createPolicyViolationRecord(
          request,
          frame,
          policy,
          reason,
          "pending"
        );
        auditRecords.push(violationRecord, approvalRecord);

        const verdict: VerdictRequireApproval = {
          outcome: "require-approval",
          requirementIds,
          reason,
          policyId: policy.id,
        };
        return { stage: "policy", verdict, auditRecords, durationMs: elapsed(start) };
      }

      case "rate-limit":
      // falls through to "flag" — rate limiting needs external state
      // eslint-disable-next-line no-fallthrough
      case "flag": {
        const flagReason =
          policy.action === "rate-limit"
            ? `${reason} (rate-limit stub: external state adapter required)`
            : reason;

        const record = createPolicyViolationRecord(
          request,
          frame,
          policy,
          flagReason,
          "success"
        );
        auditRecords.push(record);

        accumulatedFlags.push({
          stage: "policy",
          reason: flagReason,
          policyId: policy.id,
        });

        // Non-halting: continue to next policy.
        continue;
      }
    }
  }

  // ----------------------------------------------------------------
  // End of policy list — aggregate non-halting outcomes
  // ----------------------------------------------------------------

  if (accumulatedFlags.length === 0) {
    // Nothing matched at all — fail closed.
    return {
      stage: "policy",
      verdict: {
        outcome: "deny",
        code: "NO_MATCHING_POLICY",
        reason:
          "No enabled Guardrail policy matched this request. " +
          "The system requires an explicit allow or flag policy. Failing closed.",
      },
      auditRecords,
      durationMs: elapsed(start),
    };
  }

  // Only flag policies matched — allow with flag annotations.
  // The pipeline will collect the flags from individual stage results.
  const flagVerdict: VerdictFlag = {
    outcome: "flag",
    reason: accumulatedFlags.map((f) => f.reason).join("; "),
  };

  return { stage: "policy", verdict: flagVerdict, auditRecords, durationMs: elapsed(start) };
}
