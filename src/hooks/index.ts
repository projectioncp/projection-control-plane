/**
 * Hook Framework — Public API
 *
 * Entry point for all hook framework exports.
 *
 * Four modules make up the hook framework:
 *
 *   types.ts     — core types (stages, context variants, handler, hook, results)
 *   registry.ts  — HookRegistry interface and lifecycle error classes
 *   schema.ts    — Zod validation for serializable hook types
 *
 * Typical usage — registering hooks:
 *
 *   import type { Hook } from "projection-control-plane/hooks";
 *
 *   const auditHook: Hook<"afterGuardrail"> = {
 *     hookId: "audit:guardrail-decision",
 *     name:   "Guardrail Decision Audit Logger",
 *     stage:  "afterGuardrail",
 *     priority: 200,
 *     enabled: true,
 *     createdAt: new Date().toISOString(),
 *     handler: async (ctx) => {
 *       // ctx is AfterGuardrailContext — fully typed, no casts
 *       await auditService.emit(ctx.result);
 *       return { hookId: "audit:guardrail-decision", stage: "afterGuardrail",
 *                outcome: "continue", executedAt: new Date().toISOString(), durationMs: 0 };
 *     },
 *   };
 *
 *   registry.register(auditHook);
 *
 * Typical usage — executing hooks at a stage:
 *
 *   const hooks = registry.getHooksForStage("afterGuardrail");
 *   for (const hook of hooks) {
 *     const result = await hook.handler(context); // context: AfterGuardrailContext
 *     // ... act on result.outcome
 *   }
 *
 * Registering mixed-stage hooks (bulk):
 *
 *   import type { AnyHook } from "projection-control-plane/hooks";
 *
 *   const hooks: AnyHook[] = [beforeHook, afterHook, errorHook];
 *   registry.registerAll(hooks);
 *
 * Factory helper — type inference without explicit generic parameter:
 *
 *   const hook = createHook("beforeCapability", {
 *     hookId: "trace:capability-start",
 *     handler: (ctx) => { ... }, // ctx inferred as BeforeCapabilityContext
 *     ...
 *   });
 */

// ---------------------------------------------------------------------------
// Types (interfaces and union types — zero runtime cost)
// ---------------------------------------------------------------------------

export type {
  // Primitive aliases
  HookId,

  // Vocabulary unions
  HookStage,
  HookOutcome,
  HookErrorPolicy,
  HookRegistrationStatus,

  // Structured error
  HookError,

  // Hook result types
  HookResult,
  HookExecutionResult,

  // Stage context types
  BeforeProjectionContext,
  AfterProjectionContext,
  BeforeGuardrailContext,
  AfterGuardrailContext,
  BeforeCapabilityContext,
  AfterCapabilityContext,
  OnErrorContext,

  // Context map and union
  HookContextMap,
  HookContext,

  // Handler type
  HookHandler,

  // Hook definition and full Hook
  HookDefinition,
  Hook,
  AnyHook,

  // Filter and registration
  HookFilter,
  HookRegistrationResult,

  // Re-exported canonical types
  CapabilityId,
  ConfidenceScore,
  FrameTriggerSource,
  ISOTimestamp,
  Metadata,
  PrincipalId,
} from "./types.js";

// ---------------------------------------------------------------------------
// Registry interface and error classes
// ---------------------------------------------------------------------------

export type { HookRegistry } from "./registry.js";
export { HookNotFoundError, HookRegistryError } from "./registry.js";

// ---------------------------------------------------------------------------
// Zod validation schemas (runtime values)
// ---------------------------------------------------------------------------

export {
  // Re-exported canonical schemas
  ISOTimestampSchema,
  MetadataSchema,

  // Local primitive schemas
  HookIdSchema,
  NonNegativeIntSchema,
  PositiveIntSchema,

  // Vocabulary enum schemas
  HookStageSchema,
  HookOutcomeSchema,
  HookErrorPolicySchema,
  HookRegistrationStatusSchema,

  // Object schemas
  HookErrorSchema,
  HookResultSchema,
  HookExecutionResultSchema,
  HookDefinitionSchema,
  HookFilterSchema,
  HookRegistrationResultSchema,
} from "./schema.js";

export type {
  HookErrorOutput,
  HookResultOutput,
  HookExecutionResultOutput,
  HookDefinitionOutput,
  HookDefinitionInput,
  HookRegistrationResultOutput,
} from "./schema.js";

// ---------------------------------------------------------------------------
// Factory helper — type-safe hook construction without explicit generics
// ---------------------------------------------------------------------------

import type { Hook, HookStage } from "./types.js";

/**
 * Construct a type-safe Hook<S> without manually specifying the generic parameter.
 *
 * TypeScript infers S from the `stage` field, which in turn narrows the
 * `handler` parameter type to the correct context for that stage.
 *
 * @example
 *   const hook = createHook({
 *     hookId:   "trace:before-capability",
 *     name:     "Capability Trace Hook",
 *     stage:    "beforeCapability",      // S inferred as "beforeCapability"
 *     priority: 500,
 *     enabled:  true,
 *     createdAt: new Date().toISOString(),
 *     handler: (ctx) => {
 *       // ctx: BeforeCapabilityContext — no cast needed
 *       console.log("[trace] invoking", ctx.request.capabilityId);
 *       return {
 *         hookId:      "trace:before-capability",
 *         stage:       "beforeCapability",
 *         outcome:     "continue",
 *         executedAt:  new Date().toISOString(),
 *         durationMs:  0,
 *       };
 *     },
 *   });
 *
 * The helper is purely a type-level identity function — it has zero runtime cost.
 */
export function createHook<S extends HookStage>(hook: Hook<S>): Hook<S> {
  return hook;
}
