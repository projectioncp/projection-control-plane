/**
 * CapabilityRegistry — Lookup and Lifecycle Interface
 *
 * The CapabilityRegistry is the authoritative source of Capability definitions
 * at runtime. It is the only place the runtime resolves a capabilityId into a
 * full Capability contract — including its I/O schema, policies, and audit requirements.
 *
 * The registry is an interface, not an implementation. Concrete registries may be:
 *   - In-memory (for testing and single-process runtimes)
 *   - Distributed (backed by a config store or service registry)
 *   - Read-only (loaded from static configuration at startup)
 *
 * Version semantics:
 *   - A registry may hold multiple versions of the same capabilityId.
 *   - `resolveLatest` returns the highest semver that is not deprecated.
 *   - `resolve` with an explicit version returns exactly that version.
 *   - `resolve` without a version is equivalent to `resolveLatest`.
 *
 * Deprecation:
 *   - Deprecated capabilities remain in the registry until explicitly deregistered.
 *   - `deprecate` marks a version with a timestamp and optional replacement.
 *   - The runtime surfaces deprecation warnings in audit records.
 */

import type { Capability, CapabilityCategory } from "./capability.js";
import type { CapabilityId } from "../projection/frame.js";

// ---------------------------------------------------------------------------
// Filter types
// ---------------------------------------------------------------------------

/**
 * Predicates for filtering the capability list.
 * All specified fields are ANDed. An empty filter matches all capabilities.
 */
export interface CapabilityFilter {
  /** Return only capabilities in this category (or any of these categories). */
  category?: CapabilityCategory | CapabilityCategory[];
  /** Return only capabilities that include ALL of these tags. */
  tags?: string[];
  /** Return only capabilities that list ALL of these entitlements as required. */
  requiredEntitlements?: string[];
  /** Filter by unconditional approval requirement. */
  requiresApproval?: boolean;
  /** Filter by idempotency. */
  idempotent?: boolean;
  /** Filter by rollback support. */
  rollbackSupported?: boolean;
  /** When true, exclude deprecated versions from results. Default: true. */
  excludeDeprecated?: boolean;
  /**
   * Filter by owner.
   * Exact match against Capability.owner.
   */
  owner?: string;
}

// ---------------------------------------------------------------------------
// Registration types
// ---------------------------------------------------------------------------

/** Outcome of a `register` call. */
export type RegistrationStatus =
  | "registered"  // new capability version registered successfully
  | "updated"     // existing version updated (if registry allows updates)
  | "rejected";   // registration refused (see reason)

/** Result returned by `CapabilityRegistry.register`. */
export interface RegistrationResult {
  status: RegistrationStatus;
  capabilityId: CapabilityId;
  version: string;
  /** Present when status === "rejected". */
  reason?: string;
}

// ---------------------------------------------------------------------------
// Version info
// ---------------------------------------------------------------------------

/**
 * Summary of a specific capability version in the registry.
 * Returned by `listVersions` to allow inspection without fetching full Capability objects.
 */
export interface CapabilityVersionInfo {
  capabilityId: CapabilityId;
  version: string;
  /** Whether this version is deprecated. */
  deprecated: boolean;
  /** ISO-8601 timestamp when this version was deprecated, if applicable. */
  deprecatedAt?: string;
  /** Capability ID that replaces this version, if set. */
  replacedBy?: CapabilityId;
  /** When this version was registered. */
  registeredAt: string;
}

// ---------------------------------------------------------------------------
// CapabilityRegistry interface
// ---------------------------------------------------------------------------

/**
 * The CapabilityRegistry manages the lifecycle of Capability definitions.
 *
 * Consumers:
 *   - The Guardrail pipeline resolves capabilities to enforce entitlements
 *     and approval requirements.
 *   - The Projection layer resolves capabilities to build CapabilityRef[]
 *     arrays for Decision Frames.
 *   - The runtime resolves capabilities at execution time to obtain
 *     inputSchema, outputSchema, retryPolicy, and auditRequirements.
 *
 * Thread safety: implementations must be safe for concurrent read access.
 * Write operations (register, deregister, deprecate) may require external
 * coordination in distributed deployments.
 */
export interface CapabilityRegistry {
  // -- Registration --

  /**
   * Register a Capability in the registry.
   *
   * If a capability with the same (capabilityId, version) already exists,
   * behaviour is implementation-defined: some registries reject duplicates,
   * others allow updates.
   *
   * @throws {CapabilityRegistryError} if the capability fails schema validation.
   */
  register(capability: Capability): RegistrationResult;

  /**
   * Register multiple capabilities in a single operation.
   * Processes registrations in order; stops on the first rejection if
   * `stopOnFirstRejection` is true (default: false — process all).
   */
  registerAll(
    capabilities: Capability[],
    options?: { stopOnFirstRejection?: boolean }
  ): RegistrationResult[];

  // -- Resolution --

  /**
   * Resolve a capability by ID and optional version.
   *
   * @param id      - The capabilityId to resolve.
   * @param version - Exact semver string. When absent, resolves the latest
   *                  non-deprecated version.
   * @returns The Capability, or undefined if not found.
   */
  resolve(id: CapabilityId, version?: string): Capability | undefined;

  /**
   * Resolve a capability or throw if not found.
   *
   * Prefer this over `resolve` when a missing capability is a programming
   * error (e.g. inside the runtime after Guardrail has already validated
   * the capabilityId is authorized).
   *
   * @throws {CapabilityNotFoundError}
   */
  resolveOrThrow(id: CapabilityId, version?: string): Capability;

  /**
   * Resolve the latest non-deprecated version of a capability.
   * Returns undefined if the capability does not exist or all versions
   * are deprecated.
   */
  resolveLatest(id: CapabilityId): Capability | undefined;

  // -- Introspection --

  /**
   * Return true if a matching capability exists in the registry.
   *
   * @param id      - The capabilityId to check.
   * @param version - When provided, checks for this exact version.
   *                  When absent, returns true if any version exists.
   */
  has(id: CapabilityId, version?: string): boolean;

  /**
   * List all capabilities matching the given filter.
   * Returns at most one entry per (capabilityId, version) pair.
   * Results are sorted by capabilityId ascending, then version descending.
   */
  list(filter?: CapabilityFilter): Capability[];

  /**
   * List version metadata for all registered versions of a specific capability.
   * Includes deprecated versions. Results are sorted by version descending.
   *
   * Returns an empty array if the capabilityId is not registered.
   */
  listVersions(id: CapabilityId): CapabilityVersionInfo[];

  /**
   * Return the total number of (capabilityId, version) entries in the registry.
   */
  size(): number;

  // -- Deregistration --

  /**
   * Remove a capability version from the registry.
   *
   * @param id      - The capabilityId to remove.
   * @param version - Exact version to remove. When absent, removes all versions.
   * @returns true if at least one entry was removed; false if nothing was found.
   */
  deregister(id: CapabilityId, version?: string): boolean;

  // -- Deprecation --

  /**
   * Mark a capability version as deprecated.
   *
   * Deprecated capabilities remain resolvable (to allow in-flight executions
   * to complete) but `list` excludes them by default and `resolveLatest`
   * skips them.
   *
   * @param id          - The capabilityId to deprecate.
   * @param version     - The specific version to deprecate.
   * @param replacedBy  - Optional ID of the capability that replaces this one.
   * @throws {CapabilityNotFoundError} if the version does not exist.
   */
  deprecate(
    id: CapabilityId,
    version: string,
    replacedBy?: CapabilityId
  ): void;

  // -- Snapshot --

  /**
   * Return an immutable snapshot of all registered capabilities.
   *
   * Useful for:
   *   - Serialising registry state for persistence or replication
   *   - Building Decision Frame authorizedCapabilities lists offline
   *   - Integration testing against a known set
   */
  snapshot(): ReadonlyArray<Capability>;
}

// ---------------------------------------------------------------------------
// Registry errors
// ---------------------------------------------------------------------------

/**
 * Thrown when a requested capability (and/or version) is not found.
 */
export class CapabilityNotFoundError extends Error {
  readonly capabilityId: CapabilityId;
  readonly version?: string;

  constructor(capabilityId: CapabilityId, version?: string) {
    const detail = version
      ? `"${capabilityId}" version "${version}"`
      : `"${capabilityId}" (any version)`;
    super(`Capability ${detail} not found in the registry`);
    this.name = "CapabilityNotFoundError";
    this.capabilityId = capabilityId;
    if (version !== undefined) this.version = version;
  }
}

/**
 * Thrown when a registry operation fails due to a validation or state error.
 */
export class CapabilityRegistryError extends Error {
  readonly capabilityId?: CapabilityId;
  readonly version?: string;

  constructor(message: string, capabilityId?: CapabilityId, version?: string) {
    super(message);
    this.name = "CapabilityRegistryError";
    if (capabilityId !== undefined) this.capabilityId = capabilityId;
    if (version !== undefined) this.version = version;
  }
}
