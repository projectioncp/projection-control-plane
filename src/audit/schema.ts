/**
 * Audit Layer — Zod Validation Schemas
 *
 * Runtime validation schemas for every serializable audit type defined in types.ts.
 *
 * Scope — types covered:
 *   AuditEventSchema             — discriminated union of all 16 event variants
 *   AuditRecordSchema            — full AuditRecord (includes event, actor, chain)
 *   AuditTrailSummarySchema      — aggregate statistics over a trail
 *   AuditTrailSchema             — scoped ordered record collection
 *   ProjectionPhaseTraceSchema   — frame construction phase
 *   GuardrailPhaseTraceSchema    — guardrail pipeline phase
 *   ApprovalPhaseTraceSchema     — approval workflow phase
 *   CapabilityPhaseTraceSchema   — capability handler phase
 *   RollbackPhaseTraceSchema     — rollback phase
 *   HookExecutionSummarySchema   — per-stage hook aggregate
 *   ExecutionTraceSchema         — full end-to-end execution trace
 *
 * Types NOT covered (contain function fields or live runtime objects):
 *   None — every audit type is fully serializable.
 *
 * Note on z.ZodType<T> annotations:
 *   Under exactOptionalPropertyTypes, Zod's internal _type for optional fields
 *   is `T | undefined` (required key form), while TypeScript interfaces use
 *   `{ key?: T }` (optional key form). These are incompatible under z.ZodType<T>
 *   annotations on object schemas. Therefore:
 *     - z.ZodType<T> is used ONLY on vocabulary enum / string-union schemas.
 *     - Object schemas carry no z.ZodType<T> annotation.
 *     - z.discriminatedUnion requires raw ZodObject members — event variant
 *       schemas must NOT be wrapped in z.ZodType<T>.
 *
 * Composition order (bottom-up):
 *   primitive schemas
 *   → local enum schemas (guardrail pipeline types without their own schemas)
 *   → AuditActorSchema
 *   → 16 event variant schemas (raw z.object())
 *   → AuditEventSchema (z.discriminatedUnion)
 *   → AuditOutcomeSchema, AuditRecordSchema
 *   → AuditTrailSummarySchema, AuditTrailSchema
 *   → phase trace schemas → HookExecutionSummarySchema → ExecutionTraceSchema
 */

import { z } from "zod";
import {
  ConfidenceScoreSchema,
  FrameTriggerSourceSchema,
  IntentCategorySchema,
  ISOTimestampSchema,
  MetadataSchema,
} from "../projection/frame.schema.js";
import {
  PolicyDenyCodeSchema,
  PolicyViolationKindSchema,
  PolicyViolationSeveritySchema,
} from "../guardrail/policy/schema.js";
import {
  HookErrorSchema,
  HookIdSchema,
  HookOutcomeSchema,
  HookStageSchema,
  NonNegativeIntSchema,
} from "../hooks/schema.js";
import { CapabilityExecutionStatusSchema } from "../capabilities/schema.js";
import type {
  AuditEventType,
  AuditOutcome,
  AuditTrailScope,
  AuditTrailStatus,
  ApprovalResolution,
  ExecutionOutcome,
  RollbackOutcome,
} from "./types.js";
import type {
  GuardrailDecision,
  GuardrailDenyCode,
  StageName,
} from "../guardrail/types.js";

// ---------------------------------------------------------------------------
// Re-exported shared schemas
// ---------------------------------------------------------------------------

export {
  ISOTimestampSchema,
  MetadataSchema,
  ConfidenceScoreSchema,
  FrameTriggerSourceSchema,
};

// ---------------------------------------------------------------------------
// Local primitive schemas
// ---------------------------------------------------------------------------

export const AuditRecordIdSchema = z
  .string()
  .min(1, "recordId must not be empty")
  .describe("Stable audit record identifier");

export const TraceIdSchema = z
  .string()
  .min(1, "traceId must not be empty")
  .describe("Stable trace identifier shared by all records in one execution chain");

export const SpanIdSchema = z
  .string()
  .min(1, "spanId must not be empty")
  .describe("Span identifier for a single AuditRecord within a trace");

export const CapabilityIdSchema = z
  .string()
  .min(1, "capabilityId must not be empty")
  .describe("Stable capability identifier");

export const FrameIdSchema = z
  .string()
  .min(1, "frameId must not be empty")
  .describe("Stable Decision Frame identifier");

export const PositiveIntSchema = z.number().int().positive();

// ---------------------------------------------------------------------------
// Local vocabulary enum schemas
//
// The following types are defined in guardrail/types.ts but do not yet have
// Zod schemas in the guardrail module. They are defined here for audit use.
// z.ZodType<T> annotations are used because these are string-union types.
// ---------------------------------------------------------------------------

export const GuardrailPipelineDecisionSchema: z.ZodType<GuardrailDecision> = z.enum([
  "allow",
  "deny",
  "require-approval",
  "flag",
]);

export const GuardrailDenyCodeSchema: z.ZodType<GuardrailDenyCode> = z.enum([
  "FRAME_EXPIRED",
  "PRINCIPAL_MISMATCH",
  "CAPABILITY_NOT_IN_FRAME",
  "CAPABILITY_NOT_IN_BOUNDARY",
  "ENTITLEMENT_MISSING",
  "POLICY_DENY",
  "CONFIDENCE_BELOW_THRESHOLD",
  "FRAME_CONSTRAINT_VIOLATION",
  "NO_MATCHING_POLICY",
]);

export const StageNameSchema: z.ZodType<StageName> = z.enum([
  "authorization",
  "policy",
  "constraints",
  "approval",
]);

export const AuditEventTypeSchema: z.ZodType<AuditEventType> = z.enum([
  "frame-created",
  "frame-expired",
  "execution-requested",
  "guardrail-evaluated",
  "policy-evaluated",
  "entitlement-denied",
  "policy-violation",
  "approval-requested",
  "approval-granted",
  "approval-denied",
  "capability-executed",
  "execution-failed",
  "execution-timed-out",
  "rollback-initiated",
  "rollback-completed",
  "hook-triggered",
]);

export const AuditOutcomeSchema: z.ZodType<AuditOutcome> = z.enum([
  "success",
  "failure",
  "denied",
  "approved",
  "flagged",
  "pending",
  "timed-out",
  "rolled-back",
]);

export const AuditTrailScopeSchema: z.ZodType<AuditTrailScope> = z.enum([
  "frame",
  "execution-request",
  "session",
  "workflow",
  "policy-evaluation",
]);

export const AuditTrailStatusSchema: z.ZodType<AuditTrailStatus> = z.enum([
  "open",
  "closed",
  "sealed",
]);

export const ApprovalResolutionSchema: z.ZodType<ApprovalResolution> = z.enum([
  "granted",
  "denied",
  "timed-out",
  "pending",
]);

export const RollbackOutcomeSchema: z.ZodType<RollbackOutcome> = z.enum([
  "success",
  "failure",
  "partial",
  "pending",
]);

export const ExecutionOutcomeSchema: z.ZodType<ExecutionOutcome> = z.enum([
  "completed",
  "denied",
  "awaiting-approval",
  "failed",
  "rolled-back",
  "timed-out",
  "cancelled",
]);

// ---------------------------------------------------------------------------
// GuardrailFlag — local schema (no existing schema in guardrail module)
// ---------------------------------------------------------------------------

/**
 * Schema for GuardrailFlag from guardrail/types.ts.
 * Defined here because the guardrail module does not yet have a schema file
 * for its pipeline types.
 */
export const GuardrailFlagSchema = z
  .object({
    stage: StageNameSchema,
    reason: z.string().min(1),
    policyId: z.string().min(1).optional(),
  })
  .describe("Flag annotation accumulated by the Guardrail pipeline stage");

// ---------------------------------------------------------------------------
// AuditActor
// ---------------------------------------------------------------------------

export const AuditActorSchema = z
  .object({
    principalId: z.string().min(1, "actor.principalId must not be empty"),
    sessionId: z.string().min(1, "actor.sessionId must not be empty"),
    workflowId: z.string().min(1).optional(),
    correlationId: z.string().min(1).optional(),
  })
  .describe("Principal and session context embedded in every AuditRecord");

export type AuditActorOutput = z.output<typeof AuditActorSchema>;

// ---------------------------------------------------------------------------
// AuditEvent — individual variant schemas
//
// Each schema is a raw z.object() — no z.ZodType<T> wrapper.
// This is required for z.discriminatedUnion(), which needs direct ZodObject
// instances as members, not ZodType wrappers.
//
// All variants share a `type` field holding a z.literal() discriminant.
// ---------------------------------------------------------------------------

// -- Frame lifecycle --------------------------------------------------------

export const FrameCreatedEventSchema = z
  .object({
    type: z.literal("frame-created"),
    frameId: FrameIdSchema,
    triggerSource: FrameTriggerSourceSchema,
    intent: z.string().min(1, "intent must not be empty"),
    intentCategory: IntentCategorySchema.optional(),
    interpretationConfidence: ConfidenceScoreSchema.optional(),
    expiresAt: ISOTimestampSchema,
    projectionVersion: z.string().min(1),
    policySetVersion: z.string().min(1),
    authorizedCapabilityIds: z.array(CapabilityIdSchema),
    authorizedCapabilityCount: NonNegativeIntSchema,
    entitlements: z.array(z.string().min(1)),
    tags: z.array(z.string().min(1)),
  })
  .describe("Decision Frame was successfully constructed by the Projection layer");

export const FrameExpiredEventSchema = z
  .object({
    type: z.literal("frame-expired"),
    frameId: FrameIdSchema,
    scheduledExpiresAt: ISOTimestampSchema,
    reason: z.enum([
      "ttl-elapsed",
      "explicit-invalidation",
      "session-ended",
      "max-executions-reached",
    ]),
  })
  .describe("Decision Frame was invalidated");

// -- Execution request ------------------------------------------------------

export const ExecutionRequestedEventSchema = z
  .object({
    type: z.literal("execution-requested"),
    executionRequestId: z.string().min(1),
    frameId: FrameIdSchema,
    capabilityId: CapabilityIdSchema,
    capabilityVersion: z.string().min(1),
    confidence: ConfidenceScoreSchema,
    rationale: z.string().optional(),
    attemptNumber: PositiveIntSchema,
    idempotencyKey: z.string().min(1).optional(),
    parentRequestId: z.string().min(1).optional(),
  })
  .describe("AI submitted an ExecutionRequest");

// -- Guardrail pipeline -----------------------------------------------------

export const GuardrailEvaluatedEventSchema = z
  .object({
    type: z.literal("guardrail-evaluated"),
    executionRequestId: z.string().min(1),
    frameId: FrameIdSchema,
    decision: GuardrailPipelineDecisionSchema,
    stagesRan: z.array(StageNameSchema),
    denyCode: GuardrailDenyCodeSchema.optional(),
    denyReason: z.string().optional(),
    flags: z.array(GuardrailFlagSchema),
    evaluationDurationMs: NonNegativeIntSchema,
    policyId: z.string().min(1).optional(),
  })
  .describe("Guardrail pipeline produced its terminal decision");

export const PolicyEvaluatedEventSchema = z
  .object({
    type: z.literal("policy-evaluated"),
    evaluationId: z.string().min(1),
    executionRequestId: z.string().min(1),
    policyDecisionOutcome: z.enum(["allow", "deny", "require-approval", "flag"]),
    policyDenyCode: PolicyDenyCodeSchema.optional(),
    terminatingPolicyId: z.string().min(1).optional(),
    terminatingPolicyName: z.string().min(1).optional(),
    evaluatedPolicyCount: NonNegativeIntSchema,
    violationCount: NonNegativeIntSchema,
    flagCount: NonNegativeIntSchema,
    evaluationDurationMs: NonNegativeIntSchema,
  })
  .describe("Policy engine evaluation run completed");

// -- Authorization ----------------------------------------------------------

export const EntitlementDeniedEventSchema = z
  .object({
    type: z.literal("entitlement-denied"),
    executionRequestId: z.string().min(1),
    frameId: FrameIdSchema,
    capabilityId: CapabilityIdSchema,
    requiredEntitlement: z.string().min(1),
    principalEntitlements: z.array(z.string().min(1)),
  })
  .describe("Principal lacked a required capability entitlement");

export const PolicyViolationEventSchema = z
  .object({
    type: z.literal("policy-violation"),
    violationId: z.string().min(1),
    policyId: z.string().min(1),
    policyName: z.string().min(1),
    kind: PolicyViolationKindSchema,
    severity: PolicyViolationSeveritySchema,
    field: z.string().min(1).optional(),
    message: z.string().min(1),
    remediationHint: z.string().optional(),
    executionRequestId: z.string().min(1).optional(),
  })
  .describe("A policy rule breach was recorded during evaluation");

// -- Approval workflow ------------------------------------------------------

export const ApprovalRequestedEventSchema = z
  .object({
    type: z.literal("approval-requested"),
    executionRequestId: z.string().min(1),
    requirementId: z.string().min(1),
    approverRole: z.string().min(1),
    policyId: z.string().min(1).optional(),
    timeoutMs: PositiveIntSchema,
    denyOnTimeout: z.boolean(),
    requestedAt: ISOTimestampSchema,
  })
  .describe("An approval gate was opened for an ExecutionRequest");

export const ApprovalGrantedEventSchema = z
  .object({
    type: z.literal("approval-granted"),
    executionRequestId: z.string().min(1),
    requirementId: z.string().min(1),
    approverId: z.string().min(1),
    approverRole: z.string().min(1),
    grantedAt: ISOTimestampSchema,
    notes: z.string().optional(),
  })
  .describe("Approval was explicitly granted by a qualified approver");

export const ApprovalDeniedEventSchema = z
  .object({
    type: z.literal("approval-denied"),
    executionRequestId: z.string().min(1),
    requirementId: z.string().min(1),
    approverId: z.string().min(1).optional(),
    approverRole: z.string().min(1).optional(),
    deniedAt: ISOTimestampSchema,
    reason: z.enum(["explicit-denial", "timeout", "escalation"]),
    notes: z.string().optional(),
  })
  .describe("Approval was denied — by explicit decision, timeout, or escalation");

// -- Capability execution ---------------------------------------------------

export const CapabilityExecutedEventSchema = z
  .object({
    type: z.literal("capability-executed"),
    executionRequestId: z.string().min(1),
    capabilityId: CapabilityIdSchema,
    capabilityVersion: z.string().min(1),
    status: CapabilityExecutionStatusSchema,
    durationMs: NonNegativeIntSchema,
    attemptNumber: PositiveIntSchema,
    outputSchemaValid: z.boolean(),
    declaredSideEffectIds: z.array(z.string().min(1)).optional(),
  })
  .describe("Capability handler completed an invocation attempt");

export const ExecutionFailedEventSchema = z
  .object({
    type: z.literal("execution-failed"),
    executionRequestId: z.string().min(1),
    capabilityId: CapabilityIdSchema,
    capabilityVersion: z.string().min(1),
    errorCode: z.string().min(1),
    errorMessage: z.string().min(1),
    retryable: z.boolean(),
    attemptNumber: PositiveIntSchema,
    willRetry: z.boolean(),
    retryAfterMs: NonNegativeIntSchema.optional(),
  })
  .describe("Capability invocation terminated with a non-retriable error");

export const ExecutionTimedOutEventSchema = z
  .object({
    type: z.literal("execution-timed-out"),
    executionRequestId: z.string().min(1),
    capabilityId: CapabilityIdSchema,
    capabilityVersion: z.string().min(1),
    effectiveTimeoutMs: PositiveIntSchema,
    attemptNumber: PositiveIntSchema,
  })
  .describe("Hard timeout elapsed before the Capability handler returned");

// -- Rollback ---------------------------------------------------------------

export const RollbackInitiatedEventSchema = z
  .object({
    type: z.literal("rollback-initiated"),
    executionRequestId: z.string().min(1),
    capabilityId: CapabilityIdSchema,
    capabilityVersion: z.string().min(1),
    reason: z.string().min(1),
    initiatedBy: z.enum(["principal", "system", "hook", "operator"]),
    initiatorId: z.string().min(1).optional(),
    hookId: HookIdSchema.optional(),
  })
  .describe("Rollback was triggered for a prior capability execution");

export const RollbackCompletedEventSchema = z
  .object({
    type: z.literal("rollback-completed"),
    executionRequestId: z.string().min(1),
    capabilityId: CapabilityIdSchema,
    capabilityVersion: z.string().min(1),
    outcome: z.enum(["success", "failure", "partial"]),
    durationMs: NonNegativeIntSchema,
    errorCode: z.string().min(1).optional(),
    errorMessage: z.string().optional(),
  })
  .describe("Rollback handler completed");

// -- Hook lifecycle ---------------------------------------------------------

export const HookTriggeredEventSchema = z
  .object({
    type: z.literal("hook-triggered"),
    hookId: HookIdSchema,
    hookName: z.string().min(1),
    stage: HookStageSchema,
    outcome: HookOutcomeSchema,
    durationMs: NonNegativeIntSchema,
    error: HookErrorSchema.optional(),
    executionRequestId: z.string().min(1).optional(),
    capabilityId: CapabilityIdSchema.optional(),
  })
  .describe("A hook handler ran at a lifecycle stage");

// ---------------------------------------------------------------------------
// AuditEvent — discriminated union
//
// Discriminant field: "type".
// All members are raw ZodObject instances (no ZodType<T> wrapper) as required
// by z.discriminatedUnion. Not annotated with z.ZodType<AuditEvent> because
// AuditEvent is a structural union type, not a string-union alias.
// ---------------------------------------------------------------------------

export const AuditEventSchema = z
  .discriminatedUnion("type", [
    FrameCreatedEventSchema,
    FrameExpiredEventSchema,
    ExecutionRequestedEventSchema,
    GuardrailEvaluatedEventSchema,
    PolicyEvaluatedEventSchema,
    EntitlementDeniedEventSchema,
    PolicyViolationEventSchema,
    ApprovalRequestedEventSchema,
    ApprovalGrantedEventSchema,
    ApprovalDeniedEventSchema,
    CapabilityExecutedEventSchema,
    ExecutionFailedEventSchema,
    ExecutionTimedOutEventSchema,
    RollbackInitiatedEventSchema,
    RollbackCompletedEventSchema,
    HookTriggeredEventSchema,
  ])
  .describe("The payload of a single auditable governance event");

export type AuditEventOutput = z.output<typeof AuditEventSchema>;

// ---------------------------------------------------------------------------
// AuditRecord
// ---------------------------------------------------------------------------

export const AuditRecordSchema = z
  .object({
    // Identity
    recordId: AuditRecordIdSchema,

    // Distributed tracing
    traceId: TraceIdSchema,
    spanId: SpanIdSchema,
    parentSpanId: SpanIdSchema.optional(),
    sequenceNumber: PositiveIntSchema.describe(
      "Monotonically increasing within a trace; 1 = first record"
    ),

    // Timing
    timestamp: ISOTimestampSchema,

    // What happened
    event: AuditEventSchema,
    outcome: AuditOutcomeSchema,

    // Who
    actor: AuditActorSchema,

    // Cross-references
    frameId: FrameIdSchema.optional(),
    executionRequestId: z.string().min(1).optional(),
    capabilityId: CapabilityIdSchema.optional(),

    // Hash chain
    checksum: z
      .string()
      .min(1)
      .optional()
      .describe(
        "SHA-256 hex digest of the canonical JSON of this record with checksum fields nulled"
      ),
    previousChecksum: z
      .string()
      .min(1)
      .optional()
      .describe("checksum of the immediately preceding record in this trace"),

    // Extension
    metadata: MetadataSchema.optional(),
  })
  .describe("An immutable record of a single governance event in the runtime");

export type AuditRecordOutput = z.output<typeof AuditRecordSchema>;
export type AuditRecordInput = z.input<typeof AuditRecordSchema>;

// ---------------------------------------------------------------------------
// AuditTrailSummary
// ---------------------------------------------------------------------------

export const AuditTrailSummarySchema = z
  .object({
    totalRecords: NonNegativeIntSchema,
    byEventType: z
      .record(AuditEventTypeSchema, NonNegativeIntSchema)
      .describe("Record count by event type"),
    byOutcome: z
      .record(AuditOutcomeSchema, NonNegativeIntSchema)
      .describe("Record count by outcome"),
    firstEventAt: ISOTimestampSchema,
    lastEventAt: ISOTimestampSchema,
  })
  .describe("Aggregate statistics computed over an AuditTrail's record set");

export type AuditTrailSummaryOutput = z.output<typeof AuditTrailSummarySchema>;

// ---------------------------------------------------------------------------
// AuditTrail
// ---------------------------------------------------------------------------

export const AuditTrailSchema = z
  .object({
    // Identity
    trailId: z.string().min(1, "trailId must not be empty"),
    traceId: TraceIdSchema,

    // Scope
    scope: AuditTrailScopeSchema,
    scopeId: z.string().min(1, "scopeId must not be empty"),

    // Actor context
    principalId: z.string().min(1, "principalId must not be empty"),
    sessionId: z.string().min(1, "sessionId must not be empty"),
    workflowId: z.string().min(1).optional(),
    correlationId: z.string().min(1).optional(),

    // Records
    records: z
      .array(AuditRecordSchema)
      .readonly()
      .describe("All records in this trail, ordered by sequenceNumber ascending"),
    summary: AuditTrailSummarySchema,

    // Lifecycle
    status: AuditTrailStatusSchema,
    openedAt: ISOTimestampSchema,
    closedAt: ISOTimestampSchema.optional(),

    // Cryptographic seal
    sealedAt: ISOTimestampSchema.optional().describe(
      "When the trail was sealed; present only when status === 'sealed'"
    ),
    sealChecksum: z
      .string()
      .min(1)
      .optional()
      .describe(
        "SHA-256 hash of all record checksums concatenated in sequenceNumber order"
      ),

    metadata: MetadataSchema.optional(),
  })
  .describe(
    "A scoped, ordered collection of AuditRecords for a single dimension of operational activity"
  );

export type AuditTrailOutput = z.output<typeof AuditTrailSchema>;
export type AuditTrailInput = z.input<typeof AuditTrailSchema>;

// ---------------------------------------------------------------------------
// ExecutionTrace — phase schemas
// ---------------------------------------------------------------------------

export const ProjectionPhaseTraceSchema = z
  .object({
    frameId: FrameIdSchema,
    createdAt: ISOTimestampSchema,
    expiresAt: ISOTimestampSchema,
    projectionVersion: z.string().min(1),
    policySetVersion: z.string().min(1),
    triggerSource: FrameTriggerSourceSchema,
    authorizedCapabilityCount: NonNegativeIntSchema,
    intent: z.string().min(1),
    telemetryReferenceIds: z
      .array(z.string().min(1))
      .describe("IDs of TelemetryReferences included in the frame"),
  })
  .describe("Decision Frame construction phase of an execution trace");

export type ProjectionPhaseTraceOutput = z.output<typeof ProjectionPhaseTraceSchema>;

export const GuardrailPhaseTraceSchema = z
  .object({
    decision: GuardrailPipelineDecisionSchema,
    stagesRan: z.array(StageNameSchema),
    denyCode: GuardrailDenyCodeSchema.optional(),
    denyReason: z.string().optional(),
    flags: z.array(GuardrailFlagSchema),
    violationCount: NonNegativeIntSchema,
    evaluatedAt: ISOTimestampSchema,
    durationMs: NonNegativeIntSchema,
    policyEvaluationId: z.string().min(1).optional(),
  })
  .describe("Guardrail pipeline evaluation phase of an execution trace");

export type GuardrailPhaseTraceOutput = z.output<typeof GuardrailPhaseTraceSchema>;

export const ApprovalPhaseTraceSchema = z
  .object({
    requirementIds: z.array(z.string().min(1)).min(1),
    requestedAt: ISOTimestampSchema,
    resolution: ApprovalResolutionSchema,
    resolvedAt: ISOTimestampSchema.optional(),
    approverId: z.string().min(1).optional(),
    approverRole: z.string().min(1).optional(),
    durationMs: NonNegativeIntSchema.optional(),
    notes: z.string().optional(),
  })
  .describe("Approval workflow phase of an execution trace");

export type ApprovalPhaseTraceOutput = z.output<typeof ApprovalPhaseTraceSchema>;

export const CapabilityPhaseTraceSchema = z
  .object({
    capabilityId: CapabilityIdSchema,
    capabilityVersion: z.string().min(1),
    status: CapabilityExecutionStatusSchema,
    attemptCount: PositiveIntSchema,
    startedAt: ISOTimestampSchema,
    completedAt: ISOTimestampSchema.optional(),
    durationMs: NonNegativeIntSchema.optional(),
    errorCode: z.string().min(1).optional(),
    errorMessage: z.string().optional(),
    outputSchemaValid: z.boolean().optional(),
    declaredSideEffectIds: z.array(z.string().min(1)).optional(),
  })
  .describe("Capability handler invocation phase of an execution trace");

export type CapabilityPhaseTraceOutput = z.output<typeof CapabilityPhaseTraceSchema>;

export const RollbackPhaseTraceSchema = z
  .object({
    reason: z.string().min(1),
    initiatedBy: z.enum(["principal", "system", "hook", "operator"]),
    initiatorId: z.string().min(1).optional(),
    initiatedAt: ISOTimestampSchema,
    completedAt: ISOTimestampSchema.optional(),
    outcome: RollbackOutcomeSchema,
    durationMs: NonNegativeIntSchema.optional(),
    errorCode: z.string().min(1).optional(),
    errorMessage: z.string().optional(),
  })
  .describe("Rollback phase of an execution trace");

export type RollbackPhaseTraceOutput = z.output<typeof RollbackPhaseTraceSchema>;

// ---------------------------------------------------------------------------
// HookExecutionSummary
// ---------------------------------------------------------------------------

export const HookExecutionSummarySchema = z
  .object({
    stage: HookStageSchema,
    hookCount: NonNegativeIntSchema,
    durationMs: NonNegativeIntSchema,
    outcomeBreakdown: z
      .record(z.string(), NonNegativeIntSchema)
      .describe("Count of each HookOutcome value signalled at this stage"),
    errors: z
      .array(
        z.object({
          hookId: HookIdSchema,
          hookName: z.string().min(1),
          code: z.string().min(1),
          message: z.string().min(1),
        })
      )
      .describe("Error summaries from hooks that produced errors at this stage"),
  })
  .describe("Per-stage aggregate of hook executions during an execution lifecycle");

export type HookExecutionSummaryOutput = z.output<typeof HookExecutionSummarySchema>;

// ---------------------------------------------------------------------------
// ExecutionTrace
// ---------------------------------------------------------------------------

export const ExecutionTraceSchema = z
  .object({
    // Identity
    traceId: TraceIdSchema,
    executionRequestId: z.string().min(1, "executionRequestId must not be empty"),
    frameId: FrameIdSchema,

    // Actor
    principalId: z.string().min(1, "principalId must not be empty"),
    sessionId: z.string().min(1, "sessionId must not be empty"),
    workflowId: z.string().min(1).optional(),
    correlationId: z.string().min(1).optional(),

    // Lifecycle phases
    projectionPhase: ProjectionPhaseTraceSchema,
    guardrailPhase: GuardrailPhaseTraceSchema,
    approvalPhase: ApprovalPhaseTraceSchema.optional(),
    capabilityPhase: CapabilityPhaseTraceSchema.optional(),
    rollbackPhase: RollbackPhaseTraceSchema.optional(),

    // Hook telemetry
    hookExecutions: z
      .array(HookExecutionSummarySchema)
      .describe(
        "Per-stage hook aggregates; one entry per HookStage that fired, in chronological order"
      ),

    // Outcome
    outcome: ExecutionOutcomeSchema,
    startedAt: ISOTimestampSchema,
    completedAt: ISOTimestampSchema.optional(),
    totalDurationMs: NonNegativeIntSchema.optional().describe(
      "Total wall-clock duration from frame construction to terminal outcome, in milliseconds"
    ),

    // Full record set
    records: z
      .array(AuditRecordSchema)
      .readonly()
      .describe(
        "Every AuditRecord produced during this execution lifecycle, ordered by sequenceNumber ascending"
      ),

    metadata: MetadataSchema.optional(),
  })
  .describe("An end-to-end trace of a single governed execution lifecycle");

export type ExecutionTraceOutput = z.output<typeof ExecutionTraceSchema>;
export type ExecutionTraceInput = z.input<typeof ExecutionTraceSchema>;
