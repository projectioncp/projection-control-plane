/**
 * Capability Execution — Request and Result Contracts
 *
 * Defines the typed boundary between the Guardrail pipeline and the
 * Capability handler at execution time.
 *
 * Flow:
 *   AI produces ExecutionRequest (src/types.ts)
 *       ↓ Guardrail validates against Decision Frame
 *   Runtime builds CapabilityExecutionRequest from validated context
 *       ↓ Capability handler invoked
 *   Handler returns CapabilityExecutionResult
 *       ↓ Runtime validates output against outputSchema, writes audit record
 *   Result returned to orchestration layer
 *
 * Neither CapabilityExecutionRequest nor CapabilityExecutionResult carry
 * system handles, credentials, or raw access objects. Governed adapters
 * are provisioned separately by the runtime's adapter layer.
 */

import type { CapabilityId, ISOTimestamp, Metadata, PrincipalId } from "../projection/frame.js";

// ---------------------------------------------------------------------------
// CapabilityExecutionRequest
// ---------------------------------------------------------------------------

/**
 * Execution context passed to the runtime when invoking a capability.
 *
 * This is the runtime's translation of the AI's ExecutionRequest (which the
 * Guardrail layer has validated). It carries everything needed to invoke a
 * handler safely: validated input, authorization context, timing constraints,
 * retry state, and a deduplication key.
 *
 * The handler receives this as its primary argument alongside a
 * CapabilityExecutionContext (provisioned separately by the runtime).
 */
export interface CapabilityExecutionRequest {
  // -- Identity --

  /** Unique identifier for this specific invocation attempt. */
  requestId: string;
  /** ID of the capability being invoked. */
  capabilityId: CapabilityId;
  /** Exact version of the capability being invoked. */
  capabilityVersion: string;

  // -- Input --

  /**
   * Validated input payload for this invocation.
   * The runtime guarantees this has been validated against
   * Capability.inputSchema before the handler is invoked.
   * Treat as read-only inside the handler.
   */
  input: Record<string, unknown>;

  // -- Authorization context --

  /** Principal on whose behalf this invocation was requested. */
  principalId: PrincipalId;
  /** Decision Frame that authorized this invocation. */
  decisionFrameId: string;
  /** Session this invocation belongs to. */
  sessionId: string;
  /**
   * Entitlement tokens the principal holds, snapshotted at authorization time.
   * The handler may inspect these to apply fine-grained conditional logic
   * without performing a separate entitlement lookup.
   */
  entitlements: string[];

  // -- Tracing --

  /**
   * Stable ID linking all invocations in a chain of related operations.
   * Propagated across retries and cascade invocations.
   */
  correlationId?: string;
  /**
   * Caller-supplied key for deduplication of non-idempotent operations.
   * The runtime uses this to detect and suppress duplicate invocations.
   * Strongly recommended for capabilities with `idempotent: false`.
   */
  idempotencyKey?: string;

  // -- Timing --

  /** When this invocation was requested (before the handler was invoked). */
  requestedAt: ISOTimestamp;
  /**
   * Maximum time the handler may run before the runtime terminates it.
   * Derived from Capability.timeoutMs; may be further reduced by the
   * frame's executionConstraints but never increased beyond the capability maximum.
   */
  effectiveTimeoutMs: number;
  /**
   * Soft timeout: milliseconds after which the runtime signals the handler
   * to begin graceful cleanup. Derived from Capability.softTimeoutMs.
   * Absent if the capability does not declare a soft timeout.
   */
  effectiveSoftTimeoutMs?: number;

  // -- Retry state --

  /**
   * Which attempt this is. Starts at 1 for the initial invocation.
   * Increments by 1 for each retry. Never exceeds Capability.retryPolicy.maxAttempts.
   */
  attemptNumber: number;
  /**
   * Maximum attempts allowed for this request.
   * Copied from Capability.retryPolicy.maxAttempts at request time so the
   * handler can log/trace it without accessing the registry.
   */
  maxAttempts: number;
  /**
   * requestId of the immediately preceding attempt.
   * Present only when attemptNumber > 1. Allows correlation of retry chains.
   */
  previousAttemptId?: string;

  // -- Extension --

  /** Domain-specific extension fields for routing, feature flags, etc. */
  metadata?: Metadata;
}

// ---------------------------------------------------------------------------
// CapabilityExecutionResult
// ---------------------------------------------------------------------------

/**
 * Terminal status of a capability invocation attempt.
 *
 *   success   — handler completed; output is valid against outputSchema
 *   failure   — handler returned an error or threw; error field is populated
 *   partial   — some side effects occurred before failure (handler must declare this)
 *   timeout   — hard timeout elapsed before the handler completed
 *   denied    — a runtime check (e.g. entitlement, circuit breaker) rejected the attempt
 *   retrying  — this attempt failed and the runtime will schedule another attempt
 */
export type CapabilityExecutionStatus =
  | "success"
  | "failure"
  | "partial"
  | "timeout"
  | "denied"
  | "retrying";

/**
 * Structured error produced by a capability invocation.
 *
 * The `code` field drives retry policy: only codes listed in
 * Capability.retryPolicy.retryableErrorCodes will trigger a retry.
 */
export interface CapabilityExecutionError {
  /**
   * Machine-readable error code. Used by the runtime to decide whether to
   * retry and to classify the failure in audit records.
   * Convention: SCREAMING_SNAKE_CASE (e.g. "UPSTREAM_TIMEOUT", "INVALID_STATE").
   */
  code: string;
  /** Human-readable error description. Included in audit records. */
  message: string;
  /**
   * Structured error detail. Shape is capability-specific.
   * Must NOT contain credentials, PII, or secret values.
   */
  detail?: Record<string, unknown>;
  /**
   * Whether the runtime should consider retrying this invocation.
   * Authoritative: overrides retryPolicy.retryableErrorCodes matching.
   * If false, the failure is terminal regardless of error code.
   */
  retryable: boolean;
  /**
   * Hint for minimum delay before retrying, in milliseconds.
   * The runtime applies this as a floor on the backoff calculation.
   * Absent if the capability has no retry preference.
   */
  retryAfterMs?: number;
}

/**
 * A non-fatal issue encountered during capability execution.
 * Warnings do not change the outcome status; they supplement audit records.
 */
export interface CapabilityExecutionWarning {
  /** Machine-readable warning code. */
  code: string;
  /** Human-readable description. */
  message: string;
  /** Optional structured context. */
  detail?: Record<string, unknown>;
}

/**
 * A declared side effect produced by a partial or successful execution.
 *
 * When a capability with `rollbackSupported: true` succeeds, it may declare
 * the side effects it produced so the rollback handler knows what to undo.
 * These declarations are captured verbatim in the audit record.
 */
export interface DeclaredSideEffect {
  /** Category of side effect (e.g. "database-write", "notification-sent"). */
  type: string;
  /** The system that was affected. */
  systemName: string;
  /** Human-readable description of the specific change. */
  description: string;
  /**
   * Opaque token the rollback handler needs to reverse this side effect.
   * Included in the rollback token payload.
   */
  rollbackPayload?: unknown;
}

/**
 * The result of a capability invocation, returned by the handler and
 * processed by the runtime before being surfaced to the orchestration layer.
 *
 * The runtime:
 *   - Validates `output` against Capability.outputSchema when status === "success"
 *   - Writes an AuditRecord for this result (per Capability.auditRequirements)
 *   - Schedules a retry if status === "retrying"
 *   - Stores `rollbackToken` for potential future rollback
 */
export interface CapabilityExecutionResult {
  // -- Correlation --

  /** Matches CapabilityExecutionRequest.requestId for this attempt. */
  requestId: string;
  /** Capability that produced this result. */
  capabilityId: CapabilityId;

  // -- Outcome --

  /** Terminal status of this invocation attempt. */
  status: CapabilityExecutionStatus;
  /**
   * Output payload.
   * Present when status is "success".
   * The runtime validates this against Capability.outputSchema.
   * Must be absent when status is not "success".
   */
  output?: Record<string, unknown>;
  /**
   * Structured error.
   * Present when status is "failure", "partial", "timeout", or "denied".
   * Absent on "success".
   */
  error?: CapabilityExecutionError;
  /**
   * Non-fatal issues that occurred during execution.
   * May be present alongside any status.
   */
  warnings?: CapabilityExecutionWarning[];
  /**
   * Side effects that occurred before a partial failure.
   * Required when status is "partial" to enable accurate rollback.
   * May be present on "success" to document what changed.
   */
  sideEffects?: DeclaredSideEffect[];

  // -- Retry state --

  /** Which attempt produced this result (mirrors request.attemptNumber). */
  attemptNumber: number;

  // -- Timing --

  /** Wall-clock duration of this invocation attempt in milliseconds. */
  executionDurationMs: number;
  /** When the handler returned (or timed out). */
  completedAt: ISOTimestamp;

  // -- Rollback --

  /**
   * Opaque token enabling rollback of this execution's side effects.
   * Present only when:
   *   - Capability.rollbackSupported === true, AND
   *   - status === "success" or "partial"
   * The runtime stores this token; the capability handler must not rely
   * on it being available outside the result lifecycle.
   */
  rollbackToken?: string;

  // -- Audit --

  /**
   * ID of the AuditRecord the runtime wrote for this execution.
   * Set by the runtime after writing the record; absent if the runtime
   * has not yet written the audit record at result-return time.
   */
  auditRecordId?: string;

  // -- Extension --

  /** Domain-specific extension fields. */
  metadata?: Metadata;
}
