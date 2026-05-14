/**
 * Hook Framework — Zod Validation Schemas
 *
 * Runtime validation schemas for the serializable hook types defined in types.ts.
 *
 * Scope: only types that are fully serializable (no function fields) are
 * validated here. The types NOT covered by these schemas are:
 *
 *   HookHandler<S>        — a function; not serializable
 *   Hook<S>               — contains a handler function; not serializable
 *   AnyHook               — same
 *   HookContext variants  — carry live runtime objects (ExecutionRequest,
 *                            GuardrailResult, etc.) whose Zod schemas exist
 *                            in their own modules
 *
 * Types that ARE covered:
 *   HookStageSchema               — HookStage string union
 *   HookOutcomeSchema             — HookOutcome string union
 *   HookErrorPolicySchema         — HookErrorPolicy string union
 *   HookRegistrationStatusSchema  — HookRegistrationStatus string union
 *   HookErrorSchema               — HookError
 *   HookResultSchema              — HookResult
 *   HookExecutionResultSchema     — HookExecutionResult
 *   HookDefinitionSchema          — HookDefinition (metadata without handler)
 *   HookFilterSchema              — HookFilter
 *   HookRegistrationResultSchema  — HookRegistrationResult
 *
 * Note on z.ZodType<T> annotations:
 *   Under exactOptionalPropertyTypes, Zod's internal _type for optional fields
 *   is `T | undefined` (required key), while TypeScript interfaces use `{ key?: T }`
 *   (optional key). These are incompatible under z.ZodType<T> annotations on
 *   object schemas. Therefore:
 *     - z.ZodType<T> is used ONLY on vocabulary enum schemas.
 *     - Object schemas are left as inferred types.
 *
 * Composition order (bottom-up):
 *   enum schemas → HookErrorSchema → HookResultSchema → HookExecutionResultSchema
 *   → HookDefinitionSchema → HookFilterSchema → HookRegistrationResultSchema
 */

import { z } from "zod";
import {
  ISOTimestampSchema,
  MetadataSchema,
} from "../projection/frame.schema.js";
import type {
  HookErrorPolicy,
  HookOutcome,
  HookRegistrationStatus,
  HookStage,
} from "./types.js";

// ---------------------------------------------------------------------------
// Re-export shared schemas
// ---------------------------------------------------------------------------

export { ISOTimestampSchema, MetadataSchema };

// ---------------------------------------------------------------------------
// Local primitive schemas
// ---------------------------------------------------------------------------

export const HookIdSchema = z
  .string()
  .min(1, "hookId must not be empty")
  .describe("Stable hook identifier");

export const NonNegativeIntSchema = z.number().int().nonnegative();
export const PositiveIntSchema = z.number().int().positive();

// ---------------------------------------------------------------------------
// Vocabulary enum schemas
// Note: z.ZodType<T> annotations are used ONLY for enum/union types.
// ---------------------------------------------------------------------------

export const HookStageSchema: z.ZodType<HookStage> = z.enum([
  "beforeProjection",
  "afterProjection",
  "beforeGuardrail",
  "afterGuardrail",
  "beforeCapability",
  "afterCapability",
  "onError",
]);

export const HookOutcomeSchema: z.ZodType<HookOutcome> = z.enum([
  "continue",
  "skip",
  "abort",
  "override",
  "retry",
  "escalate",
]);

export const HookErrorPolicySchema: z.ZodType<HookErrorPolicy> = z.enum([
  "fail-open",
  "fail-closed",
]);

export const HookRegistrationStatusSchema: z.ZodType<HookRegistrationStatus> = z.enum([
  "registered",
  "updated",
  "rejected",
]);

// ---------------------------------------------------------------------------
// HookError
// ---------------------------------------------------------------------------

export const HookErrorSchema = z
  .object({
    code: z
      .string()
      .min(1, "error.code must not be empty")
      .describe("Machine-readable error code (SCREAMING_SNAKE_CASE)"),
    message: z
      .string()
      .min(1, "error.message must not be empty")
      .describe("Human-readable error description"),
    retryable: z.boolean().describe("Whether the operation may succeed if retried"),
    hookId: HookIdSchema.optional().describe(
      "The hook that produced this error, if it originated from a handler"
    ),
    cause: z
      .string()
      .optional()
      .describe("Sanitized cause description (no stack traces or credentials)"),
    metadata: MetadataSchema.optional(),
  })
  .describe("Structured error produced during hook execution");

export type HookErrorOutput = z.output<typeof HookErrorSchema>;

// ---------------------------------------------------------------------------
// HookResult
// ---------------------------------------------------------------------------

export const HookResultSchema = z
  .object({
    hookId: HookIdSchema,
    stage: HookStageSchema,
    outcome: HookOutcomeSchema,
    reason: z.string().optional().describe("Human-readable explanation of the outcome"),
    error: HookErrorSchema.optional().describe("Error details; required when outcome === 'abort'"),
    outputOverride: z
      .record(z.string().min(1), z.unknown())
      .optional()
      .describe("Output to substitute for the stage output; only used when outcome === 'override'"),
    payload: MetadataSchema.optional().describe(
      "Arbitrary payload forwarded to subsequent hooks at the same stage"
    ),
    executedAt: ISOTimestampSchema,
    durationMs: NonNegativeIntSchema.describe("Wall-clock duration of this handler invocation"),
  })
  .describe("Result produced by a single Hook handler invocation");

export type HookResultOutput = z.output<typeof HookResultSchema>;

// ---------------------------------------------------------------------------
// HookExecutionResult
// ---------------------------------------------------------------------------

export const HookExecutionResultSchema = z
  .object({
    stage: HookStageSchema,
    hookResults: z
      .array(HookResultSchema)
      .describe("Individual results from each hook that ran, in execution order"),
    terminalOutcome: HookOutcomeSchema.describe(
      "Aggregated terminal outcome across all hooks at this stage"
    ),
    abortError: HookErrorSchema.optional().describe(
      "Error from the first hook that produced an 'abort' outcome"
    ),
    outputOverride: z
      .record(z.string().min(1), z.unknown())
      .optional()
      .describe("Output from the last hook that produced an 'override' outcome"),
    executedAt: ISOTimestampSchema,
    durationMs: NonNegativeIntSchema.describe(
      "Total wall-clock duration across all hooks at this stage"
    ),
  })
  .describe("Aggregate result of running all registered hooks at a single lifecycle stage");

export type HookExecutionResultOutput = z.output<typeof HookExecutionResultSchema>;

// ---------------------------------------------------------------------------
// HookDefinition — serializable hook metadata (no handler)
// ---------------------------------------------------------------------------

export const HookDefinitionSchema = z
  .object({
    hookId: HookIdSchema,
    name: z.string().min(1, "hook.name must not be empty"),
    description: z.string().optional(),
    stage: HookStageSchema,
    priority: z
      .number()
      .int()
      .describe("Execution priority within the stage (lower = executed first)"),
    enabled: z.boolean(),
    onHandlerError: HookErrorPolicySchema.optional().describe(
      "How the executor handles handler exceptions; defaults to 'fail-open'"
    ),
    timeoutMs: PositiveIntSchema.optional().describe(
      "Maximum handler runtime in milliseconds; absent = no timeout enforced"
    ),
    tags: z.array(z.string().min(1)).optional(),
    owner: z.string().min(1).optional(),
    createdAt: ISOTimestampSchema,
    updatedAt: ISOTimestampSchema.optional(),
    metadata: MetadataSchema.optional(),
  })
  .describe("Serializable hook metadata — excludes the handler function");

export type HookDefinitionOutput = z.output<typeof HookDefinitionSchema>;
export type HookDefinitionInput = z.input<typeof HookDefinitionSchema>;

// ---------------------------------------------------------------------------
// HookFilter
// ---------------------------------------------------------------------------

export const HookFilterSchema = z
  .object({
    stage: z
      .union([HookStageSchema, z.array(HookStageSchema)])
      .optional()
      .describe("Filter by stage (single stage or array of stages)"),
    tags: z
      .array(z.string().min(1))
      .optional()
      .describe("All listed tags must be present on the hook"),
    enabled: z
      .boolean()
      .optional()
      .describe("Filter by enabled state; absent = include both"),
    owner: z
      .string()
      .min(1)
      .optional()
      .describe("Exact match against HookDefinition.owner"),
  })
  .describe("Predicates for filtering the hook list");

// ---------------------------------------------------------------------------
// HookRegistrationResult
// ---------------------------------------------------------------------------

export const HookRegistrationResultSchema = z
  .object({
    status: HookRegistrationStatusSchema,
    hookId: HookIdSchema,
    stage: HookStageSchema,
    reason: z
      .string()
      .optional()
      .describe("Present when status === 'rejected'; explains why registration was refused"),
  })
  .describe("Result returned by HookRegistry.register()");

export type HookRegistrationResultOutput = z.output<typeof HookRegistrationResultSchema>;
