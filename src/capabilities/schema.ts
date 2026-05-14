/**
 * Capability — Zod Validation Schemas
 *
 * Runtime validation schemas for every interface defined in capability.ts,
 * execution.ts, and registry.ts.
 *
 * The interfaces in those files are the authoritative static types.
 * These schemas enforce them at runtime (deserialization, API boundaries,
 * registry registration).
 *
 * Composition order (bottom-up):
 *   primitives → sub-policy schemas → Capability → execution → registry types
 *
 * Business-rule validation (e.g. softTimeoutMs < timeoutMs, minimumApprovers ≤
 * approverRoles.length, requiresApproval → approvalRequirements present) is NOT
 * here — it belongs in a separate validate.ts for the capabilities layer.
 */

import { z } from "zod";
import type {
  AccessPatternType,
  BackoffStrategy,
  CapabilityApprovalTrigger,
  CapabilityAuditLevel,
  CapabilityCategory,
  IsolationLevel,
  JsonSchemaType,
} from "./capability.js";
import type {
  CapabilityExecutionStatus,
} from "./execution.js";
import type {
  RegistrationStatus,
} from "./registry.js";

// ---------------------------------------------------------------------------
// Shared primitive schemas
// ---------------------------------------------------------------------------

export const CapabilityIdSchema = z
  .string()
  .min(1, "capabilityId must not be empty")
  .describe("Stable capability identifier");

export const SemverSchema = z
  .string()
  .min(1, "version must not be empty")
  .describe("Semantic version string (e.g. '1.2.0')");

export const EntitlementTokenSchema = z
  .string()
  .min(1, "Entitlement token must not be empty")
  .describe("Entitlement token string");

export const ISOTimestampSchema = z
  .string()
  .datetime({ offset: true, message: "Must be an ISO-8601 timestamp with timezone offset" })
  .describe("ISO-8601 timestamp with timezone offset");

export const ConfidenceScoreSchema = z
  .number()
  .min(0)
  .max(1)
  .describe("Confidence score in [0.0, 1.0]");

export const MetadataSchema = z
  .record(z.string().min(1), z.unknown())
  .describe("Arbitrary domain-specific extension payload");

export const PositiveIntSchema = z
  .number()
  .int()
  .positive();

export const NonNegativeIntSchema = z
  .number()
  .int()
  .nonnegative();

// ---------------------------------------------------------------------------
// Vocabulary enum schemas
// ---------------------------------------------------------------------------

export const JsonSchemaTypeSchema: z.ZodType<JsonSchemaType> = z.enum([
  "string", "number", "integer", "boolean", "array", "object", "null",
]);

export const CapabilityCategorySchema: z.ZodType<CapabilityCategory> = z.enum([
  "workflow", "analytics", "forecasting", "scheduling",
  "simulation", "operational", "deployment", "approval", "notification",
]);

export const AccessPatternTypeSchema: z.ZodType<AccessPatternType> = z.enum([
  "database-read", "database-write",
  "api-read", "api-write",
  "messaging", "workflow",
  "notification", "storage-read", "storage-write", "compute",
]);

export const IsolationLevelSchema: z.ZodType<IsolationLevel> = z.enum([
  "none", "queued", "exclusive",
]);

export const BackoffStrategySchema: z.ZodType<BackoffStrategy> = z.enum([
  "none", "linear", "exponential", "jitter",
]);

export const CapabilityAuditLevelSchema: z.ZodType<CapabilityAuditLevel> = z.enum([
  "minimal", "standard", "full", "forensic",
]);

export const CapabilityApprovalTriggerSchema: z.ZodType<CapabilityApprovalTrigger> = z.enum([
  "always", "first-time", "environment", "above-impact",
]);

export const CapabilityExecutionStatusSchema: z.ZodType<CapabilityExecutionStatus> = z.enum([
  "success", "failure", "partial", "timeout", "denied", "retrying",
]);

export const RegistrationStatusSchema: z.ZodType<RegistrationStatus> = z.enum([
  "registered", "updated", "rejected",
]);

// ---------------------------------------------------------------------------
// JsonSchemaProperty (recursive)
// ---------------------------------------------------------------------------

/**
 * Validates a JSON Schema property definition.
 * Uses z.lazy() for the recursive `properties` and `items` fields.
 */
export const JsonSchemaPropertySchema: z.ZodType<Record<string, unknown>> = z.lazy(() =>
  z.object({
    type: z.union([JsonSchemaTypeSchema, z.array(JsonSchemaTypeSchema)]).optional(),
    description: z.string().optional(),
    enum: z.array(z.unknown()).optional(),
    format: z.string().optional(),
    minimum: z.number().optional(),
    maximum: z.number().optional(),
    minLength: NonNegativeIntSchema.optional(),
    maxLength: NonNegativeIntSchema.optional(),
    pattern: z.string().optional(),
    items: JsonSchemaPropertySchema.optional(),
    properties: z.record(z.string().min(1), JsonSchemaPropertySchema).optional(),
    required: z.array(z.string().min(1)).optional(),
    nullable: z.boolean().optional(),
    default: z.unknown().optional(),
    examples: z.array(z.unknown()).optional(),
  }).passthrough() // allow additional JSON Schema keywords
);

// ---------------------------------------------------------------------------
// CapabilityIOSchema
// ---------------------------------------------------------------------------

/**
 * Validates a Capability input or output schema definition.
 * Top-level type is always "object".
 */
export const CapabilityIOSchemaSchema = z
  .object({
    type: z.literal("object").describe("Top-level type must be 'object'"),
    properties: z
      .record(z.string().min(1), JsonSchemaPropertySchema)
      .describe("Property definitions keyed by property name"),
    required: z
      .array(z.string().min(1))
      .optional()
      .describe("Required property names"),
    additionalProperties: z
      .boolean()
      .describe("Whether undeclared properties are allowed"),
    description: z.string().optional().describe("Human-readable schema description"),
    examples: z
      .array(z.record(z.string().min(1), z.unknown()))
      .optional()
      .describe("Example payloads for documentation and contract testing"),
  })
  .describe("Typed JSON Schema for capability input or output");

export type CapabilityIOSchemaOutput = z.infer<typeof CapabilityIOSchemaSchema>;

// ---------------------------------------------------------------------------
// AccessPattern
// ---------------------------------------------------------------------------

export const AccessPatternSchema = z
  .object({
    type: AccessPatternTypeSchema.describe("Category of system access"),
    systemName: z
      .string()
      .min(1, "accessPattern.systemName must not be empty")
      .describe("Logical name of the system being accessed"),
    rationale: z
      .string()
      .min(1, "accessPattern.rationale must not be empty")
      .describe("Why this access is required"),
    required: z
      .boolean()
      .describe("Whether the capability requires this access to function"),
    scopes: z
      .array(z.string().min(1))
      .optional()
      .describe("Scope restrictions applied when provisioning the adapter"),
  })
  .describe("Governed access pattern declaration");

// ---------------------------------------------------------------------------
// Execution policy sub-schemas
// ---------------------------------------------------------------------------

export const RateLimitPolicySchema = z
  .object({
    maxRequests: PositiveIntSchema.describe("Maximum invocations per window"),
    windowMs: PositiveIntSchema.describe("Window duration in milliseconds"),
    strategy: z
      .enum(["fixed-window", "sliding-window", "token-bucket"])
      .describe("Rate limiting algorithm"),
  })
  .describe("Rate limit applied to capability invocations");

export const CircuitBreakerPolicySchema = z
  .object({
    failureThreshold: PositiveIntSchema.describe(
      "Consecutive failures before circuit opens"
    ),
    successThreshold: PositiveIntSchema.describe(
      "Consecutive successes before circuit closes from half-open"
    ),
    halfOpenAfterMs: PositiveIntSchema.describe(
      "Milliseconds in OPEN state before attempting HALF-OPEN"
    ),
  })
  .describe("Circuit breaker policy protecting a downstream system");

export const CapabilityExecutionPolicySchema = z
  .object({
    isolationLevel: IsolationLevelSchema.optional().describe("Concurrency control mode"),
    rateLimit: RateLimitPolicySchema.optional(),
    circuitBreaker: CircuitBreakerPolicySchema.optional(),
    allowedEnvironments: z
      .array(z.string().min(1))
      .optional()
      .describe("Environments where this capability may be invoked"),
    prohibitedEnvironments: z
      .array(z.string().min(1))
      .optional()
      .describe("Environments where this capability must never be invoked"),
  })
  .describe("Execution policy governing concurrency, rate limits, and circuit breaking");

// ---------------------------------------------------------------------------
// Retry policy
// ---------------------------------------------------------------------------

export const CapabilityRetryPolicySchema = z
  .object({
    maxAttempts: PositiveIntSchema.describe(
      "Maximum total attempts (initial + retries). 1 = no retries."
    ),
    backoffStrategy: BackoffStrategySchema.describe("Backoff algorithm between attempts"),
    initialDelayMs: NonNegativeIntSchema.describe("Delay before first retry (ms)"),
    maxDelayMs: PositiveIntSchema.describe("Maximum delay cap (ms)"),
    retryableErrorCodes: z
      .array(z.string().min(1))
      .describe("Error codes that may trigger a retry"),
    nonRetryableErrorCodes: z
      .array(z.string().min(1))
      .optional()
      .describe("Error codes that must never be retried, even if in retryableErrorCodes"),
  })
  .describe("Retry policy for failed capability invocations");

// ---------------------------------------------------------------------------
// Audit requirements
// ---------------------------------------------------------------------------

export const CapabilityAuditRequirementsSchema = z
  .object({
    level: CapabilityAuditLevelSchema.describe("Required audit thoroughness"),
    retainForDays: PositiveIntSchema.describe("Minimum retention period in days"),
    captureInput: z
      .boolean()
      .describe("Whether the full input payload must be captured in audit records"),
    captureOutput: z
      .boolean()
      .describe("Whether the full output payload must be captured in audit records"),
    requireSignature: z
      .boolean()
      .describe("Whether audit records require a cryptographic signature"),
    notifyChannels: z
      .array(z.string().min(1))
      .optional()
      .describe("Notification channels alerted on each invocation"),
  })
  .describe("Audit requirements for every invocation of this capability");

// ---------------------------------------------------------------------------
// Approval requirements
// ---------------------------------------------------------------------------

export const CapabilityApprovalRequirementsSchema = z
  .object({
    trigger: CapabilityApprovalTriggerSchema.describe(
      "Condition under which the approval gate activates"
    ),
    approverRoles: z
      .array(z.string().min(1))
      .min(1, "At least one approver role is required")
      .describe("Roles that may approve this capability's invocation"),
    minimumApprovers: PositiveIntSchema.describe(
      "Minimum number of distinct approvers required (≥ 1)"
    ),
    timeoutMs: PositiveIntSchema.describe(
      "Maximum wait time for approval in milliseconds"
    ),
    denyOnTimeout: z
      .boolean()
      .describe("Whether the request is denied automatically on timeout"),
    rationale: z
      .string()
      .optional()
      .describe("Why this capability requires approval"),
  })
  .describe("Approval contract declared at the capability level");

// ---------------------------------------------------------------------------
// Capability (root schema)
// ---------------------------------------------------------------------------

/**
 * Validates a complete Capability definition.
 *
 * Note: cross-field business rules are not enforced here:
 *   - softTimeoutMs < timeoutMs
 *   - requiresApproval → approvalRequirements present
 *   - minimumApprovers ≤ approverRoles.length
 *   - forensic audit level → requiresApproval
 * These belong in the capabilities validate.ts layer.
 */
export const CapabilitySchema = z
  .object({
    // -- Identity --
    capabilityId: CapabilityIdSchema,
    name: z.string().min(1, "capability.name must not be empty").describe("Human-readable name"),
    description: z
      .string()
      .min(1, "capability.description must not be empty")
      .describe("Precise description for approvers and auditors"),
    category: CapabilityCategorySchema,
    version: SemverSchema,
    tags: z.array(z.string().min(1)).describe("Searchable classification labels"),

    // -- I/O contract --
    inputSchema: CapabilityIOSchemaSchema.describe(
      "JSON Schema for input validation (enforced before handler invocation)"
    ),
    outputSchema: CapabilityIOSchemaSchema.describe(
      "JSON Schema for output validation (enforced before result is returned)"
    ),

    // -- Authorization --
    requiredEntitlements: z
      .array(EntitlementTokenSchema)
      .describe("Entitlement tokens the principal must hold"),
    allowedPrincipalPatterns: z
      .array(z.string().min(1))
      .optional()
      .describe("Optional allowlist of principal ID regex patterns"),
    accessPatterns: z
      .array(AccessPatternSchema)
      .describe("Declared governed access patterns required at execution time"),

    // -- Execution --
    idempotent: z.boolean().describe("Whether identical inputs always produce identical side effects"),
    timeoutMs: PositiveIntSchema.describe("Hard timeout in milliseconds"),
    softTimeoutMs: PositiveIntSchema.optional().describe(
      "Soft timeout in milliseconds (must be < timeoutMs)"
    ),
    executionPolicy: CapabilityExecutionPolicySchema,

    // -- Retry --
    retryPolicy: CapabilityRetryPolicySchema,

    // -- Rollback --
    rollbackSupported: z.boolean().describe("Whether side effects can be rolled back"),

    // -- Approval --
    requiresApproval: z
      .boolean()
      .describe("Whether unconditional approval is required regardless of Guardrail policy"),
    approvalRequirements: CapabilityApprovalRequirementsSchema.optional().describe(
      "Required when requiresApproval is true"
    ),

    // -- Audit --
    auditRequirements: CapabilityAuditRequirementsSchema,

    // -- Lifecycle --
    owner: z.string().min(1, "capability.owner must not be empty").describe("Owning team or system"),
    documentationUri: z.string().url().optional().describe("URI to full documentation"),
    deprecatedAt: ISOTimestampSchema.optional().describe("When this version was deprecated"),
    replacedBy: CapabilityIdSchema.optional().describe("Capability that replaces this version"),

    // -- Extension --
    metadata: MetadataSchema.optional(),
  })
  .describe(
    "A deterministic, governed enterprise operation exposed to the AI runtime"
  );

export type CapabilityOutput = z.output<typeof CapabilitySchema>;
export type CapabilityInput = z.input<typeof CapabilitySchema>;

// ---------------------------------------------------------------------------
// CapabilityExecutionRequest schema
// ---------------------------------------------------------------------------

export const CapabilityExecutionRequestSchema = z
  .object({
    requestId: z.string().min(1).describe("Unique invocation attempt identifier"),
    capabilityId: CapabilityIdSchema,
    capabilityVersion: SemverSchema,
    input: z.record(z.string().min(1), z.unknown()).describe("Validated input payload"),
    principalId: z.string().min(1).describe("Invoking principal"),
    decisionFrameId: z.string().min(1).describe("Authorizing Decision Frame"),
    sessionId: z.string().min(1).describe("Session this invocation belongs to"),
    entitlements: z.array(EntitlementTokenSchema).describe("Snapshotted principal entitlements"),
    correlationId: z.string().min(1).optional(),
    idempotencyKey: z.string().min(1).optional(),
    requestedAt: ISOTimestampSchema,
    effectiveTimeoutMs: PositiveIntSchema,
    effectiveSoftTimeoutMs: PositiveIntSchema.optional(),
    attemptNumber: PositiveIntSchema.describe("Starts at 1 for initial invocation"),
    maxAttempts: PositiveIntSchema,
    previousAttemptId: z.string().min(1).optional(),
    metadata: MetadataSchema.optional(),
  })
  .describe("Runtime contract for invoking a capability handler");

export type CapabilityExecutionRequestOutput = z.output<typeof CapabilityExecutionRequestSchema>;

// ---------------------------------------------------------------------------
// CapabilityExecutionResult schema
// ---------------------------------------------------------------------------

export const CapabilityExecutionErrorSchema = z.object({
  code: z.string().min(1).describe("Machine-readable error code (SCREAMING_SNAKE_CASE)"),
  message: z.string().min(1).describe("Human-readable error description"),
  detail: z.record(z.string().min(1), z.unknown()).optional(),
  retryable: z.boolean().describe("Whether the runtime should consider retrying"),
  retryAfterMs: NonNegativeIntSchema.optional().describe("Minimum retry delay hint"),
});

export const CapabilityExecutionWarningSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  detail: z.record(z.string().min(1), z.unknown()).optional(),
});

export const DeclaredSideEffectSchema = z.object({
  type: z.string().min(1),
  systemName: z.string().min(1),
  description: z.string().min(1),
  rollbackPayload: z.unknown().optional(),
});

export const CapabilityExecutionResultSchema = z
  .object({
    requestId: z.string().min(1),
    capabilityId: CapabilityIdSchema,
    status: CapabilityExecutionStatusSchema,
    output: z.record(z.string().min(1), z.unknown()).optional(),
    error: CapabilityExecutionErrorSchema.optional(),
    warnings: z.array(CapabilityExecutionWarningSchema).optional(),
    sideEffects: z.array(DeclaredSideEffectSchema).optional(),
    attemptNumber: PositiveIntSchema,
    executionDurationMs: NonNegativeIntSchema,
    completedAt: ISOTimestampSchema,
    rollbackToken: z.string().min(1).optional(),
    auditRecordId: z.string().min(1).optional(),
    metadata: MetadataSchema.optional(),
  })
  .describe("Result of a capability invocation attempt");

export type CapabilityExecutionResultOutput = z.output<typeof CapabilityExecutionResultSchema>;

// ---------------------------------------------------------------------------
// Registry types
// ---------------------------------------------------------------------------

export const CapabilityFilterSchema = z
  .object({
    category: z
      .union([CapabilityCategorySchema, z.array(CapabilityCategorySchema)])
      .optional(),
    tags: z.array(z.string().min(1)).optional(),
    requiredEntitlements: z.array(EntitlementTokenSchema).optional(),
    requiresApproval: z.boolean().optional(),
    idempotent: z.boolean().optional(),
    rollbackSupported: z.boolean().optional(),
    excludeDeprecated: z.boolean().optional(),
    owner: z.string().min(1).optional(),
  })
  .describe("Filter predicates for capability list queries");

export const RegistrationResultSchema = z.object({
  status: RegistrationStatusSchema,
  capabilityId: CapabilityIdSchema,
  version: SemverSchema,
  reason: z.string().optional(),
});

export const CapabilityVersionInfoSchema = z.object({
  capabilityId: CapabilityIdSchema,
  version: SemverSchema,
  deprecated: z.boolean(),
  deprecatedAt: ISOTimestampSchema.optional(),
  replacedBy: CapabilityIdSchema.optional(),
  registeredAt: ISOTimestampSchema,
});
