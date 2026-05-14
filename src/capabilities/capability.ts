/**
 * Capability — Core Interface Definitions
 *
 * A Capability is the only mechanism through which the AI runtime may affect
 * enterprise systems. It represents a deterministic, governed enterprise operation
 * exposed through a typed, policy-enforced contract.
 *
 * SECURITY INVARIANT
 * ──────────────────
 * Capabilities MUST NOT directly expose unrestricted system access.
 * They do not carry database handles, raw HTTP clients, credentials, environment
 * variables, filesystem paths, or shell execution surfaces.
 *
 * Instead, capabilities declare their access patterns via `accessPatterns` and
 * receive governed adapters from the runtime at execution time. The runtime is
 * responsible for provisioning scoped, audited access — not the capability itself.
 *
 * Anatomy of a Capability
 * ───────────────────────
 *   Identity        capabilityId, name, description, category, version, tags
 *   I/O Contract    inputSchema, outputSchema  (structured JSON Schema)
 *   Authorization   requiredEntitlements, allowedPrincipalPatterns, accessPatterns
 *   Execution       executionPolicy, timeoutMs, softTimeoutMs, idempotent
 *   Retry           retryPolicy
 *   Approval        requiresApproval, approvalRequirements
 *   Audit           auditRequirements
 *   Lifecycle       owner, documentationUri, deprecatedAt, replacedBy
 *
 * Related types:
 *   CapabilityExecutionRequest  (execution.ts) — what the runtime passes to a handler
 *   CapabilityExecutionResult   (execution.ts) — what a handler returns
 *   CapabilityRegistry          (registry.ts)  — how capabilities are looked up
 */

import type { CapabilityCategory, CapabilityId, ISOTimestamp, Metadata } from "../projection/frame.js";

// Re-export shared primitives used by consumers of this module.
export type { CapabilityCategory, CapabilityId };

// ---------------------------------------------------------------------------
// JSON Schema types — typed I/O contract
// ---------------------------------------------------------------------------

/**
 * Scalar JSON Schema types.
 */
export type JsonSchemaType =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "array"
  | "object"
  | "null";

/**
 * A single property definition within a CapabilityIOSchema.
 *
 * Covers the most commonly used JSON Schema keywords. Additional keywords
 * are allowed via the index signature and will be passed through to any
 * JSON Schema validator the runtime uses.
 */
export interface JsonSchemaProperty {
  /** JSON Schema type(s) for this property. */
  type: JsonSchemaType | JsonSchemaType[];
  /** Human-readable description. */
  description?: string;
  /** Enumerated allowed values. */
  enum?: unknown[];
  /** JSON Schema format hint (e.g. "date-time", "uuid", "email"). */
  format?: string;
  /** Minimum value (for numeric types). */
  minimum?: number;
  /** Maximum value (for numeric types). */
  maximum?: number;
  /** Minimum string length. */
  minLength?: number;
  /** Maximum string length. */
  maxLength?: number;
  /** Regex pattern the value must match (for string types). */
  pattern?: string;
  /** For array types: schema of each array element. */
  items?: JsonSchemaProperty;
  /** For object types: property definitions. */
  properties?: Record<string, JsonSchemaProperty>;
  /** For object types: required property names. */
  required?: string[];
  /** Whether null is an additionally allowed type. */
  nullable?: boolean;
  /** Default value when the property is absent. */
  default?: unknown;
  /** Example values for documentation and testing. */
  examples?: unknown[];
  /** Pass-through for additional JSON Schema keywords. */
  [key: string]: unknown;
}

/**
 * A strongly typed JSON Schema object describing a capability's input or output.
 *
 * Top-level shape is always `"object"` — capabilities exchange structured
 * payloads, not scalar values.
 *
 * The runtime validates:
 *   - ExecutionRequest.input against Capability.inputSchema before invoking
 *   - CapabilityExecutionResult.output against Capability.outputSchema before returning
 */
export interface CapabilityIOSchema {
  /** Always "object" — capabilities exchange structured payloads. */
  readonly type: "object";
  /** Property definitions keyed by property name. */
  properties: Record<string, JsonSchemaProperty>;
  /** Names of properties that must be present. */
  required?: string[];
  /**
   * Whether properties not declared in `properties` are permitted.
   * Default: false (strict schema). Set true only for intentionally open schemas.
   */
  additionalProperties: boolean;
  /** Human-readable description of this schema's purpose. */
  description?: string;
  /** Example payloads for documentation and contract testing. */
  examples?: Record<string, unknown>[];
}

// ---------------------------------------------------------------------------
// Access patterns — governed system access declaration
// ---------------------------------------------------------------------------

/**
 * Categories of enterprise system access a capability may declare.
 *
 * Declaring an access pattern does NOT grant access. The runtime uses these
 * declarations to provision the appropriate scoped adapters at execution time,
 * subject to the principal's entitlements and Guardrail policy.
 *
 * A capability that does not declare an access pattern receives no adapters
 * and cannot interact with external systems — it is purely computational.
 */
export type AccessPatternType =
  | "database-read"    // read-only query against a governed data store
  | "database-write"   // write operation against a governed data store
  | "api-read"         // read-only call to an external API
  | "api-write"        // mutating call to an external API
  | "messaging"        // publish or consume from a message bus
  | "workflow"         // invoke or advance a workflow engine
  | "notification"     // send alerts or notifications
  | "storage-read"     // read from object/file storage
  | "storage-write"    // write to object/file storage
  | "compute";         // trigger compute tasks (batch jobs, functions)

/**
 * A declaration of a specific system access pattern required by this capability.
 *
 * Capabilities declare the minimum set of access they need — the principle of
 * least privilege at the access declaration level.
 */
export interface AccessPattern {
  /** Type of access this pattern declares. */
  type: AccessPatternType;
  /**
   * Logical name of the system being accessed.
   * Example: "orders-db", "payments-api", "event-bus".
   * The runtime uses this to provision the correct scoped adapter.
   */
  systemName: string;
  /** Human-readable description of why this access is needed. */
  rationale: string;
  /**
   * Whether this access pattern is strictly required for the capability to function.
   * Optional patterns allow the capability to degrade gracefully if the adapter
   * is unavailable.
   */
  required: boolean;
  /**
   * Scope restrictions on this access pattern.
   * Example: ["read:orders", "write:order-status"] for a database-write pattern.
   * The runtime enforces these scopes when provisioning the adapter.
   */
  scopes?: string[];
}

// ---------------------------------------------------------------------------
// Execution policy
// ---------------------------------------------------------------------------

/**
 * Controls how many concurrent invocations of this capability the runtime permits.
 * Prevents thundering-herd problems on shared downstream systems.
 */
export type IsolationLevel =
  | "none"        // no concurrency limit; all invocations run in parallel
  | "queued"      // excess invocations queue; processed in FIFO order
  | "exclusive";  // only one invocation at a time; others wait or fail fast

/**
 * Rate limit applied to capability invocations.
 */
export interface RateLimitPolicy {
  /** Maximum number of invocations per window. */
  maxRequests: number;
  /** Window duration in milliseconds. */
  windowMs: number;
  /** Rate limiting algorithm. */
  strategy: "fixed-window" | "sliding-window" | "token-bucket";
}

/**
 * Circuit breaker policy to prevent cascading failures.
 *
 * States: CLOSED (normal) → OPEN (failing) → HALF-OPEN (testing recovery)
 */
export interface CircuitBreakerPolicy {
  /**
   * Number of consecutive failures before the circuit opens.
   * When open, all invocations fail fast without reaching the downstream system.
   */
  failureThreshold: number;
  /**
   * Number of consecutive successes (in HALF-OPEN state) before
   * the circuit closes and normal operation resumes.
   */
  successThreshold: number;
  /**
   * Milliseconds to wait in OPEN state before attempting HALF-OPEN.
   * During this window, invocations fail fast.
   */
  halfOpenAfterMs: number;
}

/**
 * Execution policy governing how the runtime handles invocations of this capability.
 *
 * Execution policies are enforced by the runtime, not by the capability handler.
 * The handler itself never sees policy enforcement — it receives clean invocations.
 */
export interface CapabilityExecutionPolicy {
  /**
   * Controls concurrency for this capability.
   * Defaults to "none" (fully parallel) when absent.
   */
  isolationLevel?: IsolationLevel;
  /** Rate limiting applied to inbound invocations. */
  rateLimit?: RateLimitPolicy;
  /** Circuit breaker protecting the downstream system this capability uses. */
  circuitBreaker?: CircuitBreakerPolicy;
  /**
   * Environment tags where this capability may be invoked.
   * When set, invocations from unlisted environments are rejected.
   * Example: ["production", "staging"].
   */
  allowedEnvironments?: string[];
  /**
   * Environment tags where this capability must never be invoked.
   * Takes precedence over `allowedEnvironments`.
   * Example: ["development", "test"].
   */
  prohibitedEnvironments?: string[];
}

// ---------------------------------------------------------------------------
// Retry policy
// ---------------------------------------------------------------------------

/**
 * Backoff strategy applied between retry attempts.
 */
export type BackoffStrategy =
  | "none"         // retry immediately (use with care — may amplify failures)
  | "linear"       // delay increases linearly: initialDelayMs × attemptNumber
  | "exponential"  // delay doubles each attempt: initialDelayMs × 2^(attempt-1)
  | "jitter";      // exponential with random jitter to avoid thundering herds

/**
 * Retry policy governing automatic retry behaviour for failed invocations.
 *
 * Only error codes listed in `retryableErrorCodes` will trigger a retry.
 * Non-retryable failures (or explicit non-retryable codes) are surfaced
 * immediately to the caller as a terminal failure.
 */
export interface CapabilityRetryPolicy {
  /**
   * Maximum total number of invocation attempts (initial + retries).
   * 1 = no retries; 3 = initial attempt + 2 retries.
   */
  maxAttempts: number;
  /** Backoff algorithm applied between attempts. */
  backoffStrategy: BackoffStrategy;
  /** Delay before the first retry in milliseconds. */
  initialDelayMs: number;
  /**
   * Maximum delay cap in milliseconds.
   * Prevents exponential backoff from producing unbounded delays.
   */
  maxDelayMs: number;
  /**
   * Error codes from CapabilityExecutionError that may trigger a retry.
   * Codes not listed here produce a terminal failure with no retry.
   */
  retryableErrorCodes: string[];
  /**
   * Error codes that must never be retried, even if they match a retryable pattern.
   * Useful for explicitly marking idempotency-unsafe errors as terminal.
   */
  nonRetryableErrorCodes?: string[];
}

// ---------------------------------------------------------------------------
// Audit requirements
// ---------------------------------------------------------------------------

/**
 * How thoroughly this capability's invocations must be audited.
 *
 *   minimal   — invocation metadata only (capabilityId, principalId, outcome)
 *   standard  — metadata + summary of input/output (default for most capabilities)
 *   full      — complete input and output payloads captured verbatim
 *   forensic  — full + cryptographic signature + immutable off-system copy
 */
export type CapabilityAuditLevel =
  | "minimal"
  | "standard"
  | "full"
  | "forensic";

/**
 * Audit requirements for this capability.
 *
 * Defines what must be captured, how long it must be retained, and where
 * notifications must be sent. The runtime enforces these requirements — the
 * capability handler does not write audit records directly.
 */
export interface CapabilityAuditRequirements {
  /** Required thoroughness of audit capture. */
  level: CapabilityAuditLevel;
  /** Minimum number of days audit records must be retained. */
  retainForDays: number;
  /**
   * Whether the full input payload must be captured in the audit record.
   * Required when the input contains regulated data that must be auditable.
   * Always false when the input contains secrets or credentials.
   */
  captureInput: boolean;
  /**
   * Whether the full output payload must be captured in the audit record.
   * Required when the output contains data that must be traceable.
   */
  captureOutput: boolean;
  /**
   * Whether each audit record must carry a cryptographic signature for
   * tamper detection. Implied by level "forensic".
   */
  requireSignature: boolean;
  /**
   * Notification channels that must be alerted on capability invocation.
   * Channel identifiers are resolved by the runtime's notification subsystem.
   * Example: ["slack-ops-channel", "pagerduty-high-sev"].
   */
  notifyChannels?: string[];
}

// ---------------------------------------------------------------------------
// Capability-level approval requirements
// ---------------------------------------------------------------------------

/**
 * Condition under which the capability-level approval gate activates.
 *
 * Distinct from frame-level ApprovalRequirement.trigger — this describes
 * the capability's own approval policy, not the frame's contextual requirement.
 */
export type CapabilityApprovalTrigger =
  | "always"            // every invocation requires approval
  | "first-time"        // only the first invocation by this principal requires approval
  | "environment"       // approval required in specific environments (see allowedEnvironments)
  | "above-impact";     // approval required when a computed impact score exceeds a threshold

/**
 * Approval requirement declared at the capability level.
 *
 * If `requiresApproval` is true on the Capability, this object MUST be present.
 * It describes who may approve, how many approvers are needed, and how long
 * to wait before treating a non-response as a denial.
 *
 * Frame-level ApprovalRequirements (from the Decision Frame) may add further
 * constraints at runtime — they do not replace this capability-level requirement.
 */
export interface CapabilityApprovalRequirements {
  /** Condition under which this approval gate activates. */
  trigger: CapabilityApprovalTrigger;
  /**
   * Roles that may approve this capability's invocation.
   * At least one role is required.
   */
  approverRoles: string[];
  /**
   * Minimum number of distinct approvers required.
   * Must be ≥ 1 and ≤ approverRoles.length.
   */
  minimumApprovers: number;
  /**
   * Maximum time to wait for approval before the request is resolved.
   * Positive integer in milliseconds.
   */
  timeoutMs: number;
  /**
   * When true, the invocation is denied automatically if approval is not
   * received within `timeoutMs`. When false, the approval service governs
   * timeout behaviour.
   */
  denyOnTimeout: boolean;
  /**
   * Human-readable explanation of why this capability requires approval.
   * Shown to approvers in the approval workflow.
   */
  rationale?: string;
}

// ---------------------------------------------------------------------------
// Capability interface — root contract
// ---------------------------------------------------------------------------

/**
 * A Capability is the sole mechanism through which the AI runtime may affect
 * enterprise systems.
 *
 * The AI reasons. Capabilities execute.
 *
 * The Capability interface defines the complete governed contract for a single
 * enterprise operation. It carries:
 *   - a strongly typed I/O schema the runtime validates before and after execution
 *   - the authorization requirements the principal must satisfy
 *   - the access patterns the runtime must provision (not the capability itself)
 *   - execution, retry, audit, and approval policies the runtime enforces
 *   - lifecycle metadata for deprecation and ownership tracking
 *
 * CAPABILITY AUTHORING RULES
 * ──────────────────────────
 * 1. A Capability MUST declare every access pattern it requires.
 * 2. A Capability MUST NOT embed or accept system handles, credentials,
 *    connection strings, or shell commands in any field.
 * 3. A Capability MUST define an outputSchema. Untyped output is not permitted.
 * 4. Non-idempotent capabilities MUST declare retryableErrorCodes carefully to
 *    avoid duplicate side effects.
 * 5. Forensic-level audit capabilities MUST have requiresApproval: true.
 */
export interface Capability {
  // -- Identity --

  /** Stable capability identifier. UUID or namespaced slug recommended. */
  capabilityId: CapabilityId;
  /** Human-readable name. Shown in audit records and approval workflows. */
  name: string;
  /**
   * Precise description of what this capability does and what side effects it
   * produces. Written for approvers and auditors, not just developers.
   */
  description: string;
  /** Broad operational category for policy scoping and UI grouping. */
  category: CapabilityCategory;
  /**
   * Semantic version (semver). The registry may hold multiple versions.
   * Breaking changes to inputSchema or outputSchema require a major version bump.
   */
  version: string;
  /**
   * Searchable classification labels.
   * Examples: ["financial", "high-impact"], ["read-only", "analytics"].
   */
  tags: string[];

  // -- I/O contract --

  /**
   * JSON Schema describing the structure of the input payload.
   * The runtime validates ExecutionRequest.input against this schema before
   * the capability handler is invoked. Invalid input produces a terminal failure.
   */
  inputSchema: CapabilityIOSchema;
  /**
   * JSON Schema describing the structure of the output payload.
   * The runtime validates CapabilityExecutionResult.output against this schema
   * before returning the result to the caller. Schema violations are surfaced
   * as runtime errors regardless of handler success.
   */
  outputSchema: CapabilityIOSchema;

  // -- Authorization --

  /**
   * Entitlement tokens the invoking principal must hold.
   * The Guardrail authorization stage validates these before execution.
   * Empty array = no entitlement restriction (use with caution).
   */
  requiredEntitlements: string[];
  /**
   * Optional allowlist of principal ID patterns (regex) that may invoke
   * this capability. When absent, any principal with the required entitlements
   * may invoke. When present, the principal must match at least one pattern.
   */
  allowedPrincipalPatterns?: string[];
  /**
   * Declared access patterns for enterprise systems this capability requires.
   * The runtime provisions governed adapters for these patterns at execution time.
   * The capability handler never receives raw system handles — only adapters.
   */
  accessPatterns: AccessPattern[];

  // -- Execution behavior --

  /**
   * Whether repeated invocations with identical input produce identical output
   * and identical side effects. Informs retry safety and deduplication logic.
   * Set false conservatively — unsafe to retry non-idempotent capabilities.
   */
  idempotent: boolean;
  /**
   * Maximum wall-clock duration in milliseconds before the runtime times out
   * the invocation and returns a terminal "timeout" result.
   */
  timeoutMs: number;
  /**
   * Optional soft timeout in milliseconds. When elapsed, the runtime signals
   * the handler to begin cleanup before the hard `timeoutMs` deadline.
   * Must be strictly less than `timeoutMs` if present.
   */
  softTimeoutMs?: number;
  /** Execution policy governing concurrency, rate limits, and circuit breaking. */
  executionPolicy: CapabilityExecutionPolicy;

  // -- Retry --

  /** Policy governing automatic retry of failed invocations. */
  retryPolicy: CapabilityRetryPolicy;

  // -- Rollback --

  /**
   * Whether this capability supports rollback of its side effects after
   * a successful execution. When true, CapabilityExecutionResult carries
   * a `rollbackToken` that the runtime can present to trigger rollback.
   */
  rollbackSupported: boolean;

  // -- Approval --

  /**
   * Whether this capability unconditionally requires explicit approval before
   * the runtime will invoke its handler, regardless of Guardrail policy.
   * When true, `approvalRequirements` MUST be present.
   */
  requiresApproval: boolean;
  /**
   * Approval contract for this capability.
   * Required when `requiresApproval` is true. Describes who approves,
   * how many approvers are needed, and timeout behaviour.
   */
  approvalRequirements?: CapabilityApprovalRequirements;

  // -- Audit --

  /**
   * Audit requirements the runtime must satisfy for every invocation.
   * The capability handler does not write audit records — the runtime does.
   */
  auditRequirements: CapabilityAuditRequirements;

  // -- Lifecycle --

  /** Team, squad, or system that owns and maintains this capability. */
  owner: string;
  /** URI pointing to full capability documentation (runbook, API docs, etc.). */
  documentationUri?: string;
  /**
   * When set, this capability version is deprecated as of this timestamp.
   * The registry will surface deprecation warnings and route requests to
   * `replacedBy` if set.
   */
  deprecatedAt?: ISOTimestamp;
  /**
   * Capability ID that replaces this deprecated version.
   * The registry may automatically redirect callers when this is set.
   */
  replacedBy?: CapabilityId;

  // -- Extension --

  /** Domain-specific extension fields. Shape is owner-defined. */
  metadata?: Metadata;
}
