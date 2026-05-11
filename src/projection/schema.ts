/**
 * Decision Frame — Zod Schema Definitions
 *
 * Every field that exists on DecisionFrame (and its sub-objects) is represented
 * here as a composable Zod schema. These schemas are the authoritative source of
 * runtime validation; the TypeScript interfaces in src/types.ts document intent.
 *
 * Composition order (bottom-up):
 *   primitives → sub-object schemas → DecisionFrameSchema
 *
 * Usage:
 *   import { DecisionFrameSchema } from "./schema.js";
 *   const result = DecisionFrameSchema.safeParse(untrustedInput);
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Primitive schemas
// ---------------------------------------------------------------------------

/**
 * Stable identifier. UUIDs are recommended; ULID and nanoid are also accepted.
 * Deliberately not constrained to UUID format to remain format-agnostic.
 */
export const IDSchema = z
  .string()
  .min(1, "ID must not be empty")
  .describe("Stable identifier (UUID v4 recommended)");

/**
 * ISO-8601 timestamp with timezone offset (e.g. "2026-05-10T14:30:00Z").
 * Zod enforces the presence of the time component and a UTC offset.
 */
export const ISOTimestampSchema = z
  .string()
  .datetime({ offset: true, message: "Must be an ISO-8601 timestamp with timezone offset" })
  .describe("ISO-8601 timestamp with timezone offset");

/**
 * AI confidence score. 0.0 = no confidence; 1.0 = full confidence.
 * Values outside this range indicate a bug in the reasoning layer.
 */
export const ConfidenceScoreSchema = z
  .number()
  .min(0, "Confidence score must be ≥ 0.0")
  .max(1, "Confidence score must be ≤ 1.0")
  .describe("Confidence score 0.0–1.0");

// ---------------------------------------------------------------------------
// RetrievalResult
// ---------------------------------------------------------------------------

/**
 * A single item surfaced by the retrieval subsystem.
 * Retrieval results bound the AI's knowledge surface within the frame.
 */
export const RetrievalResultSchema = z
  .object({
    sourceId: IDSchema.describe("Identifier of the retrieval source"),
    sourceType: z
      .enum(["document", "database", "api", "telemetry", "memory"])
      .describe("Category of the source system"),
    content: z
      .unknown()
      .describe("Opaque content payload; shape is governed by sourceType"),
    relevanceScore: ConfidenceScoreSchema.describe(
      "Relevance of this result to the frame intent (0.0–1.0)"
    ),
    retrievedAt: ISOTimestampSchema.describe("When this result was fetched"),
    uri: z
      .string()
      .url("uri must be a valid URL")
      .optional()
      .describe("Optional citation URI for downstream traceability"),
  })
  .describe("A single retrieval result injected into the Decision Frame");

export type RetrievalResult = z.infer<typeof RetrievalResultSchema>;

// ---------------------------------------------------------------------------
// TelemetrySnapshot
// ---------------------------------------------------------------------------

/**
 * Point-in-time operational telemetry snapshot.
 * Provides the AI with live system signals without granting direct data-plane
 * access.
 */
export const TelemetrySnapshotSchema = z
  .object({
    capturedAt: ISOTimestampSchema.describe("When these metrics were sampled"),
    metrics: z
      .record(z.string().min(1), z.number())
      .describe("Named numeric metrics (e.g. { error_rate: 0.02, latency_p99: 140 })"),
    signals: z
      .record(z.string().min(1), z.unknown())
      .describe("Named signals of any type (e.g. deployment status, feature flags)"),
    source: z
      .string()
      .min(1, "Telemetry source must not be empty")
      .describe("System or data plane that produced these metrics"),
  })
  .describe("Operational telemetry snapshot included in the Decision Frame");

export type TelemetrySnapshot = z.infer<typeof TelemetrySnapshotSchema>;

// ---------------------------------------------------------------------------
// PolicyConstraint
// ---------------------------------------------------------------------------

const PolicyOperatorSchema = z.enum([
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

/**
 * A scoped constraint applied to AI reasoning within a Decision Frame.
 * Constraints are structured policy rules the runtime can evaluate
 * against ExecutionRequests produced by the AI.
 */
export const PolicyConstraintSchema = z
  .object({
    constraintId: IDSchema.describe("Unique identifier for this constraint"),
    description: z
      .string()
      .min(1, "Constraint description must not be empty")
      .describe("Human-readable explanation shown to the AI in the frame"),
    field: z
      .string()
      .min(1, "Field path must not be empty")
      .describe(
        "JSONPath-style reference on ExecutionRequest or Capability (e.g. 'confidence')"
      ),
    operator: PolicyOperatorSchema.describe("Comparison operator applied to the field value"),
    value: z.unknown().describe("The right-hand side value for the comparison"),
  })
  .describe("A structured policy constraint on AI reasoning within this frame");

export type PolicyConstraint = z.infer<typeof PolicyConstraintSchema>;

// ---------------------------------------------------------------------------
// ApprovalRequirement
// ---------------------------------------------------------------------------

/**
 * Specifies an approval gate that must be cleared before certain executions
 * proceed. Approval requirements are evaluated by the runtime's approval
 * workflow before any Guardrail-passing request is executed.
 */
export const ApprovalRequirementSchema = z
  .object({
    requirementId: IDSchema.describe("Unique identifier for this approval gate"),
    reason: z
      .string()
      .min(1, "Approval reason must not be empty")
      .describe("Human-readable explanation of why approval is required"),
    approverRole: z
      .string()
      .min(1, "Approver role must not be empty")
      .describe("Role or identity class that may approve (e.g. 'finance-lead')"),
    timeoutMs: z
      .number()
      .int("Timeout must be an integer number of milliseconds")
      .positive("Timeout must be greater than zero")
      .describe("Maximum wait time for approval before the request is denied"),
    denyOnTimeout: z
      .boolean()
      .describe("If true, the request is denied when the timeout elapses"),
  })
  .describe("An approval gate the runtime must clear before executing");

export type ApprovalRequirement = z.infer<typeof ApprovalRequirementSchema>;

// ---------------------------------------------------------------------------
// ExecutionBoundary
// ---------------------------------------------------------------------------

/**
 * Hard limits placed on what a Decision Frame may trigger.
 * The runtime enforces these limits mechanically; the AI cannot override them.
 */
export const ExecutionBoundarySchema = z
  .object({
    allowedCapabilityIds: z
      .array(IDSchema)
      .describe(
        "Capability IDs the runtime may invoke within this frame. " +
          "Must be a subset of DecisionFrame.authorizedCapabilityIds."
      ),
    maxExecutions: z
      .number()
      .int("maxExecutions must be an integer")
      .positive("maxExecutions must be greater than zero")
      .describe("Maximum number of capability invocations allowed in this frame's lifetime"),
    frameTtlMs: z
      .number()
      .int("frameTtlMs must be an integer")
      .positive("frameTtlMs must be greater than zero")
      .describe("Maximum wall-clock lifetime of this frame in milliseconds"),
    allowCascade: z
      .boolean()
      .describe("Whether chained or sub-executions are permitted within this frame"),
  })
  .describe("Hard execution limits enforced by the runtime for this frame");

export type ExecutionBoundary = z.infer<typeof ExecutionBoundarySchema>;

// ---------------------------------------------------------------------------
// FrameAuditMetadata
// ---------------------------------------------------------------------------

const FrameTriggerSourceSchema = z.enum([
  "user-request",
  "workflow-continuation",
  "scheduled",
  "system",
  "api",
]);

/**
 * Provenance and governance metadata written at frame-construction time.
 * Recorded verbatim in every AuditRecord that references this frame.
 * Immutable after construction.
 */
export const FrameAuditMetadataSchema = z
  .object({
    triggerSource: FrameTriggerSourceSchema.describe(
      "What initiated construction of this Decision Frame"
    ),
    projectionVersion: z
      .string()
      .min(1, "Projection version must not be empty")
      .describe("Semantic version of the Projection layer that built this frame"),
    policySetVersion: z
      .string()
      .min(1, "Policy set version must not be empty")
      .describe("Version identifier of the active policy set at construction time"),
    correlationId: IDSchema.optional().describe(
      "Stable ID linking all frames in a multi-step workflow chain"
    ),
    tags: z
      .array(z.string().min(1))
      .describe(
        "Labels for audit filtering and classification (e.g. ['high-risk', 'financial'])"
      ),
    notes: z
      .string()
      .optional()
      .describe("Free-form construction-time notes from the Projection layer"),
  })
  .describe("Provenance and governance metadata written at frame-construction time");

export type FrameAuditMetadata = z.infer<typeof FrameAuditMetadataSchema>;

// ---------------------------------------------------------------------------
// DecisionFrame  (the root schema)
// ---------------------------------------------------------------------------

/**
 * Decision Frame schema — the complete bounded operational context object.
 *
 * A Decision Frame is the governed runtime artifact constructed by the
 * Projection layer. It defines:
 *   - what the AI knows        (operationalState, retrievalResults, telemetry)
 *   - what the AI may do       (authorizedCapabilityIds, executionBoundaries)
 *   - the rules it must follow (policyConstraints, approvalRequirements)
 *   - the provenance chain     (principalId, sessionId, auditMetadata)
 *
 * The runtime accepts an ExecutionRequest from the AI only when the
 * referenced Decision Frame is valid, unexpired, and authorizes the
 * requested capability.
 *
 * Business rules (cross-field constraints) are enforced by the
 * validation layer in validate.ts, not by this schema.
 */
export const DecisionFrameSchema = z.object({
  // -- Identity --
  id: IDSchema.describe("Unique identifier for this Decision Frame (frameId)"),
  createdAt: ISOTimestampSchema.describe("When this frame was constructed by the Projection layer"),
  expiresAt: ISOTimestampSchema.describe(
    "When this frame expires; no ExecutionRequest may reference it after this time"
  ),

  // -- User intent --
  intent: z
    .string()
    .min(1, "Intent must not be empty")
    .describe("The user or system intent that caused this frame to be constructed"),

  // -- Session / workflow context --
  sessionId: IDSchema.describe("Session this frame was issued within"),
  workflowId: IDSchema.optional().describe(
    "Workflow this frame belongs to, if part of a multi-step process"
  ),
  workflowStep: z
    .string()
    .min(1)
    .optional()
    .describe("Named step within the workflow (e.g. 'gather-context', 'approve-deployment')"),

  // -- Operational context --
  operationalState: z
    .record(z.string().min(1), z.unknown())
    .describe(
      "Current state of the workflow or process being reasoned about. " +
        "Shape is domain-specific; the AI reasons against this without direct data-plane access."
    ),

  // -- Retrieval context --
  retrievalResults: z
    .array(RetrievalResultSchema)
    .describe(
      "Items surfaced by the retrieval subsystem. Bound the AI's knowledge " +
        "surface to authorized and relevant enterprise data."
    ),

  // -- Telemetry references --
  telemetry: TelemetrySnapshotSchema.describe(
    "Live operational telemetry snapshot. Provides system signals without " +
      "granting direct data-plane access to the AI."
  ),

  // -- Authorized capabilities --
  authorizedCapabilityIds: z
    .array(IDSchema)
    .describe(
      "IDs of Capabilities the AI is authorized to invoke in this frame. " +
        "The runtime rejects any ExecutionRequest targeting a capability not in this list."
    ),

  // -- Execution constraints --
  policyConstraints: z
    .array(PolicyConstraintSchema)
    .describe(
      "Structured constraints the AI must respect when reasoning. " +
        "Each constraint is evaluable against the ExecutionRequests the AI produces."
    ),
  executionBoundaries: ExecutionBoundarySchema.describe(
    "Hard execution limits enforced by the runtime. The AI cannot override these."
  ),

  // -- Approval requirements --
  approvalRequirements: z
    .array(ApprovalRequirementSchema)
    .describe(
      "Approval gates required before certain executions proceed. " +
        "The runtime routes requests through these gates before invoking any Capability."
    ),

  // -- Principal / authorization --
  principalId: IDSchema.describe(
    "The identity (user, service account, agent) this frame was issued to"
  ),
  entitlements: z
    .array(z.string().min(1))
    .describe(
      "Entitlement tokens the principal holds at frame-creation time. " +
        "Snapshotted at construction so revocations cannot affect in-flight frames."
    ),

  // -- Memory --
  contextualMemoryRefs: z
    .array(IDSchema)
    .describe("References to contextual memory entries the AI may cite when reasoning"),

  // -- Audit metadata --
  auditMetadata: FrameAuditMetadataSchema.describe(
    "Provenance and governance metadata written at frame-construction time. Immutable."
  ),

  // -- Extension --
  metadata: z
    .record(z.string().min(1), z.unknown())
    .describe("Arbitrary extension payload for domain-specific frame data"),
});

/** The TypeScript type inferred from DecisionFrameSchema. Compatible with src/types.ts#DecisionFrame. */
export type DecisionFrame = z.infer<typeof DecisionFrameSchema>;

/**
 * The raw input shape accepted by DecisionFrameSchema.safeParse().
 * Identical to DecisionFrame for this schema (no transforms are applied).
 */
export type DecisionFrameInput = z.input<typeof DecisionFrameSchema>;
