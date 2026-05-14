/**
 * Hook Registry — Lifecycle Management Interface
 *
 * The HookRegistry is the authoritative source of Hook definitions at runtime.
 * It is the only place the runtime resolves a HookStage into the ordered list
 * of Hook handlers to execute.
 *
 * Responsibilities:
 *   - Accepts Hook registrations (with full typed handler)
 *   - Resolves Hook<S>[] for a given stage, sorted by priority
 *   - Manages hook lifecycle: enable, disable, deregister
 *   - Provides a serializable snapshot (HookDefinition[], no handlers)
 *
 * Ordering guarantee:
 *   getHooksForStage() returns hooks sorted ascending by priority.
 *   Lower priority number = executed first. Equal-priority order is unspecified.
 *   Callers must not assume stable ordering for equal-priority hooks.
 *
 * Concurrency:
 *   Implementations must be safe for concurrent read access.
 *   Write operations (register, deregister, enable, disable) may require
 *   external coordination in distributed deployments.
 *
 * Implementations:
 *   - InMemoryHookRegistry   — for testing and single-process runtimes
 *   - RemoteHookRegistry     — backed by a remote hook configuration service
 *   - CompositeHookRegistry  — merges multiple registries (platform + tenant hooks)
 *
 * Usage:
 *   const registry = new InMemoryHookRegistry();
 *
 *   registry.register({
 *     hookId: "audit:decision-logger",
 *     stage: "afterGuardrail",
 *     priority: 200,
 *     enabled: true,
 *     handler: (ctx) => { ... },
 *     ...
 *   });
 *
 *   // At runtime:
 *   const hooks = registry.getHooksForStage("afterGuardrail");
 *   for (const hook of hooks) {
 *     const result = await hook.handler(context);
 *     // ...
 *   }
 */

import type {
  AnyHook,
  Hook,
  HookDefinition,
  HookFilter,
  HookId,
  HookRegistrationResult,
  HookStage,
} from "./types.js";

// ---------------------------------------------------------------------------
// HookRegistry interface
// ---------------------------------------------------------------------------

/**
 * The HookRegistry manages the lifecycle of Hook definitions.
 *
 * Type safety contract:
 *   - register<S>(hook: Hook<S>) preserves the narrowed handler type
 *   - getHooksForStage<S>(stage: S) returns Hook<S>[] with stage-typed handlers
 *   - list() returns AnyHook[] — a union of all concrete Hook<S> variants
 *   - snapshot() returns HookDefinition[] — serializable metadata, no handlers
 */
export interface HookRegistry {
  // -- Registration --

  /**
   * Register a single Hook in the registry.
   *
   * If a hook with the same hookId already exists, behaviour is
   * implementation-defined: some registries reject duplicates, others update.
   *
   * @throws {HookRegistryError} if the hook definition fails validation
   *   (e.g. negative priority, missing required fields).
   */
  register<S extends HookStage>(hook: Hook<S>): HookRegistrationResult;

  /**
   * Register multiple Hooks in a single operation.
   *
   * Processes registrations in order. When stopOnFirstRejection is true
   * (default: false), halts on the first rejected hook and does not process
   * subsequent entries.
   */
  registerAll(
    hooks: AnyHook[],
    options?: { stopOnFirstRejection?: boolean }
  ): HookRegistrationResult[];

  // -- Resolution --

  /**
   * Retrieve all enabled hooks registered for a specific lifecycle stage.
   *
   * @param stage  - The lifecycle stage to retrieve hooks for.
   * @param filter - Optional additional predicates (tags, owner).
   *                 The `stage` field on the filter is ignored here —
   *                 use the explicit `stage` parameter instead.
   * @returns Hooks sorted ascending by priority (lower = first to execute).
   *          Returns an empty array if no hooks are registered for the stage.
   *
   * Type safety: returns Hook<S>[] with handlers typed as HookHandler<S>.
   * Callers can invoke hook.handler(context) without casts.
   */
  getHooksForStage<S extends HookStage>(
    stage: S,
    filter?: Omit<HookFilter, "stage">
  ): Hook<S>[];

  /**
   * Return true if at least one enabled hook is registered for the given stage.
   * Use this as a fast pre-check before constructing stage context objects.
   */
  hasHooks(stage: HookStage): boolean;

  // -- Introspection --

  /**
   * List all hooks matching the given filter.
   *
   * Returns AnyHook[] — the distributed union of Hook<S> for each stage.
   * Narrow by `.stage` field to get the typed Hook<S> variant:
   *
   *   for (const hook of registry.list({ stage: "beforeCapability" })) {
   *     if (hook.stage === "beforeCapability") {
   *       // hook.handler is HookHandler<"beforeCapability"> here
   *     }
   *   }
   *
   * Results are sorted ascending by priority within each stage.
   */
  list(filter?: HookFilter): AnyHook[];

  /**
   * Return the total number of registered hooks (enabled and disabled).
   */
  size(): number;

  /**
   * Return the number of registered hooks for a specific stage.
   */
  countForStage(stage: HookStage): number;

  // -- Lifecycle management --

  /**
   * Remove a hook from the registry entirely.
   *
   * @param hookId - The hook to remove.
   * @returns true if the hook was found and removed; false if not found.
   */
  deregister(hookId: HookId): boolean;

  /**
   * Enable a previously disabled hook.
   *
   * @param hookId - The hook to enable.
   * @returns true if the hook was found and enabled; false if not found.
   * @throws {HookNotFoundError} if the implementation is configured for strict mode.
   */
  enable(hookId: HookId): boolean;

  /**
   * Disable a hook without removing it from the registry.
   * Disabled hooks are excluded from getHooksForStage() results.
   *
   * @param hookId - The hook to disable.
   * @returns true if the hook was found and disabled; false if not found.
   * @throws {HookNotFoundError} if the implementation is configured for strict mode.
   */
  disable(hookId: HookId): boolean;

  // -- Snapshot --

  /**
   * Return an immutable snapshot of all registered hook definitions (no handlers).
   *
   * The snapshot includes both enabled and disabled hooks.
   * Useful for:
   *   - Persisting hook configuration to a store
   *   - Replicating registry state to a secondary process
   *   - Building diagnostic / audit payloads
   *   - Integration testing against a known hook set
   *
   * Note: handlers are excluded from the snapshot because functions
   * are not serializable. Reconstruct full Hook<S> objects by re-attaching
   * handlers from the application's hook factory registry.
   */
  snapshot(): ReadonlyArray<HookDefinition>;
}

// ---------------------------------------------------------------------------
// Registry errors
// ---------------------------------------------------------------------------

/**
 * Thrown when a requested hook is not found in the registry.
 *
 * Raised by enable() and disable() in implementations that operate in strict mode.
 */
export class HookNotFoundError extends Error {
  readonly hookId: HookId;

  constructor(hookId: HookId) {
    super(`Hook "${hookId}" not found in the registry`);
    this.name = "HookNotFoundError";
    this.hookId = hookId;
  }
}

/**
 * Thrown when a hook registration or registry operation fails due to
 * a validation or state error.
 *
 * Examples:
 *   - Hook definition fails validation (negative priority, empty name)
 *   - Duplicate hookId in a registry that rejects duplicates
 *   - Registry is in a read-only or sealed state
 */
export class HookRegistryError extends Error {
  readonly hookId?: HookId;
  readonly stage?: HookStage;

  constructor(message: string, hookId?: HookId, stage?: HookStage) {
    super(message);
    this.name = "HookRegistryError";
    if (hookId !== undefined) this.hookId = hookId;
    if (stage !== undefined) this.stage = stage;
  }
}
