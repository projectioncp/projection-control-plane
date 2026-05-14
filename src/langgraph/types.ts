/**
 * LangGraph Integration — Framework-Agnostic Orchestration Types
 *
 * This module defines the orchestration contracts for the Projection Control
 * Plane's LangGraph integration layer. It is the boundary specification —
 * every type here is defined independently of LangGraph so that the business
 * logic layers (Projection, Guardrail, Capabilities, Audit) never acquire a
 * dependency on an orchestration framework.
 *
 * Architecture position:
 *
 *   ┌─────────────────────────────────────────────────────────────────────┐
 *   │  LangGraph Runtime (external)                                       │
 *   │    StateGraph  ──► compiled graph ──► invoke / stream              │
 *   │        │                                                            │
 *   │   LangGraphOrchestrationAdapter  (adapter.ts)                      │
 *   │        │  translates state ◄──► OrchestrationState                 │
 *   │        │  wraps nodes     ◄──► OrchestrationNodeFn                 │
 *   │        │  wraps routers   ◄──► OrchestrationRouter                 │
 *   ├────────┼────────────────────────────────────────────────────────────┤
 *   │        │  OrchestrationState (this file)                           │
 *   │        │       │                                                    │
 *   │  OrchestrationNodeFn calls:                                        │
 *   │    FrameProjector     ──► Projection layer (projection/)           │
 *   │    GuardrailEvaluator ──► Guardrail pipeline (guardrail/)          │
 *   │    CapabilityDispatcher ► Capability registry (capabilities/)      │
 *   │    ApprovalGateway    ──► Approval service                         │
 *   │    ResponseSynthesizer ► AI generation layer                       │
 *   │    AuditEmitter       ──► Audit layer (audit/)                     │
 *   └─────────────────────────────────────────────────────────────────────┘
 *
 * Ownership boundaries:
 *   LangGraph owns:  graph topology, state persistence, turn sequencing,
 *                    streaming, interrupt/resume for approvals.
 *   Projection owns: DecisionFrame construction, intent interpretation.
 *   Guardrail owns:  ExecutionRequest governance, policy enforcement.
 *   Capabilities own: deterministic handler invocation, side effects.
 *   This layer owns: OrchestrationState shape, phase transitions,
 *                    conversation history, approval gate lifecycle,
 *                    node/router function signatures.
 *
 * Coupling invariants:
 *   1. No file in this module imports from `@langchain/langgraph`.
 *   2. No file in Projection, Guardrail, or Capabilities imports from this module.
 *   3. LangGraph types appear ONLY as generic type parameters in adapter.ts.
 *   4. OrchestrationState may reference canonical PCP types but not LangGraph types.
 *
 * Related modules:
 *   nodes.ts    — Service interfaces and node function contracts
 *   adapter.ts  — LangGraph bridging layer (generics, no LangGraph imports)
 *   graph.ts    — Standard workflow graph topology definition
 *   index.ts    — Public barrel
 */

import type {
  CapabilityId,
  ConfidenceScore,
  FrameId,
  ISOTimestamp,
  Metadata,
  PrincipalId,
  DecisionFrame,
  IntentCategory,
} from "../projection/frame.js";
import type { ExecutionRequest } from "../types.js";
import type { GuardrailResult, GuardrailDecision } from "../guardrail/types.js";
import type {
  CapabilityExecutionRequest,
  CapabilityExecutionResult,
} from "../capabilities/execution.js";
import type { TraceId, AuditRecord } from "../audit/types.js";

// ---------------------------------------------------------------------------
// Re-exports for consumers of this module
// ---------------------------------------------------------------------------

export type {
  CapabilityId,
  ConfidenceScore,
  FrameId,
  ISOTimestamp,
  Metadata,
  PrincipalId,
  TraceId,
};

// ---------------------------------------------------------------------------
// WorkflowPhase — the orchestration state machine
// ---------------------------------------------------------------------------

/**
 * The current execution phase of the orchestration workflow.
 *
 * Each value represents a distinct step in the lifecycle of one conversation
 * turn. Phases transition in response to node completions and routing decisions.
 *
 * Valid transition graph:
 *
 *   idle
 *     └─► intent-received          (user sends a message)
 *
 *   intent-received
 *     └─► projecting               (projection node starts)
 *
 *   projecting
 *     ├─► awaiting-guardrail       (frame built, execution requested)
 *     ├─► generating-response      (frame built, no execution needed)
 *     └─► faulted                  (projection failed)
 *
 *   awaiting-guardrail
 *     ├─► awaiting-approval        (guardrail: require-approval)
 *     ├─► executing                (guardrail: allow or flag)
 *     ├─► generating-response      (guardrail: deny)
 *     └─► faulted                  (guardrail pipeline error)
 *
 *   awaiting-approval
 *     ├─► executing                (approval granted)
 *     ├─► generating-response      (approval denied or timed out)
 *     └─► faulted                  (approval system error)
 *
 *   executing
 *     ├─► generating-response      (execution complete)
 *     ├─► awaiting-rollback        (rollback triggered)
 *     └─► faulted                  (unhandled execution error)
 *
 *   awaiting-rollback
 *     ├─► generating-response      (rollback complete)
 *     └─► faulted                  (rollback failed)
 *
 *   generating-response
 *     └─► completed                (response emitted)
 *
 *   completed
 *     └─► idle                     (ready for next turn)
 *
 *   faulted
 *     ├─► generating-response      (recoverable error — tell user)
 *     └─► terminated               (fatal error — session ends)
 *
 *   terminated                     (terminal — no further transitions)
 */
export type WorkflowPhase =
  | "idle"                 // waiting for user input
  | "intent-received"      // user message received; not yet processed
  | "projecting"           // Projection layer building DecisionFrame
  | "awaiting-guardrail"   // Guardrail pipeline evaluating ExecutionRequest
  | "awaiting-approval"    // approval gate open; execution suspended
  | "executing"            // Capability handler running
  | "awaiting-rollback"    // rollback in progress after execution
  | "generating-response"  // AI composing natural language response
  | "completed"            // turn complete; ready for next input
  | "faulted"              // error encountered; recovery decision pending
  | "terminated";          // session ended; no further turns possible

// ---------------------------------------------------------------------------
// Conversation model
// ---------------------------------------------------------------------------

/**
 * Role of a participant in the conversation.
 *
 * Note: there is intentionally no "tool" role. In PCP, capability invocations
 * are governed artifacts — they appear in the conversation as structured
 * CapabilityRequestContentBlock / CapabilityResultContentBlock pairs within
 * "assistant" or "system" messages. Direct AI-to-tool communication that
 * bypasses Projection → Guardrail → Capability is not permitted.
 */
export type ConversationRole = "user" | "assistant" | "system";

/**
 * A text block within a conversation message.
 */
export interface TextContentBlock {
  type: "text";
  text: string;
}

/**
 * A capability request block — the AI requesting a governed capability execution.
 *
 * This is the bridge between the AI's reasoning and the Capability layer.
 * The orchestration layer translates this block into an ExecutionRequest,
 * which is then routed through Projection → Guardrail before any capability
 * handler is invoked. Direct AI-to-capability calls are not permitted.
 *
 * Naming note: "capability-request" is deliberate — not "tool-use". The
 * distinction signals that ALL capability invocations are governed artifacts,
 * not direct LLM tool calls that bypass the PCP execution boundary.
 */
export interface CapabilityRequestContentBlock {
  type: "capability-request";
  /** Stable capability identifier from the Capability registry. */
  capabilityId: string;
  /** Human-readable capability name (for logging and audit, not routing). */
  capabilityName: string;
  /** The AI-supplied input payload for the capability. */
  input: Record<string, unknown>;
  /** The AI's self-reported confidence in this capability request (0.0–1.0). */
  confidence?: ConfidenceScore;
  /**
   * The AI's rationale for this request.
   * Captured for governance audit and human review — NOT surfaced to the
   * Capability handler or included in ExecutionRequest parameters.
   */
  rationale?: string;
}

/**
 * A capability result block — the governed execution result returned to the AI.
 *
 * The orchestration layer synthesizes this from CapabilityExecutionResult
 * after the capability handler has completed and injects it back into the
 * conversation so the AI can reason about the outcome before generating
 * its final response.
 *
 * The result is sanitized by the orchestration layer before injection —
 * internal error details, policy state, and system identifiers are stripped.
 */
export interface CapabilityResultContentBlock {
  type: "capability-result";
  /** ID of the corresponding capability-request block. */
  capabilityRequestId: string;
  /** Whether the capability execution succeeded. */
  isError: boolean;
  /** The sanitized output payload from the capability, or a safe error message. */
  content: string | Record<string, unknown>;
}

/** Union of all content block types. */
export type ConversationContentBlock =
  | TextContentBlock
  | CapabilityRequestContentBlock
  | CapabilityResultContentBlock;

/**
 * A single message in the conversation history.
 *
 * Messages accumulate across turns (append-only). The full history
 * is available to the AI for multi-turn reasoning continuity.
 *
 * LangGraph state channel semantics: append (never replace).
 * The LangGraph adapter uses a `(prev, next) => [...prev, ...next]`
 * reducer for the messages field.
 */
export interface ConversationMessage {
  /** Stable message identifier. UUID v4 recommended. */
  messageId: string;
  role: ConversationRole;
  /**
   * Message content. String for simple text; array when the message
   * carries mixed content (text + tool use/results).
   */
  content: string | ConversationContentBlock[];
  /** When this message was created. */
  createdAt: ISOTimestamp;
  /**
   * Input + output token counts for this message.
   * Present when the message was generated by an AI model.
   */
  tokenUsage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
  };
  /**
   * The AI model that produced this message.
   * Present for assistant messages.
   */
  model?: string;
  /** Extension metadata (e.g. routing labels, A/B test flags). */
  metadata?: Metadata;
}

/**
 * What kind of outcome a completed conversation turn produced.
 *
 *   responded          — AI responded without executing any capability
 *   executed           — Capability was invoked and completed (success or failure)
 *   denied             — Guardrail denied the execution request
 *   awaiting-approval  — Turn is suspended pending external approval
 *   error              — An unrecoverable error ended the turn
 */
export type TurnOutcome =
  | "responded"
  | "executed"
  | "denied"
  | "awaiting-approval"
  | "error";

/**
 * A snapshot of an in-progress conversation turn.
 *
 * This object exists only while a turn is active. When the turn completes,
 * it is converted to a CompletedConversationTurn and moved to `completedTurns`.
 */
export interface ActiveConversationTurn {
  /** Stable turn identifier. UUID v4 recommended. */
  turnId: string;
  /** When the user message was received. */
  startedAt: ISOTimestamp;
  /** The user message that initiated this turn. */
  userMessage: ConversationMessage;
  /** Current execution phase for this turn. */
  phase: WorkflowPhase;
  /** The execution request pending Guardrail evaluation, if any. */
  pendingExecutionRequestId?: string;
  /** The capability being executed, if any. */
  capabilityId?: CapabilityId;
  /** Extension metadata. */
  metadata?: Metadata;
}

/**
 * A finalized record of a completed conversation turn.
 *
 * Captures the complete causal chain of a single turn: what the user asked,
 * what the AI decided to do, what governance controls applied, what executed,
 * and what the AI responded. Used for multi-turn context and analytics.
 *
 * LangGraph state channel semantics: append (accumulated across turns).
 */
export interface CompletedConversationTurn {
  /** Stable turn identifier. Matches the originating ActiveConversationTurn. */
  turnId: string;
  startedAt: ISOTimestamp;
  completedAt: ISOTimestamp;
  /** Wall-clock duration of this turn in milliseconds. */
  durationMs: number;
  /** What happened during this turn. */
  outcome: TurnOutcome;
  /** The user's message that started this turn. */
  userMessageId: string;
  /** The AI's final response message for this turn. */
  assistantMessageId?: string;
  // -- Governance summary --
  /** The Decision Frame constructed for this turn. */
  frameId?: FrameId;
  /** The ExecutionRequest produced by the AI, if any. */
  executionRequestId?: string;
  /** The Guardrail pipeline decision, if a request was made. */
  guardrailDecision?: GuardrailDecision;
  /** The capability that was invoked, if any. */
  capabilityId?: CapabilityId;
  capabilityVersion?: string;
  /** The audit trace covering this turn's full lifecycle. */
  traceId?: TraceId;
  /** Extension metadata. */
  metadata?: Metadata;
}

// ---------------------------------------------------------------------------
// Approval gate state
// ---------------------------------------------------------------------------

/**
 * Lifecycle status of a pending approval gate.
 *
 *   open       — gate is awaiting an approver's decision
 *   granted    — an approver explicitly granted the request
 *   denied     — an approver explicitly denied the request
 *   timed-out  — the gate's timeoutMs elapsed without a decision
 */
export type ApprovalGateStatus = "open" | "granted" | "denied" | "timed-out";

/**
 * The persisted state of an approval gate within OrchestrationState.
 *
 * When the Guardrail pipeline returns a "require-approval" decision,
 * the orchestration layer opens an approval gate and suspends the turn.
 * LangGraph's interrupt mechanism pauses graph execution. The approval
 * service resolves the gate asynchronously; the graph resumes via
 * `CompiledOrchestrationGraph.resumeApproval()`.
 *
 * LangGraph state channel semantics: append (gates accumulate; closed
 * gates are retained for audit).
 */
export interface ApprovalGateState {
  /** Stable gate identifier. UUID v4 recommended. */
  gateId: string;
  /** The turn this gate belongs to. */
  turnId: string;
  /** The ExecutionRequest awaiting approval. */
  executionRequestId: string;
  /** The capability the approval is gating. */
  capabilityId: CapabilityId;
  /** Approval requirement IDs from the Decision Frame. */
  requirementIds: string[];
  /** Role or identity class qualified to approve. */
  approverRole: string;
  /** The policy that triggered this gate, if applicable. */
  policyId?: string;
  /** When this gate was opened. */
  openedAt: ISOTimestamp;
  /** When this gate will time out if not resolved. */
  timeoutAt: ISOTimestamp;
  status: ApprovalGateStatus;
  /** The identity of the approver who resolved this gate. */
  approverId?: string;
  /** When the gate was resolved. */
  resolvedAt?: ISOTimestamp;
  /** Notes provided by the approver or the timeout system. */
  notes?: string;
}

// ---------------------------------------------------------------------------
// Orchestration errors
// ---------------------------------------------------------------------------

/**
 * Machine-readable codes for errors in the orchestration layer.
 *
 * Each code identifies where in the workflow the error occurred and whether
 * the turn can be recovered (error surfaced to user) or is fatal (session ends).
 */
export type OrchestrationErrorCode =
  | "PROJECTION_FAILED"      // Projection layer could not build a DecisionFrame
  | "GUARDRAIL_ERROR"        // Guardrail pipeline threw an unexpected error
  | "CAPABILITY_ERROR"       // Capability invocation failed beyond retry
  | "APPROVAL_TIMEOUT"       // Approval gate timed out
  | "APPROVAL_SYSTEM_ERROR"  // Approval service returned an error
  | "ROLLBACK_FAILED"        // Rollback handler failed
  | "RESPONSE_ERROR"         // Response generation failed
  | "HOOK_ERROR"             // A fail-closed hook threw an error
  | "STATE_INVALID"          // OrchestrationState is in an inconsistent state
  | "INTERNAL_ERROR";        // Unexpected error with no specific classification

/**
 * Structured error in the orchestration layer.
 *
 * Captured in `OrchestrationState.error` when a node faults. The error
 * classification drives the fault handler's recovery decision: recoverable
 * errors are surfaced to the user; fatal errors terminate the session.
 */
export interface OrchestrationError {
  code: OrchestrationErrorCode;
  /** Human-readable explanation. Must not contain credentials or PII. */
  message: string;
  /** The workflow phase in which the error occurred. */
  failedPhase: WorkflowPhase;
  /** Whether the orchestration layer should attempt to recover and respond to the user. */
  recoverable: boolean;
  /**
   * Sanitized cause description for diagnostics.
   * Must not contain stack traces, credentials, or raw error messages
   * that could leak implementation details.
   */
  cause?: string;
  /** Machine-readable detail for structured logging. */
  detail?: Record<string, unknown>;
  /** The audit record capturing this error event, if one was emitted. */
  auditRecordId?: string;
}

// ---------------------------------------------------------------------------
// OrchestrationState — the shared graph state
// ---------------------------------------------------------------------------

/**
 * The complete, persistent state of a governed conversational workflow.
 *
 * OrchestrationState is the single source of truth that LangGraph persists,
 * checkpoints, and threads across nodes. Every node reads from it and returns
 * an OrchestrationStateUpdate describing how it should change.
 *
 * LangGraph state channel semantics per field:
 *
 *   REPLACE (last-write wins):
 *     phase, activeTurn, currentFrame, pendingExecutionRequest,
 *     guardrailResult, capabilityResult, activeApprovalGateId,
 *     error, traceId
 *
 *   APPEND (accumulate across turns):
 *     messages, completedTurns, approvalGates, auditRecords
 *
 *   MERGE (shallow object merge):
 *     metadata
 *
 * The LangGraphOrchestrationAdapter (adapter.ts) translates these semantics
 * into LangGraph Annotation reducers. Node functions always work with the
 * full OrchestrationState and return OrchestrationStateUpdate — the adapter
 * handles the translation to LangGraph's partial-state update model.
 *
 * Persistence:
 *   LangGraph persists this state via its checkpointer (Postgres, SQLite,
 *   Redis, etc.). All fields must be JSON-serializable. Function values
 *   (node implementations, service instances) are never stored — they are
 *   re-injected at graph compilation time via OrchestrationContext.
 */
export interface OrchestrationState {
  // -- Identity (immutable after session start) --

  /**
   * Stable identifier for this conversation.
   * Shared across all turns. Used as the LangGraph thread_id.
   */
  conversationId: string;

  /** Session identifier. Matches DecisionFrame.projectedContext.sessionId. */
  sessionId: string;

  /** The principal on whose behalf this conversation runs. */
  principalId: PrincipalId;

  /** Workflow identifier for multi-step orchestrations. */
  workflowId?: string;

  /**
   * Stable correlation ID propagated across all frames and requests
   * produced in this conversation.
   */
  correlationId?: string;

  // -- Phase --

  /**
   * Current execution phase of the orchestration workflow.
   * The LangGraph node currently executing determines the next phase via
   * the OrchestrationStateUpdate it returns.
   */
  phase: WorkflowPhase;

  // -- Conversation history (APPEND) --

  /**
   * Full conversation history across all turns.
   * New messages are appended; existing messages are never mutated.
   * LangGraph channel reducer: `(prev, next) => [...prev, ...next]`.
   */
  messages: ConversationMessage[];

  // -- Turn tracking --

  /**
   * The in-progress turn. Null between turns.
   * Replaced (not appended) on each turn start and cleared on completion.
   */
  activeTurn?: ActiveConversationTurn;

  /**
   * Finalized summaries of all completed turns. (APPEND)
   * LangGraph channel reducer: `(prev, next) => [...prev, ...next]`.
   */
  completedTurns: CompletedConversationTurn[];

  // -- Current turn: Projection layer output --

  /**
   * The Decision Frame constructed for the current turn.
   * Null between turns or when projection has not yet run.
   * Replaced at the start of each turn's projection phase.
   */
  currentFrame?: DecisionFrame;

  // -- Current turn: Guardrail pipeline state --

  /**
   * The ExecutionRequest the AI produced for the current turn.
   * Set by the projection phase; cleared when the request completes.
   */
  pendingExecutionRequest?: ExecutionRequest;

  /**
   * The Guardrail pipeline's verdict for the current turn.
   * Set by the guardrail node; cleared at the start of each new turn.
   */
  guardrailResult?: GuardrailResult;

  // -- Current turn: Capability execution state --

  /**
   * The result returned by the Capability handler for the current turn.
   * Set by the capability execution node; cleared at the start of each new turn.
   */
  capabilityResult?: CapabilityExecutionResult;

  // -- Approval gate state (APPEND) --

  /**
   * The gateId of the approval gate currently awaiting resolution.
   * Set when the approval node fires; cleared when the gate resolves.
   * Null when no approval is pending.
   */
  activeApprovalGateId?: string;

  /**
   * All approval gates opened during this conversation. (APPEND)
   * Includes resolved gates (status !== "open") for audit completeness.
   * LangGraph channel reducer: `(prev, next) => [...prev, ...next]`.
   */
  approvalGates: ApprovalGateState[];

  // -- Audit (APPEND) --

  /**
   * The distributed trace identifier for the current turn's execution chain.
   * New traceId assigned at the start of each turn.
   */
  traceId?: TraceId;

  /**
   * Audit records emitted during the current turn. (APPEND)
   * Consumers may flush these to the Audit layer's persistent store.
   * LangGraph channel reducer: `(prev, next) => [...prev, ...next]`.
   */
  auditRecords: AuditRecord[];

  // -- Error state --

  /**
   * The most recent orchestration error.
   * Set by any node that faults; cleared at the start of each new turn.
   * The fault handler node reads this to decide on recovery vs. termination.
   */
  error?: OrchestrationError;

  // -- Extension --

  /** Domain-specific extension fields. Shape is caller-defined. */
  metadata?: Metadata;
}

// ---------------------------------------------------------------------------
// OrchestrationStateUpdate — what a node returns
// ---------------------------------------------------------------------------

/**
 * A typed description of how a node wants to change OrchestrationState.
 *
 * Node functions return this rather than a partial state object so that
 * append-vs-replace semantics are explicit. The adapter translates this
 * into the LangGraph partial-state update format before returning from
 * the wrapped node function.
 *
 * Fields named `append*` are accumulated (merged with the existing array).
 * All other fields replace the existing value.
 *
 * Null values explicitly clear a field (e.g. `currentFrame: null` removes
 * the frame reference from state at the end of a turn).
 */
export interface OrchestrationStateUpdate {
  // Replace fields
  phase?: WorkflowPhase;
  activeTurn?: ActiveConversationTurn | null;
  currentFrame?: DecisionFrame | null;
  pendingExecutionRequest?: ExecutionRequest | null;
  guardrailResult?: GuardrailResult | null;
  capabilityResult?: CapabilityExecutionResult | null;
  activeApprovalGateId?: string | null;
  error?: OrchestrationError | null;
  traceId?: TraceId;

  // Append fields — the adapter merges these into the existing arrays
  appendMessages?: ConversationMessage[];
  appendCompletedTurns?: CompletedConversationTurn[];
  appendApprovalGates?: ApprovalGateState[];
  appendAuditRecords?: AuditRecord[];

  // Merge fields — shallow merged into the existing object
  mergeMetadata?: Metadata;
}

// ---------------------------------------------------------------------------
// Node and router function types
// ---------------------------------------------------------------------------

/** Stable identifier for an orchestration node. */
export type NodeId = string;

/** The outcome of a routing decision. */
export interface OrchestrationRoutingDecision {
  /** The node to route to next. Use `"__end__"` to terminate the graph. */
  nextNode: NodeId;
  /**
   * Human-readable explanation of this routing choice.
   * Captured in structured logs for workflow diagnostics.
   */
  reason?: string;
}

/**
 * A framework-agnostic orchestration node function.
 *
 * Takes the current OrchestrationState and an execution context, and returns
 * a description of how the state should change. Never mutates the state
 * directly — all changes are expressed through the returned update.
 *
 * The LangGraph adapter wraps this as a LangGraph node function:
 *   async (langGraphState) => {
 *     const state = adapter.fromLangGraphState(langGraphState);
 *     const update = await fn(state, context);
 *     return adapter.updateToLangGraphDelta(update);
 *   }
 *
 * Contract:
 *   1. Must not mutate `state` or `context`.
 *   2. Must not call other node functions directly.
 *   3. Should respect `context.signal` for graceful cancellation.
 *   4. Should emit audit records via `context.services.auditEmitter`.
 *   5. Should run hooks via `context.services.hookExecutor` at relevant stages.
 */
export type OrchestrationNodeFn = (
  state: Readonly<OrchestrationState>,
  context: OrchestrationContext
) => Promise<OrchestrationStateUpdate>;

/**
 * A framework-agnostic routing function (conditional edge).
 *
 * Examines the current state and returns a routing decision determining
 * which node to execute next. Must be deterministic given the same state.
 *
 * The LangGraph adapter wraps this as a conditional edge function:
 *   (langGraphState) => {
 *     const state = adapter.fromLangGraphState(langGraphState);
 *     return router(state).nextNode;
 *   }
 *
 * Contract:
 *   1. Must be synchronous — routing decisions cannot be async.
 *   2. Must not produce side effects.
 *   3. Must not mutate state.
 *   4. All returned `nextNode` values must be valid node IDs or `"__end__"`.
 */
export type OrchestrationRouter = (
  state: Readonly<OrchestrationState>
) => OrchestrationRoutingDecision;

// ---------------------------------------------------------------------------
// OrchestrationContext — injected into every node
// ---------------------------------------------------------------------------

/**
 * Execution context injected into every OrchestrationNodeFn.
 *
 * Provides access to PCP service interfaces (never to LangGraph internals),
 * runtime metadata, and observability handles. Context is constructed at
 * graph compilation time and re-injected on each invocation.
 *
 * All service interfaces in `context.services` are defined in nodes.ts.
 * Concrete implementations are provided by the application bootstrapper.
 */
export interface OrchestrationContext {
  /** All PCP service dependencies available to nodes. */
  services: OrchestrationServices;
  /** Unique identifier for this specific graph invocation (LangGraph run ID). */
  runId: string;
  /** AbortSignal for cooperative cancellation of long-running operations. */
  signal?: AbortSignal;
  /** Structured logger for orchestration-layer diagnostics. */
  logger?: OrchestrationLogger;
}

/**
 * The PCP service interfaces available to node functions.
 *
 * Defined here as a named bundle so nodes can declare the specific services
 * they need via intersection types (e.g. `Pick<OrchestrationServices, "projector" | "guardrail">`).
 * Service interfaces are defined in nodes.ts.
 */
export interface OrchestrationServices {
  /** Builds Decision Frames from user intent. */
  projector: import("./nodes.js").FrameProjector;
  /** Evaluates ExecutionRequests through the Guardrail pipeline. */
  guardrail: import("./nodes.js").GuardrailEvaluator;
  /** Dispatches capability invocations to registered handlers. */
  dispatcher: import("./nodes.js").CapabilityDispatcher;
  /** Manages approval gate lifecycle. */
  approval: import("./nodes.js").ApprovalGateway;
  /** Generates natural language responses from turn context. */
  synthesizer: import("./nodes.js").ResponseSynthesizer;
  /** Emits audit records to the audit store. */
  auditEmitter: import("./nodes.js").OrchestrationAuditEmitter;
  /** Runs hooks at lifecycle stages. */
  hookExecutor: import("./nodes.js").OrchestrationHookExecutor;
}

/**
 * Structured logger interface for orchestration diagnostics.
 * Implementations may route to any logging backend.
 */
export interface OrchestrationLogger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

// ---------------------------------------------------------------------------
// Graph definition types
// ---------------------------------------------------------------------------

/**
 * A named, typed node in an orchestration graph.
 */
export interface OrchestrationNodeDefinition {
  /** Unique node identifier within this graph. */
  nodeId: NodeId;
  /** Human-readable name for logging and visualization. */
  name: string;
  /** Optional description for documentation and graph rendering. */
  description?: string;
  /** The node function implementation. */
  fn: OrchestrationNodeFn;
}

/**
 * An unconditional directed edge between two nodes.
 */
export interface OrchestrationUnconditionalEdge {
  kind: "unconditional";
  from: NodeId;
  to: NodeId;
}

/**
 * A conditional edge driven by a routing function.
 *
 * The router examines state and returns one of the `routes` node IDs.
 * The `routes` map names each possible destination with its condition label —
 * used by graph visualization tools.
 */
export interface OrchestrationConditionalEdge {
  kind: "conditional";
  from: NodeId;
  router: OrchestrationRouter;
  /**
   * All possible next nodes this edge can route to.
   * Keys are human-readable condition labels (e.g. "allowed", "denied").
   * Values are the target node IDs.
   */
  routes: Record<string, NodeId>;
}

/** Union of edge types. */
export type OrchestrationEdgeDefinition =
  | OrchestrationUnconditionalEdge
  | OrchestrationConditionalEdge;

/**
 * A complete orchestration graph definition — nodes, edges, and entry point.
 *
 * This is the framework-agnostic graph specification. The LangGraph adapter
 * (adapter.ts) compiles this definition into a LangGraph `StateGraph`.
 */
export interface OrchestrationGraphDefinition {
  /** Human-readable graph name. */
  name: string;
  /** All nodes in the graph. */
  nodes: OrchestrationNodeDefinition[];
  /** All edges (unconditional and conditional). */
  edges: OrchestrationEdgeDefinition[];
  /** The node that receives the initial input. */
  entryPoint: NodeId;
  /**
   * Nodes that may produce an interrupt for approval gating.
   * The adapter uses this list to configure LangGraph's `interruptBefore`
   * or `interruptAfter` settings.
   */
  interruptibleNodes?: NodeId[];
}

// ---------------------------------------------------------------------------
// Invocation and streaming types
// ---------------------------------------------------------------------------

/**
 * Input required to start a new orchestration run (first turn).
 */
export interface OrchestrationStartInput {
  /** Stable conversation identifier (LangGraph thread_id). */
  conversationId: string;
  sessionId: string;
  principalId: PrincipalId;
  workflowId?: string;
  correlationId?: string;
  /** The user's opening message. */
  userMessage: string;
  metadata?: Metadata;
}

/**
 * Input required to continue an existing orchestration run (subsequent turns).
 */
export interface OrchestrationContinueInput {
  /** Must match the conversationId of the existing thread. */
  conversationId: string;
  /** The user's follow-up message. */
  userMessage: string;
  metadata?: Metadata;
}

/**
 * Configuration for a single graph invocation.
 */
export interface OrchestrationRunConfig {
  /** LangGraph thread configuration. At minimum includes `thread_id`. */
  threadId: string;
  /** Maximum number of steps before the run is interrupted. */
  recursionLimit?: number;
  /**
   * Checkpoint namespace for multi-tenant deployments.
   * Maps to LangGraph's `configurable.checkpoint_ns`.
   */
  checkpointNamespace?: string;
  /** Run-specific extension configuration. */
  configurable?: Record<string, unknown>;
}

/**
 * A single event in an orchestrated streaming run.
 *
 * The LangGraph adapter translates LangGraph's stream events into this
 * framework-agnostic type. Consumers subscribe to these events to drive
 * real-time UI updates (typing indicators, phase changes, partial responses).
 */
export interface OrchestrationStreamEvent {
  /** The event type. */
  eventType:
    | "phase-changed"       // workflow phase transitioned
    | "message-delta"       // partial assistant response token
    | "message-complete"    // full assistant message finalized
    | "node-started"        // a graph node began executing
    | "node-completed"      // a graph node finished executing
    | "approval-required"   // graph suspended; approval gate opened
    | "approval-resolved"   // approval gate was resolved; graph resuming
    | "turn-complete"       // full turn completed; final state available
    | "error";              // error event

  /** The node that produced this event, if applicable. */
  nodeId?: NodeId;
  /** Current phase at the time of this event. */
  phase?: WorkflowPhase;
  /** Partial text content for message-delta events. */
  delta?: string;
  /** Complete message for message-complete events. */
  message?: ConversationMessage;
  /** Approval gate state for approval-related events. */
  approvalGate?: ApprovalGateState;
  /** The complete state after turn-complete events. */
  finalState?: OrchestrationState;
  /** Error detail for error events. */
  error?: OrchestrationError;
  /** Event timestamp. */
  emittedAt: ISOTimestamp;
}
