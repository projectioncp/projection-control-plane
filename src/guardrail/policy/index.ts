/**
 * Guardrail Policy Engine — Public API
 *
 * Entry point for all policy engine contract exports.
 *
 * Three modules make up the policy engine contract:
 *
 *   types.ts  — all interfaces and union types (zero runtime dependencies)
 *   schema.ts — Zod validation schemas for all types
 *
 * Typical usage:
 *
 *   // In a custom policy stage or remote policy service client:
 *   import type {
 *     GuardrailPolicy,
 *     PolicyEvaluationRequest,
 *     PolicyEvaluationResult,
 *   } from "projection-control-plane/guardrail/policy";
 *
 *   import {
 *     PolicyEvaluationRequestSchema,
 *     GuardrailDecisionSchema,
 *   } from "projection-control-plane/guardrail/policy";
 *
 * Note on GuardrailDecision naming:
 *   This module exports GuardrailDecision as a discriminated union.
 *   The pipeline layer (guardrail/types.ts) also exports GuardrailDecision
 *   as a string union. The guardrail barrel re-exports this module's version
 *   as `PolicyDecision` to prevent collision during the migration period.
 */

// ---------------------------------------------------------------------------
// Types (interfaces and union types — zero runtime cost)
// ---------------------------------------------------------------------------

export type {
  // Primitive aliases
  PolicyId,

  // Vocabulary unions
  GuardrailAction,
  PolicyDenyCode,
  PolicyViolationKind,
  PolicyViolationSeverity,

  // Policy structure
  PolicyScope,
  PolicyCondition,
  PolicyThreshold,
  PolicyRule,

  // Action configuration
  PolicyApprovalConfig,
  PolicyRateLimitConfig,

  // Root policy definition
  GuardrailPolicy,

  // Violation and trace
  PolicyViolation,
  PolicyMatchDetail,
  PolicyFlag,

  // Decision variants (for narrowing within a switch)
  DecisionAllow,
  DecisionDeny,
  DecisionRequireApproval,
  DecisionFlag,

  // Decision discriminated union
  GuardrailDecision,

  // Context objects
  PolicyFrameContext,
  PolicyCapabilityContext,

  // Engine I/O
  PolicyEvaluationRequest,
  PolicyEvaluationResult,

  // Re-exported canonical types needed by consumers
  CapabilityCategory,
  CapabilityId,
  ConstraintOperator,
} from "./types.js";

// ---------------------------------------------------------------------------
// Zod validation schemas (runtime values)
// ---------------------------------------------------------------------------

export {
  // Local primitive schemas
  PolicyIdSchema,
  SemverSchema,
  CapabilityIdSchema,
  NonNegativeIntSchema,
  PositiveIntSchema,

  // Re-exported canonical schemas
  ISOTimestampSchema,
  ConfidenceScoreSchema,
  MetadataSchema,
  ConstraintOperatorSchema,
  CapabilityCategorySchema,
  FramePolicyConstraintSchema,
  ApprovalRequirementSchema,

  // Vocabulary enum schemas
  GuardrailActionSchema,
  PolicyDenyCodeSchema,
  PolicyViolationKindSchema,
  PolicyViolationSeveritySchema,

  // Policy structure schemas
  PolicyScopeSchema,
  PolicyConditionSchema,
  PolicyThresholdSchema,
  PolicyRuleSchema,

  // Action config schemas
  PolicyApprovalConfigSchema,
  PolicyRateLimitConfigSchema,

  // Root policy schema
  GuardrailPolicySchema,

  // Violation and trace schemas
  PolicyViolationSchema,
  PolicyFlagSchema,
  PolicyMatchDetailSchema,

  // Decision variant schemas (for building custom discriminated union branches)
  DecisionAllowSchema,
  DecisionDenySchema,
  DecisionRequireApprovalSchema,
  DecisionFlagSchema,

  // Decision discriminated union schema
  GuardrailDecisionSchema,

  // Context schemas
  PolicyCapabilityContextSchema,
  PolicyFrameContextSchema,

  // Engine I/O schemas
  PolicyEvaluationRequestSchema,
  PolicyEvaluationResultSchema,
} from "./schema.js";

// Inferred types from schemas
export type {
  GuardrailPolicyOutput,
  GuardrailPolicyInput,
  PolicyEvaluationRequestOutput,
  PolicyEvaluationRequestInput,
  PolicyEvaluationResultOutput,
} from "./schema.js";
