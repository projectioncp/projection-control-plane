/**
 * Hook Framework — Core Type Definitions
 *
 * Hooks are typed lifecycle interception points that fire at well-defined seams
 * in the Projection Control Plane runtime. They do not implement logic directly —
 * they observe, annotate, redirect, and signal.
 *
 * Architecture position:
 *
 *   ┌─────────────────────────────────────────────────────────────────────┐
 *   │  Runtime Lifecycle                                                  │
 *   │                                                                     │
 *   │  beforeProjection ──► Projection Layer ──► afterProjection         │
 *   │                              │                                      │
 *   │  beforeGuardrail  ──► Guardrail Pipeline ──► afterGuardrail        │
 *   │                              │                                      │
 *   │  beforeCapability ──► Capability Handler ──► afterCapability        │
 *   │                              │                                      │
 *   │                           onError  (any stage failure)              │
 *   └─────────────────────────────────────────────────────────────────────┘
 *
 * Hook contract:
 *   1. IMMUTABILITY  — hooks must not mutate runtime objects (frames, requests,
 *      results). They signal intent through HookResult; the executor acts on it.
 *   2. ISOLATION     — hooks must not call other hooks directly.
 *   3. OBSERVABILITY — every hook invocation produces a HookResult that the
 *      executor captures for audit, telemetry, and tracing.
 *   4. FAIL POLICY   — each hook declares its error policy: fail-open (log
 *      and continue) or fail-closed (propagate and halt).
 *   5. ASYNC SAFETY  — hooks may be async but must respect timeoutMs.
 *      The executor enforces the timeout; the hook must not rely on unbounded I/O.
 *
 * Hook use cases by stage:
 *   beforeProjection  — intent logging, principal enrichment, rate limiting
 *   afterProjection   — frame telemetry, context validation, A/B routing
 *   beforeGuardrail   — request tracing, pre-flight policy checks, feature flags
 *   afterGuardrail    — audit emission, metrics, decision logging, alerting
 *   beforeCapability  — input validation, idempotency key injection, tracing
 *   afterCapability   — output validation, side-effect logging, rollback preparation
 *   onError           — alerting, diagnostic capture, circuit breaker updates
 *
 * Type safety model:
 *   Each HookStage has its own context type. HookHandler<S> is typed to receive
 *   exactly the context for stage S. The HookRegistry stores hooks as AnyHook
 *   (a union of all concrete Hook<S> variants) and re-narrows on retrieval via
 *   getHooksForStage<S>(stage: S): Hook<S>[].
 *
 * Related modules:
 *   registry.ts   — HookRegistry interface and lifecycle management
 *   schema.ts     — Zod validation for serializable hook types
 */

import type {
  CapabilityId,
  ConfidenceScore,
  FrameTriggerSource,
  ISOTimestamp,
  Metadata,
  PrincipalId,
  DecisionFrame,
} from "../projection/frame.js";
import type { ExecutionRequest } from "../types.js";
import type { GuardrailResult } from "../guardrail/types.js";
import type {
  CapabilityExecutionRequest,
  CapabilityExecutionResult,
} from "../capabilities/execution.js";

// ---------------------------------------------------------------------------
// Re-exports for consumers of this module
// ---------------------------------------------------------------------------

export type { CapabilityId, ConfidenceScore, FrameTriggerSource, ISOTimestamp, Metadata, PrincipalId };

// ---------------------------------------------------------------------------
// Primitive type aliases
// ---------------------------------------------------------------------------

/**
 * Stable identifier for a registered Hook.
 * UUID v4 or namespaced slug (e.g. "audit:decision-logger") recommended.
 * Must be unique within a HookRegistry.
 */
export type HookId = string;

// ---------------------------------------------------------------------------
// Lifecycle stages
// ---------------------------------------------------------------------------

/**
 * The lifecycle stages at which Hook handlers may be registered.
 *
 * Each stage corresponds to a well-defined seam in the runtime:
 *
 *   beforeProjection  — fires before the Projection layer builds a DecisionFrame.
 *                       Receives the raw intent and principal context.
 *                       Use for: intent logging, principal enrichment, pre-projection guards.
 *
 *   afterProjection   — fires after the Projection layer produces a DecisionFrame.
 *                       Receives the complete frame and projection timing.
 *                       Use for: frame telemetry, context validation, routing decisions.
 *
 *   beforeGuardrail   — fires before the Guardrail pipeline evaluates an ExecutionRequest.
 *                       Receives the request, frame reference, and AI confidence.
 *                       Use for: request tracing, pre-flight policy checks, feature flags.
 *
 *   afterGuardrail    — fires after the Guardrail pipeline produces a GuardrailResult.
 *                       Receives the full result including the decision and audit records.
 *                       Use for: audit emission, metrics, alerting on deny decisions.
 *
 *   beforeCapability  — fires before the capability handler is invoked.
 *                       Receives the fully-constructed CapabilityExecutionRequest.
 *                       Use for: input validation, idempotency key injection, handler tracing.
 *
 *   afterCapability   — fires after the capability handler returns a result.
 *                       Receives both the request and the result (success or failure).
 *                       Use for: output validation, side-effect logging, rollback preparation.
 *
 *   onError           — fires when an unhandled error occurs at any stage.
 *                       Receives the failed stage, the error, and available partial context.
 *                       Use for: alerting, diagnostic capture, circuit breaker state updates.
 */
export type HookStage =
  | "beforeProjection"
  | "afterProjection"
  | "beforeGuardrail"
  | "afterGuardrail"
  | "beforeCapability"
  | "afterCapability"
  | "onError";

// ---------------------------------------------------------------------------
// Hook outcomes
// ---------------------------------------------------------------------------

/**
 * What a Hook signals to the executor about how to proceed.
 *
 *   continue   — proceed normally with the next hook and then the runtime operation
 *   skip       — skip any remaining hooks at this stage; continue with the operation
 *   abort      — halt the entire operation immediately; surface error to the caller
 *   override   — replace the output of this stage (valid only for after-stage hooks)
 *   retry      — re-queue the operation for another attempt (valid for capability stage)
 *   escalate   — route outside the normal flow for human review or intervention
 *
 * Outcome priority when multiple hooks run at the same stage:
 *   abort > retry > escalate > override > skip > continue
 *
 * Non-halting outcomes (continue, skip) allow subsequent hooks to run.
 * Halting outcomes (abort, retry, escalate, override) stop further hook execution
 * at that stage.
 */
export type HookOutcome =
  | "continue"
  | "skip"
  | "abort"
  | "override"
  | "retry"
  | "escalate";

// ---------------------------------------------------------------------------
// Error handling policy
// ---------------------------------------------------------------------------

/**
 * Controls how the executor behaves when a hook handler throws an exception.
 *
 *   fail-open   — log the exception and continue; hook failure does not fail the operation.
 *                 Appropriate for observability hooks (telemetry, audit logging, metrics).
 *
 *   fail-closed — propagate the exception and halt the operation.
 *                 Appropriate for enforcement hooks (security checks, approval gates).
 *
 * Default (when absent on a Hook): "fail-open".
 */
export type HookErrorPolicy = "fail-open" | "fail-closed";

// ---------------------------------------------------------------------------
// Hook registration status
// ---------------------------------------------------------------------------

/**
 * Outcome of a HookRegistry.register() call.
 *
 *   registered — new hook registered successfully
 *   updated    — existing hook definition updated (if registry allows updates)
 *   rejected   — registration refused; see HookRegistrationResult.reason
 */
export type HookRegistrationStatus = "registered" | "updated" | "rejected";

// ---------------------------------------------------------------------------
// Structured error
// ---------------------------------------------------------------------------

/**
 * A structured error produced during hook execution or by a hook handler.
 *
 * Used in HookResult (when outcome === "abort") and in OnErrorContext.
 * Must NOT contain credentials, stack traces with sensitive paths, or PII.
 * Stack traces should be captured separately and stripped before including `cause`.
 */
export interface HookError {
  /** Machine-readable error code. Convention: SCREAMING_SNAKE_CASE. */
  code: string;
  /** Human-readable error description. Safe to surface in logs and audit records. */
  message: string;
  /**
   * Whether the operation may succeed if retried.
   * The executor uses this when outcome === "retry" to decide whether to re-queue.
   */
  retryable: boolean;
  /**
   * The HookId that produced this error, if the error originated from a hook handler.
   * Absent when the error originated from the runtime, not a hook.
   */
  hookId?: HookId;
  /**
   * Sanitized cause description.
   * Must not contain raw stack traces with file paths, credentials, or sensitive data.
   * Example: "Upstream telemetry service timed out after 2000ms"
   */
  cause?: string;
  /** Domain-specific extension fields. */
  metadata?: Metadata;
}

// ---------------------------------------------------------------------------
// Hook result
// ---------------------------------------------------------------------------

/**
 * The result produced by a single Hook handler invocation.
 *
 * Immutability: the executor treats HookResult as read-only after it is returned.
 * The hook must not modify the result after returning it.
 *
 * Output override (outcome === "override"):
 *   Only valid for after-stage hooks (afterProjection, afterGuardrail, afterCapability).
 *   The executor will replace the stage output with `outputOverride` if provided.
 *   If outputOverride is absent when outcome === "override", the executor treats it
 *   as "continue" and logs a warning.
 *
 * Payload forwarding:
 *   `payload` is forwarded to subsequent hooks at the same stage via the executor.
 *   It is NOT forwarded across stages. Use the audit/telemetry layer for cross-stage data.
 */
export interface HookResult {
  /** The Hook that produced this result. */
  hookId: HookId;
  /** The lifecycle stage where this result was produced. */
  stage: HookStage;
  /** What the executor should do next. */
  outcome: HookOutcome;
  /** Human-readable explanation of the outcome. Included in audit and trace records. */
  reason?: string;
  /**
   * Error details. Required when outcome === "abort".
   * May also be present for non-abort outcomes when the hook encountered a non-fatal issue.
   */
  error?: HookError;
  /**
   * Output to substitute for the current stage's output.
   * Only used when outcome === "override".
   * The shape must conform to the stage's expected output type.
   */
  outputOverride?: Record<string, unknown>;
  /**
   * Arbitrary payload forwarded to subsequent hooks at the same stage.
   * Shape is hook-specific. Not propagated across stages.
   */
  payload?: Metadata;
  /** When the handler completed or timed out. */
  executedAt: ISOTimestamp;
  /** Wall-clock duration of this handler invocation in milliseconds. */
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Hook execution result — output of running all hooks at a stage
// ---------------------------------------------------------------------------

/**
 * The aggregate result of running all registered hooks at a single lifecycle stage.
 *
 * The executor produces one HookExecutionResult per stage per runtime operation.
 * It contains the individual results from every hook that ran, the terminal outcome,
 * and any error or override payload that the runtime should act on.
 *
 * Terminal outcome priority (when multiple hooks produce conflicting outcomes):
 *   abort > retry > escalate > override > skip > continue
 *
 * Consumers:
 *   - The runtime acts on terminalOutcome to decide whether to proceed, abort, etc.
 *   - The audit layer captures hookResults verbatim.
 *   - Telemetry consumes durationMs for stage-level latency metrics.
 */
export interface HookExecutionResult {
  /** The lifecycle stage that was executed. */
  stage: HookStage;
  /** Individual results from each hook that ran, in execution order. */
  hookResults: HookResult[];
  /**
   * Aggregated terminal outcome across all hooks at this stage.
   * Determined by applying the priority order:
   *   abort > retry > escalate > override > skip > continue
   */
  terminalOutcome: HookOutcome;
  /**
   * The error from the first hook that produced an "abort" outcome.
   * Present only when terminalOutcome === "abort".
   */
  abortError?: HookError;
  /**
   * The output override from the last hook that produced an "override" outcome.
   * Present only when terminalOutcome === "override".
   */
  outputOverride?: Record<string, unknown>;
  /** When hook execution at this stage started. */
  executedAt: ISOTimestamp;
  /** Total wall-clock duration across all hooks at this stage in milliseconds. */
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Stage-specific context types
// ---------------------------------------------------------------------------

/**
 * Context passed to hooks registered at the "beforeProjection" stage.
 *
 * Fires before the Projection layer builds a DecisionFrame.
 * At this point, no frame exists yet — context is the raw inputs.
 *
 * Typical uses: intent logging, principal enrichment, pre-projection rate limits.
 *
 * Immutability: hooks must not modify any field. Signal modifications via HookResult.
 */
export interface BeforeProjectionContext {
  /** Discriminant. */
  stage: "beforeProjection";
  /** What caused projection to be triggered. */
  triggerSource: FrameTriggerSource;
  /** Verbatim user or system intent that triggered frame construction. */
  intent: string;
  /** Identity requesting frame construction. */
  principalId: PrincipalId;
  /** Session this projection belongs to. */
  sessionId: string;
  /** Workflow this projection step is part of, if applicable. */
  workflowId?: string;
  /**
   * Stable correlation ID linking this to a chain of related operations.
   * Propagated by the caller; absent for top-level projections.
   */
  correlationId?: string;
  /**
   * Environment tag for the runtime context.
   * Examples: "production", "staging", "development".
   */
  environment?: string;
  /** Domain-specific extension fields from the caller. */
  metadata?: Metadata;
}

/**
 * Context passed to hooks registered at the "afterProjection" stage.
 *
 * Fires after the Projection layer successfully produces a DecisionFrame.
 * The hook receives the complete canonical frame.
 *
 * Typical uses: frame telemetry, context validation, downstream routing decisions.
 *
 * Immutability: do not mutate `frame`. The frame is an authoritative governance
 * artifact — mutations would corrupt the audit trail.
 */
export interface AfterProjectionContext {
  /** Discriminant. */
  stage: "afterProjection";
  /**
   * The canonical DecisionFrame produced by the Projection layer.
   * Read-only; represents the bounded operational context for this reasoning cycle.
   */
  frame: DecisionFrame;
  /** The intent that triggered frame construction. */
  intent: string;
  /** Principal this frame was issued to. */
  principalId: PrincipalId;
  /** Session this frame belongs to. */
  sessionId: string;
  /**
   * Wall-clock time in milliseconds taken to build the frame.
   * Useful for detecting slow projections or anomalous patterns.
   */
  projectionDurationMs: number;
  /** Correlation ID from the triggering request, if any. */
  correlationId?: string;
  /** Domain-specific extension fields. */
  metadata?: Metadata;
}

/**
 * Context passed to hooks registered at the "beforeGuardrail" stage.
 *
 * Fires before the Guardrail pipeline evaluates an ExecutionRequest.
 * The hook receives the request and the key governance fields needed to
 * make pre-flight decisions.
 *
 * Typical uses: request tracing, pre-flight policy checks, feature flag evaluation,
 * confidence floor pre-screening.
 *
 * Note: this stage uses the draft ExecutionRequest type from types.ts.
 * The guardrail pipeline operates against the draft layer during the ongoing migration.
 *
 * Immutability: do not mutate `request`. Signal policy interventions via HookResult.
 */
export interface BeforeGuardrailContext {
  /** Discriminant. */
  stage: "beforeGuardrail";
  /**
   * The ExecutionRequest the AI produced for this invocation.
   * Read-only. The Guardrail pipeline has not yet evaluated it.
   */
  request: ExecutionRequest;
  /** ID of the Decision Frame authorizing this request. */
  frameId: string;
  /** The capability being requested. */
  capabilityId: CapabilityId;
  /** Principal making the request. */
  principalId: PrincipalId;
  /** Session the request belongs to. */
  sessionId: string;
  /**
   * Entitlement tokens the principal holds, snapshotted at frame-creation time.
   * Available for pre-flight entitlement checks without consulting the guardrail.
   */
  entitlements: string[];
  /**
   * The AI model's self-reported confidence for this execution request.
   * Available for pre-flight confidence floor checks.
   */
  confidence: ConfidenceScore;
  /** Domain-specific extension fields. */
  metadata?: Metadata;
}

/**
 * Context passed to hooks registered at the "afterGuardrail" stage.
 *
 * Fires after the Guardrail pipeline completes evaluation and produces a result.
 * The hook receives the full GuardrailResult, which includes the decision,
 * all stage results, and all audit records emitted during evaluation.
 *
 * Typical uses: audit record emission, decision metrics, deny-reason alerting,
 * compliance event streaming, approval request routing.
 *
 * Immutability: do not mutate `result`. Emit events or annotations via HookResult.
 */
export interface AfterGuardrailContext {
  /** Discriminant. */
  stage: "afterGuardrail";
  /**
   * The ExecutionRequest that was evaluated.
   * Read-only; matches the request from the corresponding BeforeGuardrailContext.
   */
  request: ExecutionRequest;
  /**
   * The complete GuardrailResult, including:
   *   - result.decision        — "allow" | "deny" | "require-approval" | "flag"
   *   - result.stageResults    — per-stage verdict and audit records
   *   - result.auditRecords    — all audit records from this evaluation
   *   - result.denyCode        — present when decision === "deny"
   *   - result.flags           — accumulated flag annotations
   */
  result: GuardrailResult;
  /** Domain-specific extension fields. */
  metadata?: Metadata;
}

/**
 * Context passed to hooks registered at the "beforeCapability" stage.
 *
 * Fires after the Guardrail pipeline allows the request and before the
 * capability handler is invoked.
 *
 * The hook receives the fully-constructed CapabilityExecutionRequest, which
 * carries the validated input, authorization context, timeout, and retry state.
 *
 * Typical uses: input telemetry, idempotency key injection, distributed tracing
 * span creation, capability-level rate limit enforcement.
 *
 * Immutability: do not mutate `request`. Use outputOverride or abort to intervene.
 */
export interface BeforeCapabilityContext {
  /** Discriminant. */
  stage: "beforeCapability";
  /**
   * The fully-constructed CapabilityExecutionRequest about to be dispatched.
   * Read-only; the runtime has validated the input against Capability.inputSchema.
   */
  request: CapabilityExecutionRequest;
  /** Domain-specific extension fields. */
  metadata?: Metadata;
}

/**
 * Context passed to hooks registered at the "afterCapability" stage.
 *
 * Fires after the capability handler returns a result (success, failure,
 * partial, timeout, or denied). The hook receives both the original request
 * and the result.
 *
 * Typical uses: output telemetry, side-effect logging, rollback token capture,
 * result validation, retry decision enrichment, SLA tracking.
 *
 * Note on override:
 *   A hook may return outcome === "override" with a `outputOverride` payload
 *   to replace the capability's output. Use this only for result normalization
 *   (e.g. stripping PII from outputs before surfacing to the caller). Never
 *   use override to inject fabricated results — the audit trail captures both
 *   the original result and the override.
 *
 * Immutability: do not mutate `request` or `result` directly.
 */
export interface AfterCapabilityContext {
  /** Discriminant. */
  stage: "afterCapability";
  /**
   * The request that was dispatched to the capability handler.
   * Read-only; matches the request from the corresponding BeforeCapabilityContext.
   */
  request: CapabilityExecutionRequest;
  /**
   * The result the capability handler returned.
   * Read-only. Check result.status for the execution outcome.
   */
  result: CapabilityExecutionResult;
  /** Domain-specific extension fields. */
  metadata?: Metadata;
}

/**
 * Context passed to hooks registered at the "onError" stage.
 *
 * Fires when an unhandled exception occurs at any lifecycle stage. This is
 * the last resort interception point — it fires regardless of the origin stage.
 *
 * Available context depends on which stage failed. Fields prefixed as optional
 * are populated on a best-effort basis; they may be absent if the error occurred
 * before those values were established.
 *
 * Typical uses: alerting (PagerDuty, Slack), diagnostic context capture,
 * circuit breaker state updates, structured error logging, dead-letter queue routing.
 *
 * Immutability: hooks at this stage must not attempt to resume execution.
 * They are observational only. Signal escalation via HookResult.outcome === "escalate".
 */
export interface OnErrorContext {
  /** Discriminant. */
  stage: "onError";
  /**
   * The lifecycle stage where the error occurred.
   * Never "onError" itself — this stage does not recurse.
   */
  failedStage: Exclude<HookStage, "onError">;
  /** The structured error. */
  error: HookError;
  /**
   * ID of the ExecutionRequest or CapabilityExecutionRequest being processed,
   * if available at the time of the error.
   */
  requestId?: string;
  /** ID of the capability being requested, if available. */
  capabilityId?: CapabilityId;
  /** ID of the principal involved in the failed operation, if available. */
  principalId?: PrincipalId;
  /** ID of the session, if available. */
  sessionId?: string;
  /**
   * Correlation ID linking this error to a chain of related operations,
   * if available.
   */
  correlationId?: string;
  /** Domain-specific extension fields. */
  metadata?: Metadata;
}

// ---------------------------------------------------------------------------
// HookContextMap — stage → context type mapping
// ---------------------------------------------------------------------------

/**
 * Maps each HookStage to its typed context interface.
 *
 * Used to type HookHandler<S> precisely per stage:
 *
 *   HookHandler<"beforeCapability"> receives BeforeCapabilityContext
 *   HookHandler<"afterGuardrail">   receives AfterGuardrailContext
 *   ...
 *
 * This enables TypeScript to enforce that handlers access only the fields
 * appropriate for their stage without casts or runtime checks.
 */
export interface HookContextMap {
  beforeProjection: BeforeProjectionContext;
  afterProjection: AfterProjectionContext;
  beforeGuardrail: BeforeGuardrailContext;
  afterGuardrail: AfterGuardrailContext;
  beforeCapability: BeforeCapabilityContext;
  afterCapability: AfterCapabilityContext;
  onError: OnErrorContext;
}

/**
 * Union of all stage context types. Discriminant field: `stage`.
 *
 * Use this when consuming contexts generically (e.g. in logging utilities).
 * Use HookContextMap[S] when you know the stage statically.
 */
export type HookContext = HookContextMap[HookStage];

// ---------------------------------------------------------------------------
// Hook handler
// ---------------------------------------------------------------------------

/**
 * A typed lifecycle interception function for stage S.
 *
 * The handler receives the context specific to stage S and returns a HookResult
 * (synchronously or via Promise). The executor times out async handlers at
 * HookDefinition.timeoutMs.
 *
 * Type safety:
 *   HookHandler<"beforeCapability"> = (ctx: BeforeCapabilityContext) => HookResult | Promise<HookResult>
 *   HookHandler<"afterGuardrail">   = (ctx: AfterGuardrailContext)   => HookResult | Promise<HookResult>
 *
 * Constraints:
 *   - Must not throw (return abort outcome instead)
 *   - Must not mutate the context
 *   - Must resolve within timeoutMs
 *   - Must not call other hooks directly
 */
export type HookHandler<S extends HookStage = HookStage> = (
  context: HookContextMap[S]
) => HookResult | Promise<HookResult>;

// ---------------------------------------------------------------------------
// HookDefinition — serializable hook metadata
// ---------------------------------------------------------------------------

/**
 * The serializable metadata portion of a Hook.
 *
 * HookDefinition excludes the handler function — it is safe to serialize,
 * persist, and transmit over the wire. It is the shape validated by Zod
 * schemas and returned by HookRegistry.snapshot().
 *
 * Use HookDefinition when you need to inspect, list, or persist hook
 * metadata without executing the handler.
 */
export interface HookDefinition {
  /** Stable hook identifier. Must be unique within a HookRegistry. */
  hookId: HookId;
  /** Human-readable name shown in dashboards and audit records. */
  name: string;
  /** Precise description of what this hook does and why it is registered. */
  description?: string;
  /** The lifecycle stage this hook is registered at. */
  stage: HookStage;
  /**
   * Execution priority within the stage. Lower number = executed first.
   * Hooks at equal priority are executed in undefined order.
   *
   * Convention:
   *   0–99    critical enforcement hooks (security, approval gates)
   *   100–499 platform governance hooks (audit emission, compliance)
   *   500–999 observability hooks (telemetry, tracing, metrics)
   */
  priority: number;
  /**
   * Whether this hook participates in execution.
   * Disabled hooks are skipped entirely by the executor.
   */
  enabled: boolean;
  /**
   * How the executor handles exceptions thrown by this hook's handler.
   * Defaults to "fail-open" when absent.
   */
  onHandlerError?: HookErrorPolicy;
  /**
   * Maximum wall-clock time in milliseconds the handler may run.
   * When elapsed, the executor treats the handler as if it returned a
   * HookResult with outcome "continue" and logs a timeout warning.
   * Absent = no timeout enforced (use with caution; prefer explicit bounds).
   */
  timeoutMs?: number;
  /** Classification tags for filtering, grouping, and reporting. */
  tags?: string[];
  /** Team or system that owns this hook. */
  owner?: string;
  /** When this hook was registered. */
  createdAt: ISOTimestamp;
  /** When this hook definition was last modified. */
  updatedAt?: ISOTimestamp;
  /** Domain-specific extension fields. */
  metadata?: Metadata;
}

// ---------------------------------------------------------------------------
// Hook — metadata plus executable handler
// ---------------------------------------------------------------------------

/**
 * A complete, executable Hook definition for lifecycle stage S.
 *
 * Hook<S> extends HookDefinition and narrows `stage` to S. The `handler`
 * is typed to receive exactly the context for stage S, providing compile-time
 * enforcement that handlers access only stage-appropriate fields.
 *
 * Create a Hook with createHook() (in the index) to get inference on S:
 *
 *   const hook = createHook({
 *     stage: "beforeCapability",
 *     handler: (ctx) => {
 *       // ctx is BeforeCapabilityContext — no cast needed
 *       console.log(ctx.request.capabilityId);
 *       return { hookId: hook.hookId, stage: "beforeCapability", outcome: "continue", ... };
 *     },
 *     // ...other fields
 *   });
 *
 * Storage: Hook<S> is not directly storable in an Array<Hook<HookStage>> due to
 * TypeScript's function contravariance. Use the AnyHook union type for heterogeneous
 * arrays of hooks with different stages. See AnyHook below.
 */
export interface Hook<S extends HookStage = HookStage> extends HookDefinition {
  /** Narrowed stage type. */
  stage: S;
  /** The typed handler for this stage. */
  handler: HookHandler<S>;
}

// ---------------------------------------------------------------------------
// AnyHook — heterogeneous union for storage and bulk registration
// ---------------------------------------------------------------------------

/**
 * A union of all concrete Hook<S> variants, distributed over HookStage.
 *
 * Due to TypeScript's function contravariance, Hook<"beforeCapability"> is not
 * directly assignable to Hook<HookStage> (because their handler types differ in
 * their parameter). AnyHook solves this by distributing the union:
 *
 *   AnyHook = Hook<"beforeProjection"> | Hook<"afterProjection"> | ... | Hook<"onError">
 *
 * Each concrete Hook<S> IS assignable to AnyHook (it matches one union member).
 * This makes AnyHook the correct type for:
 *   - Arrays containing hooks for multiple different stages
 *   - HookRegistry.registerAll() parameter
 *   - HookRegistry.list() return value
 *
 * To recover the typed Hook<S> from an AnyHook, use a type guard on .stage:
 *
 *   if (anyHook.stage === "beforeCapability") {
 *     // anyHook is now Hook<"beforeCapability"> — handler is BeforeCapabilityContext → HookResult
 *   }
 */
export type AnyHook = { [S in HookStage]: Hook<S> }[HookStage];

// ---------------------------------------------------------------------------
// Hook filter — for querying the registry
// ---------------------------------------------------------------------------

/**
 * Predicates for filtering the hook list.
 * All specified fields are ANDed. An empty filter matches all hooks.
 */
export interface HookFilter {
  /**
   * Filter by stage. May be a single stage or an array of stages.
   * When absent, all stages are included.
   */
  stage?: HookStage | HookStage[];
  /**
   * Filter by tags. All listed tags must be present on the hook.
   * When absent, tags are not considered.
   */
  tags?: string[];
  /**
   * Filter by enabled state.
   * When absent, both enabled and disabled hooks are included.
   */
  enabled?: boolean;
  /**
   * Filter by owner. Exact match against HookDefinition.owner.
   * When absent, all owners are included.
   */
  owner?: string;
}

// ---------------------------------------------------------------------------
// Registration result
// ---------------------------------------------------------------------------

/**
 * The result returned by HookRegistry.register() and HookRegistry.registerAll().
 */
export interface HookRegistrationResult {
  /** The outcome of the registration attempt. */
  status: HookRegistrationStatus;
  /** The hook that was registered (or rejected). */
  hookId: HookId;
  /** The stage the hook was registered at. */
  stage: HookStage;
  /**
   * Present when status === "rejected".
   * Human-readable explanation of why the registration was refused.
   */
  reason?: string;
}
