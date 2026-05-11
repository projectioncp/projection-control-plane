/**
 * Projection layer — public API
 *
 * Entry point for all Decision Frame schema and validation exports.
 *
 * Consumers:
 *   import { DecisionFrameSchema, validateDecisionFrame } from "projection-control-plane/projection";
 */

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

export type {
  RetrievalResult,
  TelemetrySnapshot,
  PolicyConstraint,
  ApprovalRequirement,
  ExecutionBoundary,
  FrameAuditMetadata,
  DecisionFrame,
  DecisionFrameInput,
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
