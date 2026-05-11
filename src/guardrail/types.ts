/**
 * Guardrail Pipeline — Core Types
 *
 * Every object flowing through the Guardrail pipeline is typed here.
 * These types are internal to the guardrail layer; the public API
 * re-exports only what callers need (see index.ts).
 */

import type {
  AuditRecord,
  Capability,
  ExecutionRequest,
  GuardrailPolicy,
} from "../types.js";
import type { DecisionFrame } from "../projection/schema.js";

// ---------------------------------------------------------------------------
// Deny codes — machine-readable reasons for rejection
// ---------------------------------------------------------------------------

/**
 * Enumerated codes for every reason the pipeline can deny a request.
 * Used for programmatic handling, metrics, and structured logging.
 */
export type GuardrailDenyCode =
  | "FRAME_EXPIRED"             // Decision Frame has passed its expiresAt
  | "PRINCIPAL_MISMATCH"        // request.principalId ≠ frame.principalId
  | "CAPABILITY_NOT_IN_FRAME"   // capability not in frame.authorizedCapabilityIds
  | "CAPABILITY_NOT_IN_BOUNDARY"// capability not in frame.executionBoundaries.allowedCapabilityIds
  | "ENTITLEMENT_MISSING"       // principal lacks a required capability entitlement
  | "POLICY_DENY"               // a GuardrailPolicy explicitly denied the request
  | "CONFIDENCE_BELOW_THRESHOLD"// request.confidence < policy.confidenceThreshold
  | "FRAME_CONSTRAINT_VIOLATION"// a frame-level PolicyConstraint was violated
  | "NO_MATCHING_POLICY";       // no policy matched — system fails closed

// ---------------------------------------------------------------------------
// Stage names
// ---------------------------------------------------------------------------

export type StageName =
  | "authorization" // principal, entitlements, frame binding, expiry
  | "policy"        // policy library evaluation (priority-ordered, first match wins)
  | "constraints"   // frame-level policyConstraints (Projection layer rules)
  | "approval";     // approval routing (capability + frame requirements)

// ---------------------------------------------------------------------------
// Stage verdict — what a single stage decides
// ---------------------------------------------------------------------------

/** The stage passed with no issues. */
export interface VerdictPass {
  outcome: "pass";
}

/** The stage is denying the request outright. Halts the pipeline. */
export interface VerdictDeny {
  outcome: "deny";
  code: GuardrailDenyCode;
  reason: string;
  /** The policy that triggered this denial, if any. */
  policyId?: string;
  /** The constraint that was violated, if any. */
  constraintId?: string;
}

/**
 * The stage requires human (or system) approval before execution.
 * Halts the pipeline. The caller is responsible for routing to the
 * appropriate approval workflow.
 */
export interface VerdictRequireApproval {
  outcome: "require-approval";
  /** IDs of frame.approvalRequirements that must be cleared. */
  requirementIds: string[];
  reason: string;
  policyId?: string;
}

/**
 * The stage is flagging the request for review but not blocking it.
 * Does NOT halt the pipeline — evaluation continues to the next stage.
 */
export interface VerdictFlag {
  outcome: "flag";
  reason: string;
  policyId?: string;
}

export type StageVerdict =
  | VerdictPass
  | VerdictDeny
  | VerdictRequireApproval
  | VerdictFlag;

// ---------------------------------------------------------------------------
// Stage result — full output of one pipeline stage
// ---------------------------------------------------------------------------

export interface StageResult {
  stage: StageName;
  verdict: StageVerdict;
  /** Audit records emitted by this stage. Included in GuardrailResult.auditRecords. */
  auditRecords: AuditRecord[];
  /** Wall-clock duration of this stage in milliseconds. */
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Pipeline context — shared input for all stages
// ---------------------------------------------------------------------------

/**
 * Everything a pipeline stage needs to make its decision.
 * Constructed once and passed read-only to every stage.
 */
export interface GuardrailContext {
  request: ExecutionRequest;
  frame: DecisionFrame;
  capability: Capability;
  /**
   * Enabled GuardrailPolicies sorted ascending by priority.
   * Lower priority number = evaluated first.
   * Callers must pre-sort; the pipeline does not re-sort.
   */
  policies: GuardrailPolicy[];
  /** Reference clock for expiry checks. Defaults to Date.now() in the pipeline. */
  now: Date;
}

// ---------------------------------------------------------------------------
// Pipeline result — final output
// ---------------------------------------------------------------------------

export type GuardrailDecision =
  | "allow"            // all stages passed, request may proceed
  | "deny"             // one or more stages denied the request
  | "require-approval" // request is gated on human or system approval
  | "flag";            // request may proceed but is flagged for review

/** An accumulated flag annotation from any pipeline stage. */
export interface GuardrailFlag {
  stage: StageName;
  reason: string;
  policyId?: string;
}

/**
 * The final output of a complete GuardrailPipeline evaluation.
 *
 * Includes the top-level decision, per-stage results, every AuditRecord
 * emitted during the run (including the terminal `guardrail-evaluated`
 * record), and any structured detail needed to act on the decision.
 */
export interface GuardrailResult {
  decision: GuardrailDecision;
  executionRequestId: string;

  /** Results from each stage that ran (may be fewer than 4 if pipeline halted early). */
  stageResults: StageResult[];
  /**
   * All AuditRecords emitted across all stages, plus the terminal
   * `guardrail-evaluated` record appended by the pipeline after aggregation.
   */
  auditRecords: AuditRecord[];

  // -- Per-decision detail --

  /** Present when decision === "deny". */
  denyCode?: GuardrailDenyCode;
  /** Present when decision === "deny". Human-readable explanation. */
  denyReason?: string;

  /** Present when decision === "require-approval". */
  approvalRequirementIds?: string[];

  /** Accumulated flag annotations. Non-empty when decision === "flag" or alongside "allow". */
  flags: GuardrailFlag[];

  // -- Timing --
  evaluatedAt: string; // ISO-8601 timestamp
  totalDurationMs: number;
}

// ---------------------------------------------------------------------------
// Stage function type — for injectable/custom stages
// ---------------------------------------------------------------------------

/**
 * A Guardrail pipeline stage.
 * Receives the shared context and returns a StageResult.
 * May be async to support stages that need I/O (e.g. rate-limit state lookups).
 */
export type GuardrailStageFn = (
  ctx: GuardrailContext
) => StageResult | Promise<StageResult>;

// ---------------------------------------------------------------------------
// Pipeline options
// ---------------------------------------------------------------------------

export interface GuardrailPipelineOptions {
  /**
   * Override the default stage functions.
   * Useful for testing (inject stubs) or extending (add a rate-limit stage).
   * Must be ordered: authorization → policy → constraints → approval.
   */
  stages?: GuardrailStageFn[];
}
