/**
 * Capabilities layer — public API
 *
 * Entry point for all Capability contract exports.
 *
 * Three modules make up the capability contract:
 *
 *   capability.ts   — Capability interface, metadata, policies, and access patterns
 *   execution.ts    — CapabilityExecutionRequest and CapabilityExecutionResult
 *   registry.ts     — CapabilityRegistry interface and lifecycle types
 *   schema.ts       — Zod validation schemas for all capability types
 *
 * Usage:
 *   import type { Capability, CapabilityRegistry } from "projection-control-plane/capabilities";
 *   import { CapabilitySchema, validateCapability } from "projection-control-plane/capabilities";
 */

// ---------------------------------------------------------------------------
// Capability interface and metadata (capability.ts)
// ---------------------------------------------------------------------------

export type {
  // Vocabulary unions
  CapabilityCategory,
  AccessPatternType,
  IsolationLevel,
  BackoffStrategy,
  CapabilityAuditLevel,
  CapabilityApprovalTrigger,
  JsonSchemaType,

  // Sub-object interfaces
  JsonSchemaProperty,
  CapabilityIOSchema,
  AccessPattern,
  RateLimitPolicy,
  CircuitBreakerPolicy,
  CapabilityExecutionPolicy,
  CapabilityRetryPolicy,
  CapabilityAuditRequirements,
  CapabilityApprovalRequirements,

  // Root interface
  Capability,
} from "./capability.js";

// ---------------------------------------------------------------------------
// Execution request and result (execution.ts)
// ---------------------------------------------------------------------------

export type {
  // Status
  CapabilityExecutionStatus,

  // Sub-object interfaces
  CapabilityExecutionError,
  CapabilityExecutionWarning,
  DeclaredSideEffect,

  // Root interfaces
  CapabilityExecutionRequest,
  CapabilityExecutionResult,
} from "./execution.js";

// ---------------------------------------------------------------------------
// Registry interface and lifecycle types (registry.ts)
// ---------------------------------------------------------------------------

export type {
  // Filter types
  CapabilityFilter,

  // Registration types
  RegistrationStatus,
  RegistrationResult,

  // Version info
  CapabilityVersionInfo,

  // Root interface
  CapabilityRegistry,
} from "./registry.js";

// Registry error classes (values, not just types — must be exported as values)
export {
  CapabilityNotFoundError,
  CapabilityRegistryError,
} from "./registry.js";

// ---------------------------------------------------------------------------
// Zod validation schemas (schema.ts)
// ---------------------------------------------------------------------------

export {
  // Vocabulary schemas
  CapabilityCategorySchema,
  AccessPatternTypeSchema,
  IsolationLevelSchema,
  BackoffStrategySchema,
  CapabilityAuditLevelSchema,
  CapabilityApprovalTriggerSchema,

  // I/O schema
  JsonSchemaPropertySchema,
  CapabilityIOSchemaSchema,

  // Policy schemas
  AccessPatternSchema,
  RateLimitPolicySchema,
  CircuitBreakerPolicySchema,
  CapabilityExecutionPolicySchema,
  CapabilityRetryPolicySchema,
  CapabilityAuditRequirementsSchema,
  CapabilityApprovalRequirementsSchema,

  // Root capability schema
  CapabilitySchema,

  // Execution schemas
  CapabilityExecutionErrorSchema,
  CapabilityExecutionWarningSchema,
  DeclaredSideEffectSchema,
  CapabilityExecutionRequestSchema,
  CapabilityExecutionStatusSchema,
  CapabilityExecutionResultSchema,

  // Registry schemas
  CapabilityFilterSchema,
  RegistrationStatusSchema,
  RegistrationResultSchema,
  CapabilityVersionInfoSchema,
} from "./schema.js";

export type {
  CapabilityIOSchemaOutput,
  CapabilityOutput,
  CapabilityInput,
  CapabilityExecutionRequestOutput,
  CapabilityExecutionResultOutput,
} from "./schema.js";
