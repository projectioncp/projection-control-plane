/**
 * Audit Layer — Core Type Definitions
 *
 * The audit system is the tamper-evident ledger of everything the Projection
 * Control Plane did, decided, or blocked. Every governance event — frame
 * construction, guardrail decisions, policy evaluations, approvals, capability
 * executions, hook invocations, and rollbacks — produces a strongly-typed
 * AuditRecord. Records are linked into AuditTrails and synthesized into
 * ExecutionTraces for end-to-end operational traceability.
 *
 * Architecture position:
 *
 *   ┌──────────────────────────────────────────────────────────────────────┐
 *   │  Runtime Lifecycle                         Audit Layer               │
 *   │                                                                      │
 *   │  Projection  ──frame-created──────────────► AuditRecord             │
 *   │      │                                           │                   │
 *   │  Guardrail   ──guardrail-evaluated────────► AuditRecord             │
 *   │      │        ──policy-evaluated─────────► AuditRecord             │
 *   │      │        ──entitlement-denied────────► AuditRecord             │
 *   │      │        ──policy-violation──────────► AuditRecord             │
 *   │      │                                           │                   │
 *   │  Approval    ──approval-requested─────────► AuditRecord             │
 *   │      │        ──approval-granted──────────► AuditRecord             │
 *   │      │        ──approval-denied───────────► AuditRecord             │
 *   │      │                                           │                   │
 *   │  Capability  ──capability-executed────────► AuditRecord             │
 *   │      │        ──execution-failed──────────► AuditRecord             │
 *   │      │        ──execution-timed-out────────► AuditRecord             │
 *   │      │        ──rollback-initiated─────────► AuditRecord             │
 *   │      │        ──rollback-completed─────────► AuditRecord             │
 *   │      │                                           │                   │
 *   │  Hooks       ──hook-triggered──────────────► AuditRecord             │
 *   │      │                                           │                   │
 *   │  Frame       ──frame-expired───────────────► AuditRecord             │
 *   │                                                  │                   │
 *   │                                      AuditTrail (scoped collection)  │
 *   │                                      ExecutionTrace (end-to-end)     │
 *   └──────────────────────────────────────────────────────────────────────┘
 *
 * Design invariants:
 *   1. IMMUTABILITY      — AuditRecords must never be mutated after creation.
 *                          The `checksum` field enables post-hoc integrity checks.
 *   2. HASH CHAIN        — `previousChecksum` links each record to its predecessor,
 *                          forming an append-only chain. Tampering with any record
 *                          breaks all downstream checksums.
 *   3. TYPED EVENTS      — `AuditEvent` is a discriminated union, not a generic
 *                          `details: Metadata` bag. Every event type carries
 *                          exactly the fields it needs — no more, no less.
 *   4. COMPLETE TRACE    — `ExecutionTrace` synthesizes all phases of a single
 *                          execution lifecycle (projection → guardrail → approval
 *                          → capability → rollback) with structured per-phase data.
 *   5. NO SIDE EFFECTS   — The audit layer only reads and records. It never
 *                          drives decisions or mutates runtime objects.
 *
 * Related modules:
 *   schema.ts  — Zod validation for all serializable audit types
 *   index.ts   — Public barrel + createAuditRecord() factory helper
 *
 * Deprecation notice:
 *   The draft `AuditRecord` in `src/types.ts` is superseded by this module.
 *   Migrate all audit-record construction to the types exported here.
 */

import type {
  CapabilityId,
  ConfidenceScore,
  FrameId,
  ISOTimestamp,
  Metadata,
  PrincipalId,
  FrameTriggerSource,
} from "../projection/frame.js";
import type { IntentCategory } from "../projection/frame.js";
import type {
  GuardrailDecision,
  GuardrailDenyCode,
  GuardrailFlag,
  StageName,
} from "../guardrail/types.js";
import type {
  PolicyDenyCode,
  PolicyViolationKind,
  PolicyViolationSeverity,
} from "../guardrail/policy/types.js";
import type { HookError, HookId, HookOutcome, HookStage } from "../hooks/types.js";
import type { CapabilityExecutionStatus } from "../capabilities/execution.js";

// ---------------------------------------------------------------------------
// Primitive type aliases
// ---------------------------------------------------------------------------

/** Stable identifier for an AuditRecord. UUID v4 recommended. */
export type AuditRecordId = string;

/**
 * Stable trace identifier linking all AuditRecords in a single execution chain.
 *
 * A trace spans the full lifecycle: frame construction → guardrail evaluation
 * → (optional) approval → capability execution → (optional) rollback.
 * All records produced during that lifecycle share the same traceId.
 */
export type TraceId = string;

/**
 * Span identifier for a single AuditRecord within a trace.
 *
 * Follows the OpenTelemetry span model: each record is a span, and
 * `parentSpanId` links it to the span that caused it.
 */
export type SpanId = string;

// ---------------------------------------------------------------------------
// AuditEventType and AuditOutcome
// ---------------------------------------------------------------------------

/**
 * Discriminant values for the AuditEvent union.
 *
 * Each value corresponds to exactly one event variant interface below.
 * Sorted chronologically by typical occurrence order in a full execution.
 */
export type AuditEventType =
  // Frame lifecycle
  | "frame-created"          // Decision Frame constructed by the Projection layer
  | "frame-expired"          // Decision Frame TTL elapsed or was invalidated

  // Execution request
  | "execution-requested"    // AI submitted an ExecutionRequest

  // Guardrail pipeline
  | "guardrail-evaluated"    // Guardrail pipeline produced a terminal decision
  | "policy-evaluated"       // Policy engine evaluation run completed

  // Authorization
  | "entitlement-denied"     // Principal lacked a required capability entitlement
  | "policy-violation"       // A policy rule breach was recorded

  // Approval workflow
  | "approval-requested"     // An approval gate was opened
  | "approval-granted"       // Approval was explicitly granted
  | "approval-denied"        // Approval was denied (explicit, timeout, or escalation)

  // Capability execution
  | "capability-executed"    // Capability handler completed (success, partial, or retrying)
  | "execution-failed"       // Capability invocation failed with a terminal error
  | "execution-timed-out"    // Hard timeout elapsed before the handler completed

  // Rollback
  | "rollback-initiated"     // Rollback was triggered for a prior execution
  | "rollback-completed"     // Rollback handler completed

  // Hook lifecycle
  | "hook-triggered";        // A hook handler ran at a lifecycle stage

/**
 * High-level outcome classification for an AuditRecord.
 *
 * Provides a consistent, query-friendly axis across all event types.
 * The full detail of what happened lives in the typed `event` field.
 */
export type AuditOutcome =
  | "success"      // operation completed as intended
  | "failure"      // operation failed due to an error condition
  | "denied"       // governance decision: request was rejected
  | "approved"     // governance decision: request was permitted
  | "flagged"      // governance annotation: request allowed but flagged for review
  | "pending"      // operation is in progress or awaiting external resolution
  | "timed-out"    // operation or approval exceeded its deadline
  | "rolled-back"; // execution was undone by the rollback mechanism

// ---------------------------------------------------------------------------
// AuditActor
// ---------------------------------------------------------------------------

/**
 * The principal and session context associated with an AuditRecord.
 *
 * Embedded directly in every AuditRecord so that the full actor context
 * is available without cross-referencing the originating Decision Frame.
 * Values are snapshotted at event time — subsequent revocations do not
 * retroactively alter audit records.
 */
export interface AuditActor {
  /** The identity (user, service account, agent) on whose behalf this occurred. */
  principalId: PrincipalId;
  /** The session this event belongs to. */
  sessionId: string;
  /** Workflow this event is part of, if any. */
  workflowId?: string;
  /**
   * Stable correlation ID linking a chain of related events across frames
   * and workflow steps. Propagated from the originating Decision Frame.
   */
  correlationId?: string;
}

// ---------------------------------------------------------------------------
// AuditEvent — individual variant interfaces
//
// Each interface represents the payload of a single event type.
// All share a `type` discriminant matching a value in AuditEventType.
// Event payloads carry ONLY the fields specific to that event — common
// context (actor, trace IDs, timestamp) lives on the parent AuditRecord.
// ---------------------------------------------------------------------------

// -- Frame lifecycle --------------------------------------------------------

/**
 * Emitted when the Projection layer successfully constructs a Decision Frame.
 *
 * Captures the full provenance of the frame: what triggered it, who requested
 * it, what the AI was authorized to do, and the policy baseline in effect.
 */
export interface FrameCreatedEvent {
  type: "frame-created";
  /** The newly created frame. */
  frameId: FrameId;
  /** What triggered this frame to be constructed. */
  triggerSource: FrameTriggerSource;
  /** Raw intent that caused this frame to be created. */
  intent: string;
  /** Broad classification of the intent, if the Projection layer resolved it. */
  intentCategory?: IntentCategory;
  /** The Projection layer's confidence in its interpretation of the intent. */
  interpretationConfidence?: ConfidenceScore;
  /** When this frame's authorization window closes. */
  expiresAt: ISOTimestamp;
  /** Semantic version of the Projection layer that built this frame. */
  projectionVersion: string;
  /** Version of the policy set active at construction time. */
  policySetVersion: string;
  /** IDs of Capabilities the AI is authorized to invoke within this frame. */
  authorizedCapabilityIds: CapabilityId[];
  /** Number of authorized capabilities (for quick summary queries). */
  authorizedCapabilityCount: number;
  /** Entitlement tokens the principal holds at frame-construction time. */
  entitlements: string[];
  /** Classification tags applied by the Projection layer. */
  tags: string[];
}

/**
 * Emitted when a Decision Frame is invalidated — either by TTL expiry,
 * explicit invalidation, or session termination.
 */
export interface FrameExpiredEvent {
  type: "frame-expired";
  frameId: FrameId;
  /** When the frame was originally set to expire. */
  scheduledExpiresAt: ISOTimestamp;
  /** Why this frame was invalidated. */
  reason: "ttl-elapsed" | "explicit-invalidation" | "session-ended" | "max-executions-reached";
}

// -- Execution request ------------------------------------------------------

/**
 * Emitted when the AI produces an ExecutionRequest.
 *
 * Captured before Guardrail evaluation so that even denied requests have
 * a complete audit trail. Includes the AI's confidence and rationale to
 * enable retrospective analysis of AI decision quality.
 */
export interface ExecutionRequestedEvent {
  type: "execution-requested";
  executionRequestId: string;
  frameId: FrameId;
  /** The capability the AI is requesting to invoke. */
  capabilityId: CapabilityId;
  capabilityVersion: string;
  /** The AI's self-reported confidence that this action is correct (0.0–1.0). */
  confidence: ConfidenceScore;
  /** The AI's explanation for why it is requesting this execution. */
  rationale?: string;
  /** Which invocation attempt this is (1 = initial, 2+ = retry). */
  attemptNumber: number;
  /** Deduplication key for non-idempotent operations. */
  idempotencyKey?: string;
  /** Parent request ID if this is a chained sub-execution. */
  parentRequestId?: string;
}

// -- Guardrail pipeline -----------------------------------------------------

/**
 * Emitted when the Guardrail pipeline produces its terminal decision.
 *
 * This is the single most important audit event for governance reporting:
 * it records what the guardrail decided, which stages ran, and exactly why
 * a request was denied, flagged, or sent for approval.
 */
export interface GuardrailEvaluatedEvent {
  type: "guardrail-evaluated";
  executionRequestId: string;
  frameId: FrameId;
  /**
   * Terminal decision of the Guardrail pipeline.
   * "allow" = all stages passed; "deny" = halted; "require-approval" = gated;
   * "flag" = annotated but allowed.
   */
  decision: GuardrailDecision;
  /** Pipeline stages that ran before the decision was reached. */
  stagesRan: StageName[];
  /** Machine-readable denial code. Present only when decision === "deny". */
  denyCode?: GuardrailDenyCode;
  /** Human-readable denial explanation. Present only when decision === "deny". */
  denyReason?: string;
  /** Flag annotations accumulated across all stages. Non-empty when flagged. */
  flags: GuardrailFlag[];
  /** Total wall-clock duration of the pipeline run in milliseconds. */
  evaluationDurationMs: number;
  /** Policy that triggered the terminal decision, if applicable. */
  policyId?: string;
}

/**
 * Emitted when the Policy engine evaluation run completes within the
 * Guardrail pipeline's policy stage.
 *
 * Captures the policy engine's structured decision separately from the
 * pipeline's aggregate decision, enabling fine-grained policy analytics.
 */
export interface PolicyEvaluatedEvent {
  type: "policy-evaluated";
  /** Unique identifier of this policy engine evaluation run. */
  evaluationId: string;
  executionRequestId: string;
  /**
   * The policy engine's decision.
   * Mirrors the PolicyEvaluationResult.decision.outcome field.
   */
  policyDecisionOutcome: "allow" | "deny" | "require-approval" | "flag";
  /** Machine-readable denial code from the policy engine. */
  policyDenyCode?: PolicyDenyCode;
  /** ID of the first policy that produced a terminal deny or approval decision. */
  terminatingPolicyId?: string;
  terminatingPolicyName?: string;
  /** Total number of enabled policies evaluated. */
  evaluatedPolicyCount: number;
  /** Number of policy violations recorded. */
  violationCount: number;
  /** Number of flag annotations produced. */
  flagCount: number;
  /** Wall-clock duration of the policy engine evaluation in milliseconds. */
  evaluationDurationMs: number;
}

// -- Authorization ----------------------------------------------------------

/**
 * Emitted when the Guardrail authorization stage denies a request because
 * the principal lacks one of the capability's required entitlements.
 */
export interface EntitlementDeniedEvent {
  type: "entitlement-denied";
  executionRequestId: string;
  frameId: FrameId;
  capabilityId: CapabilityId;
  /** The specific entitlement token that was missing. */
  requiredEntitlement: string;
  /** All entitlement tokens the principal held at evaluation time. */
  principalEntitlements: string[];
}

/**
 * Emitted when a policy rule breach is recorded during evaluation.
 *
 * A policy violation does not necessarily halt the pipeline — it depends
 * on the policy's action. This event captures each violation independently
 * for granular compliance reporting.
 */
export interface PolicyViolationEvent {
  type: "policy-violation";
  /** Unique identifier of this specific violation instance. */
  violationId: string;
  policyId: string;
  policyName: string;
  /** Structural category of the violation. */
  kind: PolicyViolationKind;
  /** Risk severity assigned to this violation by the policy. */
  severity: PolicyViolationSeverity;
  /**
   * Dot-notation path to the field that triggered the violation.
   * Present for condition-failed and threshold-breached kinds.
   */
  field?: string;
  /** Human-readable description of the breach. */
  message: string;
  /** Actionable guidance for remediation. */
  remediationHint?: string;
  /** The execution request this violation was evaluated against. */
  executionRequestId?: string;
}

// -- Approval workflow ------------------------------------------------------

/**
 * Emitted when the runtime opens an approval gate for an ExecutionRequest.
 *
 * The approval gate pauses execution until a qualified approver responds
 * or the timeout elapses.
 */
export interface ApprovalRequestedEvent {
  type: "approval-requested";
  executionRequestId: string;
  /** The specific approval requirement from the Decision Frame being activated. */
  requirementId: string;
  /** Role or identity class that may grant approval. */
  approverRole: string;
  /** The policy that triggered this approval requirement, if applicable. */
  policyId?: string;
  /** Maximum wait time before automatic resolution. */
  timeoutMs: number;
  /** When true, timeout results in automatic denial. */
  denyOnTimeout: boolean;
  /** When this approval request was opened. */
  requestedAt: ISOTimestamp;
}

/**
 * Emitted when a qualified approver explicitly grants an approval request.
 */
export interface ApprovalGrantedEvent {
  type: "approval-granted";
  executionRequestId: string;
  requirementId: string;
  /** The principal who granted approval. */
  approverId: string;
  /** The approver's role at the time of granting. */
  approverRole: string;
  /** When approval was granted. */
  grantedAt: ISOTimestamp;
  /** Optional notes provided by the approver. */
  notes?: string;
}

/**
 * Emitted when an approval request is denied — whether by an explicit
 * approver decision, timeout expiry, or escalation resolution.
 */
export interface ApprovalDeniedEvent {
  type: "approval-denied";
  executionRequestId: string;
  requirementId: string;
  /**
   * The principal who denied approval.
   * Absent when the denial was caused by timeout or system escalation.
   */
  approverId?: string;
  approverRole?: string;
  /** When the denial was recorded. */
  deniedAt: ISOTimestamp;
  /** Why the approval was denied. */
  reason: "explicit-denial" | "timeout" | "escalation";
  /** Optional notes provided by the approver or escalation system. */
  notes?: string;
}

// -- Capability execution ---------------------------------------------------

/**
 * Emitted when a Capability handler completes an invocation attempt.
 *
 * Covers both successful and partial-success outcomes. Failure outcomes
 * emit `ExecutionFailedEvent` or `ExecutionTimedOutEvent` instead.
 * Retry state (`retrying`) is included here so that the trace can show
 * the full retry chain without requiring a separate event type.
 */
export interface CapabilityExecutedEvent {
  type: "capability-executed";
  executionRequestId: string;
  capabilityId: CapabilityId;
  capabilityVersion: string;
  /** Terminal status of this invocation attempt. */
  status: CapabilityExecutionStatus;
  /** Wall-clock duration of the handler invocation in milliseconds. */
  durationMs: number;
  /** Which invocation attempt this was. */
  attemptNumber: number;
  /** Whether the output payload passed outputSchema validation. */
  outputSchemaValid: boolean;
  /**
   * IDs of side effects declared by the handler.
   * Enables rollback targeting and side-effect audit queries.
   */
  declaredSideEffectIds?: string[];
}

/**
 * Emitted when a Capability invocation terminates with a non-retriable error.
 *
 * Distinct from `CapabilityExecutedEvent` so that failure events can be
 * indexed and alerted on independently of successful executions.
 */
export interface ExecutionFailedEvent {
  type: "execution-failed";
  executionRequestId: string;
  capabilityId: CapabilityId;
  capabilityVersion: string;
  /** Machine-readable error code from the capability. */
  errorCode: string;
  /** Human-readable error description. Must not contain credentials or PII. */
  errorMessage: string;
  /** Whether the runtime will schedule a retry for this failure. */
  retryable: boolean;
  /** Which invocation attempt failed. */
  attemptNumber: number;
  /** Whether another attempt will be made (false if max attempts reached). */
  willRetry: boolean;
  /** Minimum delay before the next attempt, in milliseconds. */
  retryAfterMs?: number;
}

/**
 * Emitted when the hard timeout elapses before the Capability handler returns.
 *
 * Distinguishes infrastructure-level timeouts from capability-level errors,
 * which aids diagnosis of systematic performance or deadlock issues.
 */
export interface ExecutionTimedOutEvent {
  type: "execution-timed-out";
  executionRequestId: string;
  capabilityId: CapabilityId;
  capabilityVersion: string;
  /** The effective timeout that was enforced, in milliseconds. */
  effectiveTimeoutMs: number;
  /** Which invocation attempt timed out. */
  attemptNumber: number;
}

// -- Rollback ---------------------------------------------------------------

/**
 * Emitted when the runtime initiates a rollback for a prior execution.
 *
 * The `initiatedBy` field distinguishes system-driven rollbacks (circuit
 * breakers, hook instructions) from principal-driven or operator-driven ones,
 * which is essential for governance auditing.
 */
export interface RollbackInitiatedEvent {
  type: "rollback-initiated";
  executionRequestId: string;
  capabilityId: CapabilityId;
  capabilityVersion: string;
  /** Why rollback was triggered. */
  reason: string;
  /** What caused the rollback decision. */
  initiatedBy: "principal" | "system" | "hook" | "operator";
  /**
   * The identity of the initiating actor.
   * Present for "principal" and "operator" initiators.
   * For "system" and "hook", use hookId or systemComponent instead.
   */
  initiatorId?: string;
  /** Hook that produced the rollback instruction, if applicable. */
  hookId?: HookId;
}

/**
 * Emitted when the rollback handler completes — successfully, partially,
 * or with a failure.
 *
 * Partial rollbacks occur when some side effects were reversed but others
 * could not be. The `outcome` field drives compensating action decisions.
 */
export interface RollbackCompletedEvent {
  type: "rollback-completed";
  executionRequestId: string;
  capabilityId: CapabilityId;
  capabilityVersion: string;
  /** Terminal outcome of the rollback attempt. */
  outcome: "success" | "failure" | "partial";
  /** Wall-clock duration of the rollback handler, in milliseconds. */
  durationMs: number;
  /**
   * Machine-readable error code if the rollback failed.
   * Must not contain credentials or PII.
   */
  errorCode?: string;
  errorMessage?: string;
}

// -- Hook lifecycle ---------------------------------------------------------

/**
 * Emitted after each Hook handler completes execution at a lifecycle stage.
 *
 * Captures the hook's identity, timing, and outcome so that the full hook
 * execution history is part of the audit trail. Error details are included
 * when the handler threw or returned an abort outcome.
 */
export interface HookTriggeredEvent {
  type: "hook-triggered";
  hookId: HookId;
  /** Human-readable hook name for log-friendly display. */
  hookName: string;
  /** The lifecycle stage at which this hook fired. */
  stage: HookStage;
  /** The outcome the hook signalled. */
  outcome: HookOutcome;
  /** Wall-clock duration of the hook handler, in milliseconds. */
  durationMs: number;
  /**
   * Structured error detail when the handler threw or returned outcome "abort".
   * Must not contain credentials or PII.
   */
  error?: HookError;
  /** The execution request this hook was triggered for, if applicable. */
  executionRequestId?: string;
  /** The capability involved, if applicable. */
  capabilityId?: CapabilityId;
}

// ---------------------------------------------------------------------------
// AuditEvent — discriminated union
// ---------------------------------------------------------------------------

/**
 * The payload of a single auditable governance event.
 *
 * Discriminated on the `type` field. Each variant carries exactly the
 * fields needed for that event — no generic `details: Metadata` bag.
 *
 * Consumers narrow the event type with a type guard or switch:
 *
 *   switch (record.event.type) {
 *     case "guardrail-evaluated":
 *       const { decision, denyCode } = record.event; // fully typed
 *       break;
 *     case "capability-executed":
 *       const { status, durationMs } = record.event; // fully typed
 *       break;
 *   }
 */
export type AuditEvent =
  | FrameCreatedEvent
  | FrameExpiredEvent
  | ExecutionRequestedEvent
  | GuardrailEvaluatedEvent
  | PolicyEvaluatedEvent
  | EntitlementDeniedEvent
  | PolicyViolationEvent
  | ApprovalRequestedEvent
  | ApprovalGrantedEvent
  | ApprovalDeniedEvent
  | CapabilityExecutedEvent
  | ExecutionFailedEvent
  | ExecutionTimedOutEvent
  | RollbackInitiatedEvent
  | RollbackCompletedEvent
  | HookTriggeredEvent;

// ---------------------------------------------------------------------------
// AuditRecord
// ---------------------------------------------------------------------------

/**
 * An immutable record of a single governance event in the runtime.
 *
 * AuditRecords form the tamper-evident ledger of everything the Projection
 * Control Plane observed, decided, or blocked. Each record is a discrete
 * unit: one event, one outcome, one actor, one moment in time.
 *
 * Records within a trace are linked into a hash chain via `checksum` and
 * `previousChecksum`. This chain enables tamper detection: modifying any
 * record invalidates all downstream checksums.
 *
 * Distributed tracing model:
 *   - `traceId`      — links all records in one execution chain
 *   - `spanId`       — identifies this record within the trace
 *   - `parentSpanId` — links to the record that caused this one
 *   - `sequenceNumber` — monotonic ordering within the trace
 *
 * Querying:
 *   Records carry denormalized cross-references (`frameId`,
 *   `executionRequestId`, `capabilityId`) so that queries by any
 *   dimension do not require joins against other tables.
 */
export interface AuditRecord {
  // -- Identity --

  /** Stable unique identifier for this record. UUID v4 recommended. */
  recordId: AuditRecordId;

  // -- Distributed tracing --

  /**
   * Stable identifier shared by all records in the same execution chain.
   * Scoped to the lifecycle of a single ExecutionRequest (projection → result).
   */
  traceId: TraceId;

  /**
   * Unique identifier for this record's span within the trace.
   * Follows the OpenTelemetry span model.
   */
  spanId: SpanId;

  /**
   * Span identifier of the record that caused this one.
   * Absent for the root record in a trace (frame-created).
   */
  parentSpanId?: SpanId;

  /**
   * Monotonically increasing integer within a trace.
   * 1 = first record. Used for deterministic ordering when timestamps
   * have insufficient resolution (e.g. two events in the same millisecond).
   */
  sequenceNumber: number;

  // -- Timing --

  /** ISO-8601 timestamp at which this event was recorded. */
  timestamp: ISOTimestamp;

  // -- What happened --

  /**
   * The structured event payload. Discriminated on `event.type`.
   * Use a switch on `event.type` to narrow to the specific variant.
   */
  event: AuditEvent;

  /**
   * High-level outcome for query-by-outcome filtering.
   * The full decision detail lives in `event`.
   */
  outcome: AuditOutcome;

  // -- Who --

  /** The principal, session, and workflow context at the time of this event. */
  actor: AuditActor;

  // -- Cross-references (denormalized for queryability) --

  /**
   * The Decision Frame this record is associated with.
   * Present for all records except those that predate frame construction.
   */
  frameId?: FrameId;

  /**
   * The ExecutionRequest this record is associated with.
   * Absent for frame lifecycle events (frame-created, frame-expired).
   */
  executionRequestId?: string;

  /**
   * The Capability involved, if applicable.
   * Present for execution, approval, rollback, and relevant hook records.
   */
  capabilityId?: CapabilityId;

  // -- Integrity (hash chain) --

  /**
   * SHA-256 hex digest of the canonical JSON serialization of this record
   * with `checksum` and `previousChecksum` set to `null`.
   *
   * Compute as:
   *   SHA-256(JSON.stringify({ ...record, checksum: null, previousChecksum: null }))
   *
   * Enables post-hoc tamper detection: if this record was modified,
   * its checksum will no longer match the recomputed value.
   */
  checksum?: string;

  /**
   * The `checksum` of the immediately preceding record in this trace.
   * Absent for the first record in a trace (sequenceNumber === 1).
   *
   * Linking checksums forms a hash chain: modifying any record invalidates
   * all subsequent `previousChecksum` references.
   */
  previousChecksum?: string;

  // -- Extension --

  /** Domain-specific extension fields. Must not contain credentials or PII. */
  metadata?: Metadata;
}

// ---------------------------------------------------------------------------
// AuditTrail
// ---------------------------------------------------------------------------

/**
 * The scope of an AuditTrail — the dimension along which records are collected.
 *
 *   frame              — all records produced within a single Decision Frame lifetime
 *   execution-request  — all records for the lifecycle of one ExecutionRequest
 *   session            — all records within a principal's interactive session
 *   workflow           — all records across a multi-step workflow (shared correlationId)
 *   policy-evaluation  — all records produced by a single policy engine evaluation run
 */
export type AuditTrailScope =
  | "frame"
  | "execution-request"
  | "session"
  | "workflow"
  | "policy-evaluation";

/**
 * Lifecycle state of an AuditTrail.
 *
 *   open    — actively accepting new records
 *   closed  — the scoped lifecycle is complete; no new records expected
 *   sealed  — cryptographically finalized; `sealChecksum` is computed and locked
 *
 * Sealed trails are suitable for long-term storage and compliance exports.
 * Once sealed, adding records is not permitted.
 */
export type AuditTrailStatus = "open" | "closed" | "sealed";

/**
 * Aggregate statistics computed over an AuditTrail's record set.
 *
 * Updated incrementally as records are appended. Provides a fast summary
 * without scanning all records.
 */
export interface AuditTrailSummary {
  /** Total number of records in the trail. */
  totalRecords: number;
  /** Record count broken down by event type. */
  byEventType: Partial<Record<AuditEventType, number>>;
  /** Record count broken down by outcome. */
  byOutcome: Partial<Record<AuditOutcome, number>>;
  /** Timestamp of the earliest record in the trail. */
  firstEventAt: ISOTimestamp;
  /** Timestamp of the most recent record in the trail. */
  lastEventAt: ISOTimestamp;
}

/**
 * A scoped, ordered collection of AuditRecords for a single dimension
 * of operational activity.
 *
 * AuditTrails are the primary unit for compliance exports, incident
 * investigation, and audit queries. They carry a summary for fast
 * reporting and a full record list for complete traceability.
 *
 * Sealing:
 *   When status transitions to "sealed", the runtime computes a
 *   `sealChecksum` — a SHA-256 hash of all record checksums concatenated
 *   in sequenceNumber order. This proves the trail has not been truncated
 *   or reordered since sealing. Sealed trails are immutable.
 */
export interface AuditTrail {
  // -- Identity --

  /** Stable unique identifier for this trail. */
  trailId: string;

  /**
   * The trace identifier shared by all records in this trail.
   * For execution-request trails, traceId === the execution trace identifier.
   */
  traceId: TraceId;

  // -- Scope --

  /** What dimension this trail covers. */
  scope: AuditTrailScope;

  /**
   * The ID of the scoped entity.
   * For scope "frame": the frameId.
   * For scope "execution-request": the executionRequestId.
   * For scope "session": the sessionId.
   * For scope "workflow": the workflowId.
   * For scope "policy-evaluation": the evaluationId.
   */
  scopeId: string;

  // -- Actor context --

  principalId: PrincipalId;
  sessionId: string;
  workflowId?: string;
  correlationId?: string;

  // -- Records --

  /** All records in this trail, ordered by sequenceNumber ascending. */
  records: readonly AuditRecord[];

  /** Aggregate statistics over the record set. */
  summary: AuditTrailSummary;

  // -- Lifecycle --

  status: AuditTrailStatus;
  openedAt: ISOTimestamp;
  closedAt?: ISOTimestamp;

  // -- Cryptographic seal --

  /**
   * When the trail was sealed. Present only when status === "sealed".
   * After this point, the trail is immutable.
   */
  sealedAt?: ISOTimestamp;

  /**
   * SHA-256 hex digest of all record checksums concatenated in
   * sequenceNumber order.
   *
   * Compute as:
   *   SHA-256(records
   *     .sort((a, b) => a.sequenceNumber - b.sequenceNumber)
   *     .map(r => r.checksum ?? "")
   *     .join(""))
   *
   * Proves that the trail has not been truncated or reordered since sealing.
   * Present only when status === "sealed".
   */
  sealChecksum?: string;

  metadata?: Metadata;
}

// ---------------------------------------------------------------------------
// ExecutionTrace — phase decomposition interfaces
// ---------------------------------------------------------------------------

/**
 * Projection layer phase: Decision Frame construction.
 *
 * Always present in an ExecutionTrace — every governed execution begins
 * with a Decision Frame being constructed by the Projection layer.
 */
export interface ProjectionPhaseTrace {
  frameId: FrameId;
  /** When the Projection layer completed frame construction. */
  createdAt: ISOTimestamp;
  /** When this frame's authorization window closes. */
  expiresAt: ISOTimestamp;
  projectionVersion: string;
  policySetVersion: string;
  triggerSource: FrameTriggerSource;
  /** Number of capabilities the AI was authorized to invoke. */
  authorizedCapabilityCount: number;
  /** Raw intent string that triggered this frame. */
  intent: string;
  /**
   * IDs of TelemetryReference objects included in the frame.
   * Links the execution to the live operational signals the AI reasoned against.
   */
  telemetryReferenceIds: string[];
}

/**
 * Guardrail pipeline phase: policy evaluation and authorization.
 *
 * Always present in an ExecutionTrace — every ExecutionRequest is subject
 * to Guardrail evaluation, even if immediately denied.
 */
export interface GuardrailPhaseTrace {
  /** Terminal decision of the Guardrail pipeline. */
  decision: GuardrailDecision;
  /** Pipeline stages that ran before the decision was reached. */
  stagesRan: StageName[];
  /** Machine-readable denial code. Present when decision === "deny". */
  denyCode?: GuardrailDenyCode;
  /** Human-readable denial reason. Present when decision === "deny". */
  denyReason?: string;
  /** Flag annotations accumulated during this evaluation. */
  flags: GuardrailFlag[];
  /** Number of policy violations recorded during this evaluation. */
  violationCount: number;
  /** When the pipeline evaluation completed. */
  evaluatedAt: ISOTimestamp;
  /** Total wall-clock duration of the Guardrail pipeline, in milliseconds. */
  durationMs: number;
  /**
   * ID of the corresponding policy engine evaluation run.
   * Present when the policy stage ran.
   */
  policyEvaluationId?: string;
}

/**
 * Terminal resolution of an approval phase.
 *
 *   granted     — a qualified approver explicitly granted the request
 *   denied      — a qualified approver explicitly denied the request
 *   timed-out   — the approval timeout elapsed before a response was received
 *   pending     — approval has been requested but not yet resolved
 */
export type ApprovalResolution = "granted" | "denied" | "timed-out" | "pending";

/**
 * Approval workflow phase: human or system approval gating.
 *
 * Present when the Guardrail decision was "require-approval". Records
 * the full lifecycle of the approval gate — from opening to resolution.
 */
export interface ApprovalPhaseTrace {
  /** IDs of approval requirements that were activated. */
  requirementIds: string[];
  /** When the approval gate was opened. */
  requestedAt: ISOTimestamp;
  /** Terminal resolution of the approval gate. */
  resolution: ApprovalResolution;
  /** When the gate was resolved. Absent while resolution is "pending". */
  resolvedAt?: ISOTimestamp;
  /** Identity of the approver who resolved the gate, if applicable. */
  approverId?: string;
  approverRole?: string;
  /** Wall-clock duration of the approval process, in milliseconds. */
  durationMs?: number;
  /** Notes provided by the approver or escalation system. */
  notes?: string;
}

/**
 * Capability execution phase: handler invocation and result.
 *
 * Present when execution was attempted (i.e. guardrail allowed or approval
 * was granted). Covers all attempts including retries.
 */
export interface CapabilityPhaseTrace {
  capabilityId: CapabilityId;
  capabilityVersion: string;
  /** Terminal status across all attempts. */
  status: CapabilityExecutionStatus;
  /** Total number of invocation attempts (initial + retries). */
  attemptCount: number;
  /** When the first invocation attempt was made. */
  startedAt: ISOTimestamp;
  /** When the final attempt completed. Absent if still in progress. */
  completedAt?: ISOTimestamp;
  /** Total wall-clock duration across all attempts, in milliseconds. */
  durationMs?: number;
  /** Machine-readable error code if the terminal status is "failure" or "timeout". */
  errorCode?: string;
  /** Human-readable error message. Must not contain credentials or PII. */
  errorMessage?: string;
  /** Whether the output passed outputSchema validation. */
  outputSchemaValid?: boolean;
  /** IDs of side effects declared by the handler across all attempts. */
  declaredSideEffectIds?: string[];
}

/**
 * Terminal outcome of a rollback phase.
 *
 *   success  — all declared side effects were reversed
 *   failure  — rollback handler encountered a terminal error
 *   partial  — some side effects were reversed; others could not be
 *   pending  — rollback has been initiated but not yet completed
 */
export type RollbackOutcome = "success" | "failure" | "partial" | "pending";

/**
 * Rollback phase: undoing a prior capability execution.
 *
 * Present when a rollback was triggered after execution. Rollbacks may be
 * principal-initiated, system-initiated (circuit breaker), or hook-instructed.
 */
export interface RollbackPhaseTrace {
  /** Why rollback was triggered. */
  reason: string;
  /** What caused the rollback decision. */
  initiatedBy: "principal" | "system" | "hook" | "operator";
  initiatorId?: string;
  /** When rollback was initiated. */
  initiatedAt: ISOTimestamp;
  /** When rollback completed. Absent while outcome is "pending". */
  completedAt?: ISOTimestamp;
  /** Terminal outcome of the rollback. */
  outcome: RollbackOutcome;
  /** Wall-clock duration of the rollback handler, in milliseconds. */
  durationMs?: number;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * Summary of hook executions at a single lifecycle stage.
 *
 * Aggregates individual HookTriggeredEvent records into per-stage totals
 * for fast reporting without scanning the full record list.
 */
export interface HookExecutionSummary {
  /** The lifecycle stage these hooks ran at. */
  stage: HookStage;
  /** Number of hooks that executed at this stage. */
  hookCount: number;
  /** Total wall-clock duration across all hooks at this stage, in milliseconds. */
  durationMs: number;
  /**
   * Count of each outcome signalled by hooks at this stage.
   * Keys are HookOutcome values; values are invocation counts.
   */
  outcomeBreakdown: Record<string, number>;
  /**
   * Errors produced by hooks at this stage.
   * Each entry carries the hookId and the error summary.
   */
  errors: Array<{
    hookId: HookId;
    hookName: string;
    code: string;
    message: string;
  }>;
}

// ---------------------------------------------------------------------------
// ExecutionTrace
// ---------------------------------------------------------------------------

/**
 * Terminal outcome of a complete execution lifecycle.
 *
 *   completed          — capability executed successfully; no rollback
 *   denied             — guardrail denied; execution never started
 *   awaiting-approval  — approval gate is open; execution pending
 *   failed             — execution ran but terminated in failure
 *   rolled-back        — execution ran; subsequent rollback succeeded
 *   timed-out          — execution or approval exceeded its deadline
 *   cancelled          — explicitly cancelled by the principal or an operator
 */
export type ExecutionOutcome =
  | "completed"
  | "denied"
  | "awaiting-approval"
  | "failed"
  | "rolled-back"
  | "timed-out"
  | "cancelled";

/**
 * An end-to-end trace of a single governed execution lifecycle.
 *
 * ExecutionTrace synthesizes every phase of the lifecycle — from Decision
 * Frame construction through guardrail evaluation, optional approval gating,
 * capability invocation, and optional rollback — into a single queryable
 * record. It is the primary object for:
 *
 *   - Incident investigation: reconstruct exactly what happened and why
 *   - Compliance reporting: prove that governance controls were applied
 *   - Performance analysis: measure latency across every phase
 *   - AI quality review: correlate AI confidence with execution outcomes
 *
 * Relationship to AuditTrail:
 *   An ExecutionTrace is a materialized view over the AuditTrail with
 *   scope "execution-request". The `records` field is the same underlying
 *   record set; the phase fields are derived summaries.
 *
 * Telemetry integration:
 *   `projectionPhase.telemetryReferenceIds` links the trace to the live
 *   operational signals the AI used when reasoning about this request.
 *   Telemetry store lookups by referenceId provide the full signal context.
 */
export interface ExecutionTrace {
  // -- Identity --

  /** Stable trace identifier shared by all AuditRecords in this lifecycle. */
  traceId: TraceId;
  /** The ExecutionRequest this trace covers. */
  executionRequestId: string;
  /** The Decision Frame that authorized this execution. */
  frameId: FrameId;

  // -- Actor --

  principalId: PrincipalId;
  sessionId: string;
  workflowId?: string;
  correlationId?: string;

  // -- Lifecycle phases --

  /**
   * Decision Frame construction.
   * Always present — every execution begins with a frame.
   */
  projectionPhase: ProjectionPhaseTrace;

  /**
   * Guardrail pipeline evaluation.
   * Always present — every ExecutionRequest is evaluated.
   */
  guardrailPhase: GuardrailPhaseTrace;

  /**
   * Approval workflow phase.
   * Present when guardrailPhase.decision === "require-approval".
   */
  approvalPhase?: ApprovalPhaseTrace;

  /**
   * Capability handler invocation.
   * Present when execution was attempted (allowed by guardrail or approval granted).
   */
  capabilityPhase?: CapabilityPhaseTrace;

  /**
   * Rollback phase.
   * Present when rollback was triggered after a completed or partial execution.
   */
  rollbackPhase?: RollbackPhaseTrace;

  // -- Hook telemetry --

  /**
   * Per-stage aggregates of hook executions during this lifecycle.
   * One entry per HookStage that had at least one hook fire.
   * Ordered chronologically by stage execution order.
   */
  hookExecutions: HookExecutionSummary[];

  // -- Outcome --

  /** Terminal outcome of the full execution lifecycle. */
  outcome: ExecutionOutcome;

  /** When this trace was opened (coincides with the frame-created event). */
  startedAt: ISOTimestamp;

  /**
   * When this trace reached its terminal outcome.
   * Absent while outcome is "awaiting-approval".
   */
  completedAt?: ISOTimestamp;

  /**
   * Total wall-clock duration from frame construction to terminal outcome,
   * in milliseconds. Absent while the trace has not yet completed.
   */
  totalDurationMs?: number;

  // -- All records --

  /**
   * Every AuditRecord produced during this execution lifecycle,
   * ordered ascending by sequenceNumber.
   *
   * This is the source of truth for the trace. Phase fields and summaries
   * are derived from this record set.
   */
  records: readonly AuditRecord[];

  // -- Extension --

  /** Domain-specific extension fields. Must not contain credentials or PII. */
  metadata?: Metadata;
}
