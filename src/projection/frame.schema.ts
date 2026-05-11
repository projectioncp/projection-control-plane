/**
 * Decision Frame — Zod Validation Schemas
 *
 * Runtime validation schemas for every interface defined in frame.ts.
 * These schemas are the authoritative source of runtime type enforcement;
 * the interfaces in frame.ts are the authoritative source of static types.
 *
 * Both must agree. If they diverge, frame.ts wins — update the schema to match.
 *
 * Composition order (bottom-up, matching frame.ts):
 *   primitives → sub-object schemas → DecisionFrameSchema
 *
 * Each schema:
 *   - Uses .describe() on every field (self-documenting, reflects in JSON Schema)
 *   - Is exported individually so sub-schemas can be composed elsewhere
 *   - Exports an inferred TypeScript type (prefixed with the schema name)
 *
 * Business-rule validation (cross-field constraints, temporal ordering, etc.)
 * is NOT in this file — it belongs in validate.ts.
 *
 * Usage:
 *   import { DecisionFrameSchema } from "./frame.schema.js";
 *   const result = DecisionFrameSchema.safeParse(untrustedInput);
 *   if (result.success) { const frame: DecisionFrame = result.data; }
 */

import { z } from "zod";
import type {
  CapabilityCategory,
  ConstraintOperator,
  IntentCategory,
  ApprovalTrigger,
  RetrievalSourceType,
  RetrievalStrategy,
  TelemetrySourceType,
  FrameTriggerSource,
} from "./frame.js";

// ---------------------------------------------------------------------------
// Primitive schemas
// ---------------------------------------------------------------------------

/**
 * Stable identifier. UUIDs are recommended (v4 or v7); ULID and nanoid accepted.
 * Not constrained to UUID format to keep the schema format-agnostic.
 */
export const FrameIdSchema = z
  .string()
  .min(1, "frameId must not be empty")
  .describe("Stable frame identifier (UUID v4 recommended)");

/**
 * ISO-8601 timestamp with timezone offset.
 * Zod enforces: time component present, UTC offset present.
 * Example: "2026-05-10T14:30:00.000Z"
 */
export const ISOTimestampSchema = z
  .string()
  .datetime({ offset: true, message: "Must be an ISO-8601 timestamp with timezone offset" })
  .describe("ISO-8601 timestamp with timezone offset");

/**
 * AI confidence score: [0.0, 1.0].
 * 0.0 = no confidence. 1.0 = full confidence.
 */
export const ConfidenceScoreSchema = z
  .number()
  .min(0, "Confidence score must be ≥ 0.0")
  .max(1, "Confidence score must be ≤ 1.0")
  .describe("Confidence score in [0.0, 1.0]");

/** Open key-value extension payload. */
export const MetadataSchema = z
  .record(z.string().min(1), z.unknown())
  .describe("Arbitrary domain-specific extension payload");

// ---------------------------------------------------------------------------
// Shared vocabulary schemas
// ---------------------------------------------------------------------------

export const IntentCategorySchema: z.ZodType<IntentCategory> = z.enum([
  "query",
  "action",
  "decision",
  "approval",
  "analysis",
  "orchestration",
  "simulation",
]);

export const CapabilityCategorySchema: z.ZodType<CapabilityCategory> = z.enum([
  "workflow",
  "analytics",
  "forecasting",
  "scheduling",
  "simulation",
  "operational",
  "deployment",
  "approval",
  "notification",
]);

export const ConstraintOperatorSchema: z.ZodType<ConstraintOperator> = z.enum([
  "eq",
  "neq",
  "gt",
  "lt",
  "gte",
  "lte",
  "in",
  "not-in",
  "contains",
  "regex",
]);

export const ApprovalTriggerSchema: z.ZodType<ApprovalTrigger> = z.enum([
  "always",
  "confidence-below",
  "capability-match",
  "risk-threshold",
]);

export const RetrievalSourceTypeSchema: z.ZodType<RetrievalSourceType> = z.enum([
  "document",
  "database",
  "api",
  "telemetry",
  "memory",
  "cache",
]);

export const RetrievalStrategySchema: z.ZodType<RetrievalStrategy> = z.enum([
  "semantic",
  "keyword",
  "hybrid",
  "exact",
  "graph",
]);

export const TelemetrySourceTypeSchema: z.ZodType<TelemetrySourceType> = z.enum([
  "metrics",
  "traces",
  "logs",
  "events",
  "synthetic",
]);

export const FrameTriggerSourceSchema: z.ZodType<FrameTriggerSource> = z.enum([
  "user-request",
  "workflow-continuation",
  "scheduled",
  "system",
  "api",
]);

// ---------------------------------------------------------------------------
// UserIntent
// ---------------------------------------------------------------------------

/**
 * Schema for UserIntent.
 *
 * `raw` is always required — it is the verbatim input.
 * All other fields are populated by the Projection layer during construction.
 */
export const UserIntentSchema = z
  .object({
    raw: z
      .string()
      .min(1, "userIntent.raw must not be empty")
      .describe("Verbatim user or system input that triggered frame construction"),
    normalized: z
      .string()
      .min(1)
      .optional()
      .describe("Canonicalized form of the intent, produced by the Projection layer"),
    category: IntentCategorySchema
      .optional()
      .describe("Broad classification of the intent type"),
    interpretationConfidence: ConfidenceScoreSchema
      .optional()
      .describe("Projection layer's confidence in its interpretation of the raw intent (0.0–1.0)"),
    entities: z
      .record(z.string().min(1), z.unknown())
      .optional()
      .describe("Named entities extracted from the raw intent during parsing"),
  })
  .describe("The user or system intent that triggered this Decision Frame");

export type UserIntentSchema = z.infer<typeof UserIntentSchema>;

// ---------------------------------------------------------------------------
// ProjectedContext
// ---------------------------------------------------------------------------

/**
 * Schema for ProjectedContext.
 *
 * Validates that `entitlements` is a non-empty array of non-empty strings,
 * `principalId` is a non-empty string, and `operationalState` is a
 * non-empty key map (domain-specific values).
 */
export const ProjectedContextSchema = z
  .object({
    sessionId: z
      .string()
      .min(1, "projectedContext.sessionId must not be empty")
      .describe("Session this frame was issued within"),
    principalId: z
      .string()
      .min(1, "projectedContext.principalId must not be empty")
      .describe("Principal on whose behalf this frame was constructed"),
    entitlements: z
      .array(z.string().min(1, "Each entitlement token must be a non-empty string"))
      .describe("Entitlement tokens snapshotted at frame-construction time"),
    workflowId: z
      .string()
      .min(1)
      .optional()
      .describe("Workflow this frame belongs to, if part of a multi-step process"),
    workflowStep: z
      .string()
      .min(1)
      .optional()
      .describe("Named step within the workflow (e.g. 'gather-context', 'approve-deployment')"),
    operationalState: z
      .record(z.string().min(1), z.unknown())
      .describe(
        "Current state of the workflow or process being reasoned about. " +
        "The Projection layer selects and scopes which fields are visible."
      ),
    environmentScope: z
      .array(z.string().min(1))
      .optional()
      .describe("Environment scope tags (e.g. ['production', 'us-east-1'])"),
    metadata: MetadataSchema
      .optional()
      .describe("Domain-specific extension fields for projected context"),
  })
  .describe(
    "The bounded operational context projected to this frame's reasoning surface"
  );

export type ProjectedContextSchema = z.infer<typeof ProjectedContextSchema>;

// ---------------------------------------------------------------------------
// CapabilityRef
// ---------------------------------------------------------------------------

/**
 * Schema for a single CapabilityRef.
 *
 * `version` is validated as a non-empty string; callers may apply semver
 * enforcement above this layer.
 */
export const CapabilityRefSchema = z
  .object({
    capabilityId: z
      .string()
      .min(1, "capabilityRef.capabilityId must not be empty")
      .describe("Stable capability identifier matching the registry entry"),
    name: z
      .string()
      .min(1, "capabilityRef.name must not be empty")
      .describe("Human-readable capability name"),
    version: z
      .string()
      .min(1, "capabilityRef.version must not be empty")
      .describe("Semantic version string (e.g. '1.2.0')"),
    category: CapabilityCategorySchema
      .describe("Broad capability category"),
    requiredEntitlements: z
      .array(z.string().min(1))
      .describe("Entitlement tokens the invoking principal must hold"),
    requiresApproval: z
      .boolean()
      .describe("Whether invocation unconditionally requires explicit approval"),
    rollbackSupported: z
      .boolean()
      .describe("Whether the capability supports rollback after execution"),
    metadata: MetadataSchema
      .optional()
      .describe("Domain-specific extension fields for this capability reference"),
  })
  .describe(
    "A reference to a Capability the AI is authorized to invoke in this frame"
  );

export type CapabilityRefSchema = z.infer<typeof CapabilityRefSchema>;

// ---------------------------------------------------------------------------
// ExecutionConstraints
// ---------------------------------------------------------------------------

/**
 * Schema for FramePolicyConstraint.
 *
 * `value` is intentionally typed as `z.unknown()` — constraints target
 * domain-specific fields and values that the schema cannot pre-validate.
 */
export const FramePolicyConstraintSchema = z
  .object({
    constraintId: z
      .string()
      .min(1, "constraint.constraintId must not be empty")
      .describe("Unique identifier for this constraint within the frame"),
    description: z
      .string()
      .min(1, "constraint.description must not be empty")
      .describe("Human-readable explanation of what this constraint enforces"),
    field: z
      .string()
      .min(1, "constraint.field must not be empty")
      .describe(
        "Dot-notation path to the constrained field on ExecutionRequest " +
        "(e.g. 'confidence', 'input.amount', 'metadata.region')"
      ),
    operator: ConstraintOperatorSchema
      .describe("Comparison operator applied at runtime"),
    value: z
      .unknown()
      .optional()
      .describe("Right-hand side value for the comparison"),
  })
  .describe(
    "A policy constraint the Guardrail layer evaluates against each ExecutionRequest"
  );

export type FramePolicyConstraintSchema = z.infer<typeof FramePolicyConstraintSchema>;

/**
 * Schema for ExecutionConstraints.
 *
 * Enforces:
 *   - maxExecutions is a positive integer
 *   - frameTtlMs is a positive integer
 *   - confidenceFloor, if present, is in [0.0, 1.0]
 */
export const ExecutionConstraintsSchema = z
  .object({
    allowedCapabilityIds: z
      .array(z.string().min(1))
      .describe(
        "Capability IDs the runtime may invoke. " +
        "Must be a subset of DecisionFrame.authorizedCapabilities[].capabilityId."
      ),
    maxExecutions: z
      .number()
      .int("executionConstraints.maxExecutions must be an integer")
      .positive("executionConstraints.maxExecutions must be greater than zero")
      .describe("Maximum number of Capability invocations in this frame's lifetime"),
    frameTtlMs: z
      .number()
      .int("executionConstraints.frameTtlMs must be an integer")
      .positive("executionConstraints.frameTtlMs must be greater than zero")
      .describe("Maximum wall-clock lifetime of this frame in milliseconds"),
    allowCascade: z
      .boolean()
      .describe("Whether the AI may trigger chained or sub-executions"),
    confidenceFloor: ConfidenceScoreSchema
      .optional()
      .describe(
        "Minimum confidence score for any ExecutionRequest in this frame. " +
        "Requests below this floor are denied before policy evaluation."
      ),
    policyConstraints: z
      .array(FramePolicyConstraintSchema)
      .describe(
        "Structured constraints the Guardrail layer evaluates against each ExecutionRequest"
      ),
  })
  .describe(
    "Hard execution limits and per-request policy constraints for this Decision Frame"
  );

export type ExecutionConstraintsSchema = z.infer<typeof ExecutionConstraintsSchema>;

// ---------------------------------------------------------------------------
// ApprovalRequirement
// ---------------------------------------------------------------------------

/**
 * Schema for ApprovalRequirement.
 *
 * `timeoutMs` is enforced as a positive integer (milliseconds).
 */
export const ApprovalRequirementSchema = z
  .object({
    requirementId: z
      .string()
      .min(1, "approvalRequirement.requirementId must not be empty")
      .describe("Unique identifier for this approval gate within the frame"),
    reason: z
      .string()
      .min(1, "approvalRequirement.reason must not be empty")
      .describe("Human-readable explanation of why approval is required"),
    approverRole: z
      .string()
      .min(1, "approvalRequirement.approverRole must not be empty")
      .describe("Role or identity class that may grant approval (e.g. 'finance-lead')"),
    trigger: ApprovalTriggerSchema
      .optional()
      .describe("Condition under which this requirement activates. Defaults to 'always'."),
    timeoutMs: z
      .number()
      .int("approvalRequirement.timeoutMs must be an integer")
      .positive("approvalRequirement.timeoutMs must be greater than zero")
      .describe("Maximum wait time for approval in milliseconds"),
    denyOnTimeout: z
      .boolean()
      .describe("Whether the request is denied automatically when timeoutMs elapses"),
    capabilityScope: z
      .array(z.string().min(1))
      .optional()
      .describe(
        "If set, this requirement only applies to ExecutionRequests targeting " +
        "one of these capability IDs. Absent means applies to all."
      ),
  })
  .describe(
    "An approval gate the runtime must clear before an execution may proceed"
  );

export type ApprovalRequirementSchema = z.infer<typeof ApprovalRequirementSchema>;

// ---------------------------------------------------------------------------
// RetrievalContext
// ---------------------------------------------------------------------------

/**
 * Schema for a single RetrievalResult.
 *
 * `content` is `z.unknown()` — the shape is governed by `sourceType`
 * and validated by the consuming system, not by this generic schema.
 */
export const RetrievalResultSchema = z
  .object({
    sourceId: z
      .string()
      .min(1, "retrievalResult.sourceId must not be empty")
      .describe("Identifier of the source record or document"),
    sourceType: RetrievalSourceTypeSchema
      .describe("Category of the source system"),
    content: z
      .unknown()
      .describe("Opaque content payload; shape is governed by sourceType"),
    relevanceScore: ConfidenceScoreSchema
      .describe("Relevance of this result to the frame's userIntent (0.0–1.0)"),
    retrievedAt: ISOTimestampSchema
      .describe("When this result was fetched from the source system"),
    uri: z
      .string()
      .url("retrievalResult.uri must be a valid URL")
      .optional()
      .describe("Citation URI for traceability and attribution"),
    ttlSeconds: z
      .number()
      .int("retrievalResult.ttlSeconds must be an integer")
      .positive("retrievalResult.ttlSeconds must be greater than zero")
      .optional()
      .describe("Seconds until this result should be considered stale"),
    metadata: MetadataSchema
      .optional()
      .describe("Source-specific result extension fields"),
  })
  .describe("A single item surfaced by the retrieval subsystem into this frame");

export type RetrievalResultSchema = z.infer<typeof RetrievalResultSchema>;

/**
 * Schema for RetrievalContext.
 *
 * `retrievedAt` is required at the context level (when the retrieval
 * completed) and also on each individual result (when that result was fetched).
 */
export const RetrievalContextSchema = z
  .object({
    results: z
      .array(RetrievalResultSchema)
      .describe("Results surfaced into this frame by the retrieval subsystem"),
    strategy: RetrievalStrategySchema
      .optional()
      .describe("Strategy used by the retrieval subsystem"),
    totalCandidates: z
      .number()
      .int("retrievalContext.totalCandidates must be an integer")
      .nonnegative("retrievalContext.totalCandidates must be ≥ 0")
      .optional()
      .describe("Total candidates considered before filtering to this result set"),
    retrievedAt: ISOTimestampSchema
      .describe(
        "When the retrieval was completed. May differ from individual result timestamps."
      ),
  })
  .describe("The full retrieval context projected into this Decision Frame");

export type RetrievalContextSchema = z.infer<typeof RetrievalContextSchema>;

// ---------------------------------------------------------------------------
// TelemetryReference
// ---------------------------------------------------------------------------

/**
 * Schema for TelemetrySnapshot (inline snapshot within a TelemetryReference).
 */
export const TelemetrySnapshotSchema = z
  .object({
    metrics: z
      .record(z.string().min(1), z.number())
      .describe("Named numeric metrics at the time of capture"),
    signals: z
      .record(z.string().min(1), z.unknown())
      .describe("Named signals of any type (status strings, boolean flags, etc.)"),
  })
  .describe("Inline snapshot of telemetry values at a point in time");

export type TelemetrySnapshotSchema = z.infer<typeof TelemetrySnapshotSchema>;

/**
 * Schema for a single TelemetryReference.
 *
 * `capturedAt` must be a valid ISO-8601 timestamp.
 * `uri`, if present, must be a valid URL.
 */
export const TelemetryReferenceSchema = z
  .object({
    referenceId: z
      .string()
      .min(1, "telemetryReference.referenceId must not be empty")
      .describe("Unique reference identifier within this frame"),
    sourceSystem: z
      .string()
      .min(1, "telemetryReference.sourceSystem must not be empty")
      .describe("System or data plane that produced this telemetry"),
    sourceType: TelemetrySourceTypeSchema
      .describe("Category of telemetry data"),
    metricKeys: z
      .array(z.string().min(1))
      .min(1, "telemetryReference.metricKeys must contain at least one key")
      .describe(
        "Metric or signal keys available from this source. " +
        "Lets the AI know what signals it may reason about."
      ),
    capturedAt: ISOTimestampSchema
      .describe("When these signals were captured"),
    uri: z
      .string()
      .url("telemetryReference.uri must be a valid URL")
      .optional()
      .describe("URI to the full telemetry payload for richer access"),
    snapshot: TelemetrySnapshotSchema
      .optional()
      .describe(
        "Inline snapshot of high-priority metrics. Present when the Projection layer " +
        "has pre-fetched values to avoid an additional round-trip during reasoning."
      ),
  })
  .describe(
    "A reference to a telemetry data source included in this Decision Frame"
  );

export type TelemetryReferenceSchema = z.infer<typeof TelemetryReferenceSchema>;

// ---------------------------------------------------------------------------
// FrameAuditMetadata
// ---------------------------------------------------------------------------

/**
 * Schema for FrameAuditMetadata.
 *
 * `tags` must be an array of non-empty strings (empty tag strings are rejected).
 */
export const FrameAuditMetadataSchema = z
  .object({
    triggerSource: FrameTriggerSourceSchema
      .describe("What caused this frame to be constructed"),
    projectionVersion: z
      .string()
      .min(1, "auditMetadata.projectionVersion must not be empty")
      .describe("Semantic version of the Projection layer that built this frame"),
    policySetVersion: z
      .string()
      .min(1, "auditMetadata.policySetVersion must not be empty")
      .describe("Version of the policy set active at construction time"),
    correlationId: z
      .string()
      .min(1)
      .optional()
      .describe("Stable ID linking all frames in the same multi-step workflow chain"),
    tags: z
      .array(z.string().min(1, "Each tag must be a non-empty string"))
      .describe(
        "Classification labels for audit filtering and alerting " +
        "(e.g. ['high-risk', 'financial', 'prod'])"
      ),
    notes: z
      .string()
      .optional()
      .describe("Free-form construction-time notes from the Projection layer"),
  })
  .describe(
    "Immutable provenance and governance metadata written at frame-construction time"
  );

export type FrameAuditMetadataSchema = z.infer<typeof FrameAuditMetadataSchema>;

// ---------------------------------------------------------------------------
// DecisionFrame — root schema
// ---------------------------------------------------------------------------

/**
 * DecisionFrameSchema — the complete Decision Frame validation schema.
 *
 * Validates the full structure of a Decision Frame, including all sub-objects.
 * Cross-field business rules (temporal ordering, capability subset checks,
 * duplicate ID detection, etc.) are enforced by validate.ts, not here.
 *
 * Each field maps directly to a field in the DecisionFrame interface (frame.ts).
 */
export const DecisionFrameSchema = z
  .object({
    // -- Identity & lifecycle --
    frameId: FrameIdSchema
      .describe("Unique identifier for this frame (UUID v4 recommended)"),
    createdAt: ISOTimestampSchema
      .describe("When the Projection layer constructed this frame"),
    expiresAt: ISOTimestampSchema
      .describe(
        "When this frame expires. Must be strictly after createdAt. " +
        "No ExecutionRequest may reference this frame after this time."
      ),

    // -- Intent --
    userIntent: UserIntentSchema
      .describe(
        "The user or system intent that caused this frame to be constructed"
      ),

    // -- Operational context --
    projectedContext: ProjectedContextSchema
      .describe(
        "The bounded operational context projected to this frame's reasoning surface"
      ),

    // -- Authorization --
    authorizedCapabilities: z
      .array(CapabilityRefSchema)
      .describe(
        "Capabilities the AI is authorized to invoke within this frame. " +
        "Carries full entitlement and approval metadata for runtime enforcement."
      ),

    // -- Governance --
    executionConstraints: ExecutionConstraintsSchema
      .describe(
        "Hard execution limits and per-request policy constraints. " +
        "The Guardrail pipeline enforces these before any Capability executes."
      ),
    approvalRequirements: z
      .array(ApprovalRequirementSchema)
      .describe(
        "Approval gates placed by the Projection layer. " +
        "The Guardrail approval stage and approval routing service consume these."
      ),

    // -- Knowledge surface --
    retrievalContext: RetrievalContextSchema
      .describe(
        "Retrieval results and metadata projected into this frame. " +
        "Bounds the AI's knowledge to authorized enterprise data."
      ),
    telemetryReferences: z
      .array(TelemetryReferenceSchema)
      .describe(
        "References to operational telemetry data sources. " +
        "May include inline snapshots for high-priority signals."
      ),

    // -- Provenance --
    auditMetadata: FrameAuditMetadataSchema
      .describe(
        "Immutable provenance metadata recorded at construction time. " +
        "Included verbatim in every AuditRecord referencing this frame."
      ),

    // -- Extension --
    metadata: MetadataSchema
      .optional()
      .describe("Domain-specific extension fields"),
  })
  .describe(
    "A Decision Frame — bounded operational context projected to the AI runtime. " +
    "The AI reasons inside this frame and cannot access enterprise systems directly."
  );

/** TypeScript type inferred from DecisionFrameSchema. Aligns with frame.ts#DecisionFrame. */
export type DecisionFrameOutput = z.output<typeof DecisionFrameSchema>;

/** Raw input shape accepted by DecisionFrameSchema.safeParse(). */
export type DecisionFrameInput = z.input<typeof DecisionFrameSchema>;
