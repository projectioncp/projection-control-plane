/**
 * Projection Control Plane — Core Type Definitions
 *
 * These interfaces define the governed boundary between probabilistic AI reasoning
 * and deterministic enterprise execution. All runtime objects flow through these
 * contracts.
 *
 * Architecture:
 *   Projection layer  →  DecisionFrame     (what the AI sees)
 *   Guardrail layer   →  GuardrailPolicy   (what the AI can do)
 *   Execution layer   →  ExecutionRequest  (what gets run)
 *   Capability layer  →  Capability        (how it runs)
 *   Hook layer        →  HookContext       (lifecycle interception)
 *   Audit layer       →  AuditRecord       (tamper-evident trail)
 */

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/** ISO-8601 timestamp string. Used wherever serialization matters. */
export type ISOTimestamp = string;

/** Stable identifier (UUID v4 recommended). */
export type ID = string;

/** Confidence score from the AI reasoning layer: 0.0 (none) → 1.0 (certain). */
export type ConfidenceScore = number;

/** Arbitrary key/value payload for extensibility without breaking interfaces. */
export type Metadata = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Supporting types — DecisionFrame
// ---------------------------------------------------------------------------

/** A single item surfaced by the retrieval subsystem into a Decision Frame. */
export interface RetrievalResult {
  sourceId: string;
  sourceType: "document" | "database" | "api" | "telemetry" | "memory";
  content: unknown;
  relevanceScore: ConfidenceScore;
  retrievedAt: ISOTimestamp;
  /** Optional citation URI for traceability. */
  uri?: string;
}

/** Point-in-time operational telemetry snapshot included in a Decision Frame. */
export interface TelemetrySnapshot {
  capturedAt: ISOTimestamp;
  metrics: Record<string, number>;
  signals: Record<string, unknown>;
  /** Identifies which system / data plane produced these metrics. */
  source: string;
}

/**
 * A scoped constraint applied to AI reasoning within a Decision Frame.
 * Constraints express policy rules in a structured, evaluable form.
 */
export interface PolicyConstraint {
  constraintId: ID;
  /** Human-readable explanation shown to the AI in the frame. */
  description: string;
  /** The field path on ExecutionRequest or Capability this constraint targets. */
  field: string;
  operator:
    | "eq"
    | "neq"
    | "gt"
    | "lt"
    | "gte"
    | "lte"
    | "in"
    | "not-in"
    | "contains"
    | "regex";
  value: unknown;
}

/** Specifies when and how human (or system) approval is required. */
export interface ApprovalRequirement {
  requirementId: ID;
  /** Human-readable reason for this approval gate. */
  reason: string;
  approverRole: string;
  /** Maximum time to wait for approval before the request is denied. */
  timeoutMs: number;
  /** If true, denial is the default when timeout elapses. */
  denyOnTimeout: boolean;
}

/** Hard limits placed on what a Decision Frame may trigger. */
export interface ExecutionBoundary {
  /** Capability IDs explicitly permitted within this frame. */
  allowedCapabilityIds: ID[];
  /** Maximum number of capability invocations allowed in this frame's lifetime. */
  maxExecutions: number;
  /** Maximum wall-clock lifetime of this frame in milliseconds. */
  frameTtlMs: number;
  /** Whether chained / sub-executions are permitted. */
  allowCascade: boolean;
}

// ---------------------------------------------------------------------------
// DecisionFrame — audit metadata
// ---------------------------------------------------------------------------

/** What initiated construction of this Decision Frame. */
export type FrameTriggerSource =
  | "user-request"          // interactive user session
  | "workflow-continuation" // runtime advancing a multi-step workflow
  | "scheduled"             // cron / timer-based trigger
  | "system"                // internal platform event
  | "api";                  // programmatic call from an external system

/**
 * Provenance and governance metadata written at frame-construction time.
 * Included verbatim in every AuditRecord that references this frame.
 * Must never be mutated after the frame is created.
 */
export interface FrameAuditMetadata {
  /** What caused this frame to be constructed. */
  triggerSource: FrameTriggerSource;
  /** Semantic version of the Projection layer that built this frame. */
  projectionVersion: string;
  /** Version identifier of the policy set active at construction time. */
  policySetVersion: string;
  /**
   * Stable correlation ID for linking a chain of related frames across
   * a multi-step workflow. All frames in the same workflow share this value.
   */
  correlationId?: ID;
  /**
   * Arbitrary labels for audit filtering, reporting, and classification.
   * Examples: ["high-risk", "financial", "prod"].
   */
  tags: string[];
  /** Free-form notes written by the Projection layer at construction time. */
  notes?: string;
}

// ---------------------------------------------------------------------------
// DecisionFrame
// ---------------------------------------------------------------------------

/**
 * A bounded operational context object constructed by the Projection layer.
 *
 * The AI reasons *inside* the Decision Frame rather than against raw enterprise
 * systems. The frame defines the AI's complete operational reality for a single
 * reasoning cycle: what it knows, what it may do, and the rules it must follow.
 */
export interface DecisionFrame {
  id: ID;
  createdAt: ISOTimestamp;
  /** When this frame expires and can no longer be used to authorize execution. */
  expiresAt: ISOTimestamp;

  // -- Intent & workflow context --
  /** The user or system intent that caused this frame to be constructed. */
  intent: string;
  sessionId: ID;
  workflowId?: ID;
  /** Step within an ongoing workflow, if applicable. */
  workflowStep?: string;

  // -- Bounded operational context --
  /** Current state of the workflow or process being reasoned about. */
  operationalState: Record<string, unknown>;
  /** Retrieval results injected into the frame by the Projection layer. */
  retrievalResults: RetrievalResult[];
  /** Live telemetry snapshot available to the AI for reasoning. */
  telemetry: TelemetrySnapshot;

  // -- Governance --
  /** IDs of Capabilities the AI is authorized to invoke in this frame. */
  authorizedCapabilityIds: ID[];
  /** Structured constraints the AI must respect when reasoning. */
  policyConstraints: PolicyConstraint[];
  /** Approval gates required before certain executions proceed. */
  approvalRequirements: ApprovalRequirement[];
  /** Hard execution limits enforced by the runtime. */
  executionBoundaries: ExecutionBoundary;

  // -- Authorization --
  /** The identity (user, service account, agent) this frame was issued to. */
  principalId: ID;
  /** Entitlement tokens the principal holds at frame-creation time. */
  entitlements: string[];

  // -- Memory --
  /** References to contextual memory entries the AI may cite. */
  contextualMemoryRefs: ID[];

  /** Provenance and governance metadata recorded at frame-construction time. */
  auditMetadata: FrameAuditMetadata;

  metadata: Metadata;
}

// ---------------------------------------------------------------------------
// Capability
// ---------------------------------------------------------------------------

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
 * JSON-Schema-compatible input/output contract for a Capability.
 * The runtime validates ExecutionRequest inputs against `input` before
 * invoking, and validates results against `output` before returning.
 */
export interface CapabilitySchema {
  /** JSON Schema object describing accepted input. */
  input: Record<string, unknown>;
  /** JSON Schema object describing the expected output. */
  output: Record<string, unknown>;
}

/**
 * A deterministic enterprise operation exposed to the AI runtime.
 *
 * Capabilities are the only mechanism through which the AI can affect
 * enterprise systems. They execute deterministically; the AI only reasons.
 */
export interface Capability {
  id: ID;
  name: string;
  description: string;
  category: CapabilityCategory;
  /** Semantic version string, e.g. "1.2.0". */
  version: string;

  // -- Contract --
  schema: CapabilitySchema;

  // -- Authorization --
  /** Entitlement tokens a principal must hold to invoke this Capability. */
  requiredEntitlements: string[];

  // -- Execution behavior --
  /** Maximum allowed duration in milliseconds before the runtime times out. */
  timeoutMs: number;
  /**
   * Whether repeated invocations with identical inputs produce the same
   * side-effect. Informs retry and deduplication logic.
   */
  idempotent: boolean;
  /**
   * Whether this Capability requires explicit approval before the runtime
   * will execute it, regardless of Guardrail policy.
   */
  requiresApproval: boolean;
  /** Whether this Capability can be rolled back after execution. */
  rollbackSupported: boolean;

  metadata: Metadata;
}

// ---------------------------------------------------------------------------
// GuardrailPolicy
// ---------------------------------------------------------------------------

export type GuardrailAction =
  | "allow"
  | "deny"
  | "require-approval"
  | "flag"
  | "rate-limit";

/**
 * A single evaluable condition used in a GuardrailPolicy rule.
 * Conditions are evaluated against the ExecutionRequest at validation time.
 */
export interface PolicyCondition {
  /** JSONPath-style field reference on ExecutionRequest, e.g. "confidence". */
  field: string;
  operator: PolicyConstraint["operator"];
  value: unknown;
}

/**
 * A Guardrail policy governs whether an ExecutionRequest is allowed to proceed.
 *
 * Policies are evaluated in priority order (lower number = higher priority).
 * The first matching policy wins. If no policy matches, the default action
 * is "deny" — the system fails closed.
 */
export interface GuardrailPolicy {
  id: ID;
  name: string;
  description?: string;
  /** Evaluation order. Lower values are evaluated first. */
  priority: number;
  enabled: boolean;

  // -- Conditions that activate this policy --
  /**
   * All conditions must match for the policy to apply (AND semantics).
   * An empty array means "match everything."
   */
  conditions: PolicyCondition[];

  // -- Thresholds --
  /**
   * Minimum AI confidence required to pass this policy.
   * Requests below threshold trigger the policy's action.
   */
  confidenceThreshold?: ConfidenceScore;

  // -- Capability filters --
  /** If set, only these capability IDs are evaluated by this policy. */
  scopedCapabilityIds?: ID[];

  // -- Outcome --
  /** Action taken when this policy matches. */
  action: GuardrailAction;
  /** Human-readable justification included in audit records on trigger. */
  actionReason?: string;

  createdAt: ISOTimestamp;
  updatedAt: ISOTimestamp;
  metadata: Metadata;
}

// ---------------------------------------------------------------------------
// ExecutionRequest
// ---------------------------------------------------------------------------

export type ExecutionStatus =
  | "pending"
  | "validating"
  | "awaiting-approval"
  | "approved"
  | "denied"
  | "executing"
  | "completed"
  | "failed"
  | "rolled-back"
  | "timed-out";

/**
 * A request to invoke a Capability, produced by the AI reasoning layer.
 *
 * The runtime subjects every ExecutionRequest to Guardrail validation before
 * any enterprise system is touched. The request carries the full provenance
 * chain (frame, session, principal) needed for audit and rollback.
 */
export interface ExecutionRequest {
  id: ID;
  createdAt: ISOTimestamp;

  // -- What to execute --
  capabilityId: ID;
  /** Input payload validated against Capability.schema.input before execution. */
  input: Record<string, unknown>;

  // -- Provenance --
  decisionFrameId: ID;
  sessionId: ID;
  principalId: ID;

  // -- AI reasoning metadata --
  /** The AI's self-reported confidence that this action is correct. */
  confidence: ConfidenceScore;
  /** The AI's explanation for why it is requesting this execution. */
  rationale?: string;

  // -- State --
  status: ExecutionStatus;
  /** Populated when status reaches "completed" or "failed". */
  completedAt?: ISOTimestamp;
  /** Populated when status is "failed", "denied", or "timed-out". */
  errorMessage?: string;

  // -- Chaining --
  /** Stable ID for correlating a chain of related requests. */
  correlationId?: ID;
  /** ID of the parent ExecutionRequest if this is a cascaded sub-execution. */
  parentRequestId?: ID;

  metadata: Metadata;
}

// ---------------------------------------------------------------------------
// AuditRecord
// ---------------------------------------------------------------------------

export type AuditEventType =
  | "frame-created"
  | "frame-expired"
  | "execution-requested"
  | "guardrail-evaluated"
  | "approval-requested"
  | "approval-granted"
  | "approval-denied"
  | "capability-executed"
  | "execution-failed"
  | "execution-timed-out"
  | "rollback-initiated"
  | "rollback-completed"
  | "hook-triggered"
  | "policy-violation"
  | "entitlement-denied";

export type AuditOutcome = "success" | "failure" | "denied" | "pending";

/**
 * An immutable record of a single governance event in the runtime.
 *
 * AuditRecords form the tamper-evident ledger of everything the system
 * did, decided, or blocked. They must never be mutated after creation.
 * The optional `checksum` field enables integrity verification.
 */
export interface AuditRecord {
  id: ID;
  timestamp: ISOTimestamp;
  eventType: AuditEventType;
  outcome: AuditOutcome;

  // -- Cross-references (all optional; populate whichever apply) --
  executionRequestId?: ID;
  decisionFrameId?: ID;
  capabilityId?: ID;
  policyId?: ID;
  hookId?: ID;

  // -- Actor --
  principalId: ID;
  sessionId: ID;

  // -- Detail payload --
  /** Structured detail about what happened; shape varies by eventType. */
  details: Metadata;

  // -- Integrity --
  /**
   * SHA-256 hash of the canonical JSON serialization of this record
   * (computed with `checksum` set to null). Used for tamper detection.
   */
  checksum?: string;

  metadata: Metadata;
}

// ---------------------------------------------------------------------------
// HookContext
// ---------------------------------------------------------------------------

export type HookStage =
  | "pre-validation"    // before Guardrail evaluates the request
  | "post-validation"   // after Guardrail passes or fails
  | "pre-execution"     // immediately before Capability.execute is called
  | "post-execution"    // after Capability returns successfully
  | "on-error"          // when execution throws
  | "on-approval"       // when an approval decision arrives
  | "on-rollback";      // when rollback is triggered

export type HookOutcome =
  | "continue"    // proceed with normal flow
  | "abort"       // halt execution and surface an error
  | "retry"       // re-queue the ExecutionRequest for another attempt
  | "escalate";   // route to human review outside the normal approval flow

/** Result produced by a single hook handler. */
export interface HookResult {
  hookId: ID;
  stage: HookStage;
  outcome: HookOutcome;
  /** Optional structured payload the hook wants to pass to subsequent hooks. */
  payload?: Metadata;
  /** Human-readable explanation, surfaced in audit records. */
  reason?: string;
  timestamp: ISOTimestamp;
}

/**
 * The context object passed to every hook handler at a lifecycle stage.
 *
 * Hooks receive the full execution context so they can make informed
 * decisions: approve, abort, escalate, emit telemetry, or trigger rollback.
 * Hooks must not mutate ExecutionRequest or DecisionFrame directly;
 * they signal intent through HookResult.outcome.
 */
export interface HookContext {
  hookId: ID;
  stage: HookStage;
  timestamp: ISOTimestamp;

  // -- Runtime context --
  executionRequest: ExecutionRequest;
  decisionFrame: DecisionFrame;

  // -- Pipeline state --
  /**
   * Results produced by previously-run hooks at the same stage.
   * Allows hooks to compose decisions rather than operating in isolation.
   */
  previousResults: HookResult[];

  // -- Stage-specific payloads --
  /**
   * Present in post-execution and on-error hooks.
   * Contains the raw output from the Capability, or undefined on failure.
   */
  executionResult?: unknown;
  /**
   * Present in on-error hooks.
   */
  error?: {
    message: string;
    code?: string;
    stack?: string;
  };
  /**
   * Present in on-approval hooks.
   */
  approvalDecision?: {
    approved: boolean;
    approverId: ID;
    decidedAt: ISOTimestamp;
    notes?: string;
  };

  metadata: Metadata;
}
