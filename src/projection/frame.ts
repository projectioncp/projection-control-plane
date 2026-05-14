/**
 * Decision Frame — Canonical Interface Definitions
 *
 * This file defines the authoritative TypeScript interfaces for the
 * Projection Control Plane Decision Frame model.
 *
 * A Decision Frame is the bounded operational context projected to the AI
 * runtime. It defines exactly what the AI sees, what it may do, the rules
 * it must follow, and the provenance chain for every action it requests.
 *
 * Design principles:
 *   Framework-agnostic   — zero runtime dependencies; pure TypeScript types
 *   Strongly typed       — no `any`; unknown used only where intentional
 *   Deterministic        — every required field is required; optional fields
 *                          have explicit semantics, not "might be populated"
 *   Extensible           — key sub-objects carry a `metadata` extension bag
 *   Self-documenting     — every type and field is annotated
 *
 * Validation schemas (Zod) live in frame.schema.ts.
 * Business rules live in validate.ts.
 *
 * Composition:
 *   DecisionFrame
 *     ├── UserIntent
 *     ├── ProjectedContext
 *     ├── CapabilityRef[]          (authorizedCapabilities)
 *     ├── ExecutionConstraints
 *     │     └── FramePolicyConstraint[]
 *     ├── ApprovalRequirement[]    (approvalRequirements)
 *     ├── RetrievalContext
 *     │     └── RetrievalResult[]
 *     ├── TelemetryReference[]     (telemetryReferences)
 *     └── FrameAuditMetadata       (auditMetadata)
 */

// ---------------------------------------------------------------------------
// Primitive type aliases
// ---------------------------------------------------------------------------

/** Stable frame identifier. UUID v4 format recommended. */
export type FrameId = string;

/** Stable capability identifier. */
export type CapabilityId = string;

/** Stable principal (user / service account / agent) identifier. */
export type PrincipalId = string;

/** Stable requirement identifier. */
export type RequirementId = string;

/**
 * ISO-8601 timestamp with timezone offset.
 * Example: "2026-05-10T14:30:00.000Z"
 */
export type ISOTimestamp = string;

/**
 * AI confidence score in the range [0.0, 1.0].
 * 0.0 = no confidence; 1.0 = full confidence.
 */
export type ConfidenceScore = number;

/** Arbitrary extension payload. Shape is domain-specific. */
export type Metadata = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Shared operator vocabulary
// ---------------------------------------------------------------------------

/**
 * Comparison operators used in policy constraints and guardrail conditions.
 * Shared between FramePolicyConstraint and GuardrailPolicy conditions.
 */
export type ConstraintOperator =
  | "eq"       // strict equality
  | "neq"      // strict inequality
  | "gt"       // greater than (numeric)
  | "lt"       // less than (numeric)
  | "gte"      // greater than or equal (numeric)
  | "lte"      // less than or equal (numeric)
  | "in"       // value is in an array
  | "not-in"   // value is not in an array
  | "contains" // string includes substring, or array includes element
  | "regex";   // string matches regular expression pattern

// ---------------------------------------------------------------------------
// UserIntent
// ---------------------------------------------------------------------------

/**
 * Broad classification of what kind of operation the user intends.
 * Used for routing, policy matching, and audit classification.
 */
export type IntentCategory =
  | "query"          // read-only information retrieval
  | "action"         // write or side-effecting operation
  | "decision"       // AI-assisted decision support
  | "approval"       // routing something for human approval
  | "analysis"       // analytical or reporting workflow
  | "orchestration"  // multi-step coordinated workflow
  | "simulation";    // what-if or forecast scenario

/**
 * The user or system intent that triggered this Decision Frame.
 *
 * `raw` is always the verbatim input. The remaining fields are populated
 * by the Projection layer during frame construction and represent its
 * interpretation of that input — they are not authored by the end user.
 */
export interface UserIntent {
  /** Verbatim user or system input that triggered frame construction. */
  raw: string;
  /**
   * Canonicalized and normalized form of the intent.
   * Populated by the Projection layer's intent parsing subsystem.
   */
  normalized?: string;
  /** Broad classification of the intent type. */
  category?: IntentCategory;
  /**
   * The Projection layer's confidence in its interpretation of the intent.
   * Distinct from the AI's execution confidence on individual requests.
   */
  interpretationConfidence?: ConfidenceScore;
  /**
   * Named entities extracted from the raw intent during parsing.
   * Shape is domain-specific (e.g. { region: "us-east-1", service: "billing" }).
   */
  entities?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// ProjectedContext
// ---------------------------------------------------------------------------

/**
 * The bounded operational context projected to this frame's reasoning surface.
 *
 * Groups everything the AI needs to understand its current operational
 * situation: who it is acting on behalf of, what session it belongs to,
 * what workflow step it is executing, what the current operational state
 * looks like, and what environment it is operating in.
 *
 * The AI reasons against this projected context rather than against raw
 * enterprise systems — Projection controls what is visible.
 */
export interface ProjectedContext {
  /** Session this frame was issued within. */
  sessionId: string;
  /**
   * The principal (user, service account, or agent) on whose behalf this
   * frame was constructed. Entitlements are snapshotted at construction time.
   */
  principalId: PrincipalId;
  /**
   * Entitlement tokens the principal holds at frame-construction time.
   * Snapshotted so that mid-flight revocations cannot affect this frame.
   */
  entitlements: string[];
  /** Workflow this frame belongs to, if part of a multi-step process. */
  workflowId?: string;
  /**
   * Named step within the workflow.
   * Example: "gather-context", "validate-inputs", "approve-deployment".
   */
  workflowStep?: string;
  /**
   * Current state of the workflow or process being reasoned about.
   * Shape is domain-specific; the Projection layer selects and scopes
   * which fields are included.
   */
  operationalState: Record<string, unknown>;
  /**
   * Environment scope tags describing where this frame is executing.
   * Examples: ["production", "us-east-1"], ["staging", "eu-west-2"].
   */
  environmentScope?: string[];
  /** Extension metadata for domain-specific context fields. */
  metadata?: Metadata;
}

// ---------------------------------------------------------------------------
// AuthorizedCapabilities
// ---------------------------------------------------------------------------

/**
 * Broad category of a Capability.
 * Used for policy scoping, audit classification, and UI display.
 */
export type CapabilityCategory =
  | "workflow"
  | "analytics"
  | "forecasting"
  | "scheduling"
  | "simulation"
  | "operational"
  | "deployment"
  | "approval"
  | "notification";

/**
 * A reference to a Capability the AI is authorized to invoke in this frame.
 *
 * CapabilityRef carries enough information for the runtime to enforce
 * entitlements and approval routing without a secondary capability lookup.
 * Full Capability definitions (including input/output schemas) live in the
 * Capability registry.
 */
export interface CapabilityRef {
  /** Stable capability identifier. Must match the registry entry. */
  capabilityId: CapabilityId;
  /** Human-readable capability name for logging and audit. */
  name: string;
  /** Semantic version string, e.g. "1.2.0". */
  version: string;
  /** Broad category. */
  category: CapabilityCategory;
  /**
   * Entitlement tokens the invoking principal must hold.
   * The Guardrail authorization stage validates these at request time.
   */
  requiredEntitlements: string[];
  /**
   * Whether invocation always requires explicit human or system approval,
   * regardless of Guardrail policy.
   */
  requiresApproval: boolean;
  /** Whether the Capability supports rollback after successful execution. */
  rollbackSupported: boolean;
  /** Extension metadata for domain-specific capability attributes. */
  metadata?: Metadata;
}

// ---------------------------------------------------------------------------
// ExecutionConstraints
// ---------------------------------------------------------------------------

/**
 * A structured policy constraint baked into this frame by the Projection layer.
 *
 * Constraints express rules the Guardrail layer evaluates at runtime against
 * the ExecutionRequest produced by the AI. They use dot-notation field paths
 * to target fields on the request (e.g. "confidence", "input.amount").
 *
 * A constraint is SATISFIED when: evalOperator(actual, operator, value) === true.
 * A violated constraint causes the Guardrail constraints stage to deny the request.
 */
export interface FramePolicyConstraint {
  /** Unique identifier within this frame. */
  constraintId: string;
  /** Human-readable explanation shown alongside the constraint in audit records. */
  description: string;
  /**
   * Dot-notation path to the field on the ExecutionRequest being constrained.
   * Examples: "confidence", "input.amount", "metadata.region"
   */
  field: string;
  /** Comparison operator applied to the field's runtime value. */
  operator: ConstraintOperator;
  /** Right-hand side value for the comparison. */
  value?: unknown;
}

/**
 * Hard execution limits and policy constraints for this Decision Frame.
 *
 * ExecutionConstraints is the unified contract governing what the runtime
 * may do within this frame's lifetime. It combines:
 *   - hard numeric limits (maxExecutions, frameTtlMs)
 *   - capability scoping (allowedCapabilityIds)
 *   - cascade control (allowCascade)
 *   - a minimum confidence floor (confidenceFloor)
 *   - structured per-request policy constraints (policyConstraints)
 */
export interface ExecutionConstraints {
  /**
   * The subset of authorizedCapabilities that the runtime may invoke.
   * Must be a subset of the capabilityIds in DecisionFrame.authorizedCapabilities.
   * Allows the frame to authorize a broad set but restrict a given step to a narrower set.
   */
  allowedCapabilityIds: CapabilityId[];
  /**
   * Maximum number of Capability invocations permitted in this frame's lifetime.
   * The runtime rejects ExecutionRequests once this limit is reached.
   */
  maxExecutions: number;
  /**
   * Maximum wall-clock lifetime of this frame in milliseconds.
   * Should align with the duration between createdAt and expiresAt.
   */
  frameTtlMs: number;
  /**
   * Whether the AI may trigger chained or sub-executions from within
   * a Capability invocation. When false, cascade attempts are denied.
   */
  allowCascade: boolean;
  /**
   * Minimum AI confidence score required for any ExecutionRequest in this frame.
   * Requests below this floor are denied before policy evaluation begins.
   * When absent, no global floor is enforced (individual policies may still set thresholds).
   */
  confidenceFloor?: ConfidenceScore;
  /**
   * Structured constraints the Guardrail layer evaluates against each
   * ExecutionRequest produced by the AI within this frame.
   */
  policyConstraints: FramePolicyConstraint[];
}

// ---------------------------------------------------------------------------
// ApprovalRequirements
// ---------------------------------------------------------------------------

/**
 * What condition triggers this approval requirement.
 *
 * Used by the approval routing service to determine whether to open
 * an approval gate for a given ExecutionRequest.
 */
export type ApprovalTrigger =
  | "always"             // unconditional; always requires approval
  | "confidence-below"   // triggers when request confidence < a threshold
  | "capability-match"   // triggers for specific capabilities (see capabilityScope)
  | "risk-threshold";    // triggers when a computed risk score exceeds a limit

/**
 * An approval gate that must be cleared before an execution may proceed.
 *
 * ApprovalRequirements are placed in the frame by the Projection layer at
 * construction time. The Guardrail approval stage and the approval routing
 * service use them to determine when and how to solicit approval.
 */
export interface ApprovalRequirement {
  /** Unique identifier within this frame. */
  requirementId: RequirementId;
  /** Human-readable explanation of why approval is required. */
  reason: string;
  /** Role or identity class that may grant approval (e.g. "finance-lead"). */
  approverRole: string;
  /** Condition under which this requirement activates. Defaults to "always". */
  trigger?: ApprovalTrigger;
  /**
   * Maximum time to wait for approval before the request is resolved.
   * Must be a positive integer number of milliseconds.
   */
  timeoutMs: number;
  /**
   * When true, the request is denied automatically when timeoutMs elapses.
   * When false, the approval service may define its own timeout behaviour.
   */
  denyOnTimeout: boolean;
  /**
   * If set, this requirement only applies to ExecutionRequests targeting
   * one of these capability IDs. When absent, applies to all capabilities.
   */
  capabilityScope?: CapabilityId[];
}

// ---------------------------------------------------------------------------
// RetrievalContext
// ---------------------------------------------------------------------------

/** Category of the data source a retrieval result was fetched from. */
export type RetrievalSourceType =
  | "document"  // text documents, knowledge base articles, runbooks
  | "database"  // structured data from an operational database
  | "api"       // live data from an external API call
  | "telemetry" // operational metrics or signals
  | "memory"    // contextual memory from prior sessions
  | "cache";    // pre-computed or cached data

/** The retrieval strategy used to select results. */
export type RetrievalStrategy =
  | "semantic"  // embedding-based similarity
  | "keyword"   // lexical matching
  | "hybrid"    // combination of semantic and keyword
  | "exact"     // deterministic lookup by ID or key
  | "graph";    // knowledge graph traversal

/**
 * A single item surfaced by the retrieval subsystem into this frame.
 *
 * Retrieval results bound the AI's knowledge surface to the specific
 * enterprise data the Projection layer has deemed relevant and authorized.
 */
export interface RetrievalResult {
  /** Identifier of the source record or document. */
  sourceId: string;
  /** Category of the source system. */
  sourceType: RetrievalSourceType;
  /** Opaque content payload; shape is governed by sourceType. */
  content: unknown;
  /** Relevance of this result to the frame's userIntent (0.0–1.0). */
  relevanceScore: ConfidenceScore;
  /** When this result was fetched from the source system. */
  retrievedAt: ISOTimestamp;
  /** Optional citation URI for downstream traceability and attribution. */
  uri?: string;
  /**
   * Seconds until this result should be considered stale and re-fetched.
   * When absent, staleness policy is determined by the retrieval subsystem.
   */
  ttlSeconds?: number;
  /** Extension metadata for source-specific result attributes. */
  metadata?: Metadata;
}

/**
 * The full retrieval context projected into this Decision Frame.
 *
 * Wraps the individual retrieval results with metadata about how and when
 * they were fetched, allowing the runtime and audit layer to understand
 * the provenance of the AI's knowledge surface.
 */
export interface RetrievalContext {
  /** The set of results surfaced into this frame. */
  results: RetrievalResult[];
  /** Strategy used by the retrieval subsystem. */
  strategy?: RetrievalStrategy;
  /**
   * Total number of candidates considered before filtering to this result set.
   * Useful for understanding retrieval coverage.
   */
  totalCandidates?: number;
  /** When the retrieval was completed (may differ from individual result timestamps). */
  retrievedAt: ISOTimestamp;
}

// ---------------------------------------------------------------------------
// TelemetryReferences
// ---------------------------------------------------------------------------

/** Category of the telemetry data plane a reference points to. */
export type TelemetrySourceType =
  | "metrics"   // numeric time-series (CPU, error rate, latency)
  | "traces"    // distributed traces
  | "logs"      // structured log streams
  | "events"    // discrete operational events
  | "synthetic" // computed or simulated signals;

/**
 * An inline snapshot of metric values at a point in time.
 * Embedded in TelemetryReference when the full payload is small enough
 * to include directly in the frame rather than requiring a secondary fetch.
 */
export interface TelemetrySnapshot {
  /** Named numeric metrics at the time of capture. */
  metrics: Record<string, number>;
  /** Named signals of any type (status strings, boolean flags, etc.). */
  signals: Record<string, unknown>;
}

/**
 * A reference to a telemetry data source included in this Decision Frame.
 *
 * TelemetryReferences give the AI access to live operational signals without
 * granting direct data-plane access. References may include an inline snapshot
 * for common metrics; the `uri` field points to the full payload for richer queries.
 */
export interface TelemetryReference {
  /** Unique reference identifier within this frame. */
  referenceId: string;
  /** The system or data plane that produced this telemetry. */
  sourceSystem: string;
  /** Category of telemetry data. */
  sourceType: TelemetrySourceType;
  /**
   * The metric or signal keys available from this source.
   * Lets the AI know what signals it may reason about without fetching all data.
   */
  metricKeys: string[];
  /** When these signals were captured. */
  capturedAt: ISOTimestamp;
  /** URI to the full telemetry payload for richer access. */
  uri?: string;
  /**
   * Inline snapshot of high-priority metrics.
   * Present when the Projection layer has pre-fetched values to avoid
   * an additional round-trip during reasoning.
   */
  snapshot?: TelemetrySnapshot;
}

// ---------------------------------------------------------------------------
// FrameAuditMetadata
// ---------------------------------------------------------------------------

/**
 * What triggered construction of this Decision Frame.
 * Used for audit classification, reporting, and policy routing.
 */
export type FrameTriggerSource =
  | "user-request"          // interactive user session
  | "workflow-continuation" // runtime advancing a multi-step workflow
  | "scheduled"             // cron or timer-based trigger
  | "system"                // internal platform event
  | "api";                  // programmatic call from an external system

/**
 * Provenance and governance metadata written at frame-construction time.
 *
 * FrameAuditMetadata is immutable after construction. It is recorded verbatim
 * in every AuditRecord that references this frame, providing a complete
 * provenance chain without secondary lookups.
 */
export interface FrameAuditMetadata {
  /** What caused this frame to be constructed. */
  triggerSource: FrameTriggerSource;
  /** Semantic version of the Projection layer that built this frame. */
  projectionVersion: string;
  /**
   * Version identifier of the policy set active at construction time.
   * Enables replay and audit diffing against a known policy baseline.
   */
  policySetVersion: string;
  /**
   * Stable correlation ID linking all frames in a multi-step workflow chain.
   * All frames in the same workflow share the same correlationId.
   */
  correlationId?: string;
  /**
   * Classification labels for audit filtering, reporting, and alerting.
   * Examples: ["high-risk"], ["financial", "prod"], ["pii"].
   */
  tags: string[];
  /** Free-form notes from the Projection layer recorded at construction time. */
  notes?: string;
}

// ---------------------------------------------------------------------------
// DecisionFrame — root interface
// ---------------------------------------------------------------------------

/**
 * A Decision Frame represents the bounded operational context projected
 * to the AI runtime for a single reasoning cycle.
 *
 * The AI reasons *inside* this frame. It cannot access enterprise systems
 * directly — everything it knows (retrievalContext, telemetryReferences,
 * projectedContext.operationalState) and everything it may do
 * (authorizedCapabilities, executionConstraints) is determined by this frame.
 *
 * Runtime flow:
 *
 *   Projection layer builds DecisionFrame
 *       ↓
 *   AI reasons within frame boundaries
 *       ↓
 *   AI produces ExecutionRequest (capabilityId + input)
 *       ↓
 *   Guardrail pipeline validates request against this frame
 *       ↓
 *   Capability executes (or is denied / routed to approval)
 *       ↓
 *   AuditRecord written (references this frame's frameId)
 *
 * Field naming follows enterprise API conventions (camelCase).
 * All timestamps are ISO-8601 strings with timezone offset.
 */
export interface DecisionFrame {
  // -- Identity & lifecycle --

  /** Unique identifier for this frame. UUID v4 recommended. */
  frameId: FrameId;
  /** When the Projection layer constructed this frame. */
  createdAt: ISOTimestamp;
  /**
   * When this frame expires. No ExecutionRequest may reference a frame
   * past its expiry. The runtime enforces this mechanically.
   * Must be strictly after createdAt.
   */
  expiresAt: ISOTimestamp;

  // -- Intent --

  /**
   * The user or system intent that caused this frame to be constructed.
   * The Projection layer parses, normalizes, and classifies the raw input.
   */
  userIntent: UserIntent;

  // -- Operational context --

  /**
   * The bounded operational context projected to this frame's reasoning surface.
   * Groups session, principal, workflow, and environment information.
   */
  projectedContext: ProjectedContext;

  // -- Authorization --

  /**
   * Capabilities the AI is authorized to invoke within this frame.
   * Each entry carries enough metadata for the runtime to enforce entitlements
   * and approval routing without a secondary registry lookup.
   */
  authorizedCapabilities: CapabilityRef[];

  // -- Governance --

  /**
   * Hard execution limits and per-request policy constraints for this frame.
   * The Guardrail pipeline enforces these mechanically before any Capability executes.
   */
  executionConstraints: ExecutionConstraints;

  /**
   * Approval gates the runtime must clear before certain executions proceed.
   * Placed here by the Projection layer at construction time.
   */
  approvalRequirements: ApprovalRequirement[];

  // -- Knowledge surface --

  /**
   * The retrieval results and metadata projected into this frame.
   * Bounds the AI's knowledge to authorized and relevant enterprise data.
   */
  retrievalContext: RetrievalContext;

  /**
   * References to operational telemetry data sources available to the AI.
   * May include inline snapshots for high-priority signals.
   */
  telemetryReferences: TelemetryReference[];

  // -- Provenance --

  /**
   * Provenance and governance metadata written at construction time.
   * Immutable. Recorded verbatim in every AuditRecord referencing this frame.
   */
  auditMetadata: FrameAuditMetadata;

  // -- Extension --

  /** Domain-specific extension fields. Shape is caller-defined. */
  metadata?: Metadata;
}
