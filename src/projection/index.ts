/**
 * Projection layer — public API
 *
 * Entry point for all Decision Frame schema and validation exports.
 *
 * Two interface layers are exported:
 *
 *   frame.ts / frame.schema.ts  — canonical interfaces matching the spec
 *     Field names: frameId, userIntent, projectedContext, authorizedCapabilities,
 *                  executionConstraints, approvalRequirements, retrievalContext,
 *                  telemetryReferences, auditMetadata
 *
 *   schema.ts                   — earlier draft schemas (used by guardrail layer)
 *     Field names: id, intent, operationalState, authorizedCapabilityIds, ...
 *
 * New code should import from the canonical layer (Frame* exports below).
 * The draft schema exports are retained for backward-compatibility with the
 * guardrail layer until it is migrated.
 *
 * Consumers:
 *   import { DecisionFrameSchema, validateDecisionFrame } from "projection-control-plane/projection";
 */

// ---------------------------------------------------------------------------
// Canonical interfaces (frame.ts) — framework-agnostic, zero runtime deps
// ---------------------------------------------------------------------------

export type {
  // Primitives
  FrameId,
  CapabilityId,
  PrincipalId,
  RequirementId,
  ISOTimestamp,
  ConfidenceScore,
  Metadata,
  ConstraintOperator,

  // Vocabulary unions
  IntentCategory,
  CapabilityCategory,
  ApprovalTrigger,
  RetrievalSourceType,
  RetrievalStrategy,
  TelemetrySourceType,
  FrameTriggerSource,

  // Sub-object interfaces
  UserIntent,
  ProjectedContext,
  CapabilityRef,
  FramePolicyConstraint,
  ExecutionConstraints,
  ApprovalRequirement,
  RetrievalResult,
  RetrievalContext,
  TelemetrySnapshot,
  TelemetryReference,
  FrameAuditMetadata,

  // Root interface
  DecisionFrame,
} from "./frame.js";

// ---------------------------------------------------------------------------
// Canonical validation schemas (frame.schema.ts)
// ---------------------------------------------------------------------------

export {
  // Primitive schemas
  FrameIdSchema,
  ISOTimestampSchema as FrameISOTimestampSchema,
  ConfidenceScoreSchema as FrameConfidenceScoreSchema,
  MetadataSchema,

  // Vocabulary schemas
  IntentCategorySchema,
  CapabilityCategorySchema,
  ConstraintOperatorSchema,
  ApprovalTriggerSchema,
  RetrievalSourceTypeSchema,
  RetrievalStrategySchema,
  TelemetrySourceTypeSchema,
  FrameTriggerSourceSchema,

  // Sub-object schemas
  UserIntentSchema,
  ProjectedContextSchema,
  CapabilityRefSchema,
  FramePolicyConstraintSchema,
  ExecutionConstraintsSchema,
  ApprovalRequirementSchema as FrameApprovalRequirementSchema,
  RetrievalResultSchema as FrameRetrievalResultSchema,
  RetrievalContextSchema,
  TelemetrySnapshotSchema as FrameTelemetrySnapshotSchema,
  TelemetryReferenceSchema,
  FrameAuditMetadataSchema as FrameAuditMetadataSchemaV2,

  // Root schema
  DecisionFrameSchema as FrameDecisionFrameSchema,
} from "./frame.schema.js";

export type {
  DecisionFrameOutput,
  DecisionFrameInput as FrameDecisionFrameInput,
} from "./frame.schema.js";

// ---------------------------------------------------------------------------
// Draft schema layer (schema.ts) — retained for guardrail layer compatibility
// ---------------------------------------------------------------------------

// Schema — Zod schemas and inferred types
export {
  // Primitive schemas
  IDSchema,
  ISOTimestampSchema,
  ConfidenceScoreSchema,

  // Sub-object schemas
  RetrievalResultSchema,
  TelemetrySnapshotSchema,
  PolicyConstraintSchema,
  ApprovalRequirementSchema,
  ExecutionBoundarySchema,
  FrameAuditMetadataSchema,

  // Root schema
  DecisionFrameSchema,
} from "./schema.js";

// Draft types are aliased with a "Draft" prefix to avoid collisions with
// the canonical frame.ts types exported above.
export type {
  RetrievalResult as DraftRetrievalResult,
  TelemetrySnapshot as DraftTelemetrySnapshot,
  PolicyConstraint as DraftPolicyConstraint,
  ApprovalRequirement as DraftApprovalRequirement,
  ExecutionBoundary as DraftExecutionBoundary,
  FrameAuditMetadata as DraftFrameAuditMetadata,
  DecisionFrame as DraftDecisionFrame,
  DecisionFrameInput as DraftDecisionFrameInput,
} from "./schema.js";

// Validation layer
export {
  validateDecisionFrame,
  assertDecisionFrame,
  DecisionFrameValidationError,
} from "./validate.js";

export type {
  ValidationErrorCode,
  ValidationIssue,
  ValidationSuccess,
  ValidationFailure,
  ValidationResult,
  ValidationOptions,
} from "./validate.js";
