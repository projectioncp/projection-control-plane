/**
 * LangGraph Integration — Service Interfaces and Node Contracts
 *
 * This module defines two things:
 *
 *   1. SERVICE INTERFACES — the boundary between orchestration nodes and the
 *      PCP business layers (Projection, Guardrail, Capabilities, Approval,
 *      Response synthesis). Nodes depend on these interfaces, never on
 *      concrete implementations.
 *
 *   2. STANDARD NODE CONTRACTS — the built-in nodes of the standard PCP
 *      workflow graph. Each node is described by its role, what state it
 *      reads, what state it writes, what service it calls, and what phase
 *      transitions it may produce.
 *
 * Why separate service interfaces from the business layers:
 *   The Projection layer, Guardrail pipeline, and Capability registry do not
 *   know about orchestration. They expose their own interfaces. The service
 *   interfaces here are adapter contracts: thin wrappers that give nodes a
 *   stable, orchestration-oriented API regardless of how the underlying
 *   business layer evolves.
 *
 *   Example: GuardrailEvaluator.evaluate() accepts the full current state
 *   (DecisionFrame + ExecutionRequest) and returns a GuardrailResult. The
 *   underlying GuardrailPipeline.evaluate() may have a different signature —
 *   the GuardrailEvaluator implementation adapts the two.
 *
 * Coupling invariants:
 *   - Service interfaces in this file: zero LangGraph imports.
 *   - Concrete implementations live OUTSIDE this module (in application code).
 *   - Node functions accept OrchestrationContext (types.ts) which carries
 *     these service interfaces; they never import implementations directly.
 */

import type {
  CapabilityId,
  DecisionFrame,
  ISOTimestamp,
  Metadata,
  PrincipalId,
} from "../projection/frame.js";
import type { ExecutionRequest } from "../types.js";
import type { GuardrailResult } from "../guardrail/types.js";
import type {
  CapabilityExecutionRequest,
  CapabilityExecutionResult,
} from "../capabilities/execution.js";
import type { AuditRecord } from "../audit/types.js";
import type {
  AfterCapabilityContext,
  AfterGuardrailContext,
  AfterProjectionContext,
  BeforeCapabilityContext,
  BeforeGuardrailContext,
  BeforeProjectionContext,
  HookExecutionResult,
  HookStage,
  OnErrorContext,
} from "../hooks/types.js";
import type {
  ActiveConversationTurn,
  ApprovalGateState,
  CompletedConversationTurn,
  ConversationMessage,
  NodeId,
  OrchestrationError,
  OrchestrationNodeFn,
  OrchestrationState,
  OrchestrationStateUpdate,
  WorkflowPhase,
} from "./types.js";

// ---------------------------------------------------------------------------
// FrameProjector — Projection layer service interface
// ---------------------------------------------------------------------------

/**
 * Input to the frame projector: everything needed to build a Decision Frame.
 */
export interface ProjectionInput {
  /** The raw user message that triggered this turn. */
  rawIntent: string;
  /** The principal on whose behalf projection is running. */
  principalId: PrincipalId;
  sessionId: string;
  workflowId?: string;
  correlationId?: string;
  /**
   * The full conversation history up to (not including) this turn.
   * Used by the Projection layer for multi-turn context and intent disambiguation.
   */
  conversationHistory: ConversationMessage[];
  /**
   * Completed turn summaries for high-level workflow continuity.
   * The Projection layer may use these to detect repeated intents,
   * escalating risk, or workflow completion conditions.
   */
  priorTurns: CompletedConversationTurn[];
  /** Extension context for domain-specific projection logic. */
  metadata?: Metadata;
}

/**
 * Result of a frame projection attempt.
 *
 * On success: a fully constructed DecisionFrame is returned.
 * On clarification needed: no frame is returned; a clarifying message is
 * provided for the response synthesizer.
 * On failure: an error is returned for the fault handler.
 */
export type ProjectionResult =
  | {
      outcome: "frame-built";
      frame: DecisionFrame;
      /**
       * The single ExecutionRequest the AI produced from its reasoning.
       *
       * Invariant: exactly one ExecutionRequest per projection turn.
       * The Projection layer must not return multiple requests. Each request
       * must independently traverse Guardrail before any capability handler
       * is invoked. Batching or chaining execution requests within a single
       * turn is an autonomy boundary violation — it would allow capabilities
       * to execute without independent per-request governance passes.
       *
       * If the user's intent requires multiple capability invocations,
       * the system must surface a clarification-needed result and resolve
       * them across separate, sequentially governed turns.
       */
      executionRequest: ExecutionRequest;
    }
  | {
      outcome: "clarification-needed";
      /** Message the AI should relay to the user. */
      clarificationMessage: string;
      /**
       * Partial interpretation detail for the response synthesizer.
       * Shape is domain-specific.
       */
      partialInterpretation?: Record<string, unknown>;
    }
  | {
      outcome: "failed";
      error: OrchestrationError;
    };

/**
 * Service interface: Projection layer adapter.
 *
 * The orchestration layer calls this to build a Decision Frame for each
 * conversation turn. Implementations wrap the actual Projection service
 * (LLM call, frame construction, context retrieval) and translate results
 * into the orchestration-oriented `ProjectionResult` type.
 *
 * Implementations must:
 *   - Run the beforeProjection hook sequence before projection begins.
 *   - Run the afterProjection hook sequence after the frame is built.
 *   - Emit a `frame-created` audit record on success.
 *   - Be async-safe and respect cancellation via AbortSignal.
 */
export interface FrameProjector {
  project(input: ProjectionInput): Promise<ProjectionResult>;
}

// ---------------------------------------------------------------------------
// GuardrailEvaluator — Guardrail pipeline service interface
// ---------------------------------------------------------------------------

/**
 * Input to the guardrail evaluator.
 */
export interface GuardrailEvaluationInput {
  /** The ExecutionRequest produced by the AI. */
  request: ExecutionRequest;
  /** The Decision Frame that authorized this request. */
  frame: DecisionFrame;
}

/**
 * Service interface: Guardrail pipeline adapter.
 *
 * The orchestration layer calls this to evaluate each ExecutionRequest
 * before dispatching to a capability handler. Implementations wrap the
 * actual GuardrailPipeline and translate results.
 *
 * Implementations must:
 *   - Run the beforeGuardrail hook sequence before evaluation.
 *   - Run the afterGuardrail hook sequence after evaluation.
 *   - Emit a `guardrail-evaluated` audit record.
 *   - Emit `policy-violation` audit records for each violation.
 *   - Return a GuardrailResult regardless of the decision outcome —
 *     the decision field carries allow / deny / require-approval / flag.
 */
export interface GuardrailEvaluator {
  evaluate(input: GuardrailEvaluationInput): Promise<GuardrailResult>;
}

// ---------------------------------------------------------------------------
// CapabilityDispatcher — Capability layer service interface
// ---------------------------------------------------------------------------

/**
 * Input to the capability dispatcher.
 */
export interface DispatchInput {
  /** The validated ExecutionRequest to dispatch. */
  request: ExecutionRequest;
  /** The frame that authorized this request (for entitlement snapshotting). */
  frame: DecisionFrame;
  /** The approval gate that was cleared, if this request required approval. */
  clearedApprovalGateId?: string;
}

/**
 * Service interface: Capability invocation adapter.
 *
 * The orchestration layer calls this to invoke a capability after the
 * Guardrail pipeline has allowed the request. Implementations:
 *   - Translate ExecutionRequest → CapabilityExecutionRequest.
 *   - Resolve the capability handler from the registry.
 *   - Run the beforeCapability hook sequence.
 *   - Invoke the handler.
 *   - Run the afterCapability hook sequence.
 *   - Handle retry scheduling per the capability's retryPolicy.
 *   - Emit `capability-executed`, `execution-failed`, or `execution-timed-out`
 *     audit records as appropriate.
 *   - Store rollback tokens for rollback-supported capabilities.
 */
export interface CapabilityDispatcher {
  dispatch(input: DispatchInput): Promise<CapabilityExecutionResult>;
}

// ---------------------------------------------------------------------------
// ApprovalGateway — Approval workflow service interface
// ---------------------------------------------------------------------------

/**
 * Input to open a new approval gate.
 */
export interface ApprovalGateRequest {
  /** The execution request awaiting approval. */
  executionRequest: ExecutionRequest;
  /** Capability being gated. */
  capabilityId: CapabilityId;
  /** Approval requirement IDs from the Decision Frame. */
  requirementIds: string[];
  /** The role qualified to grant approval. */
  approverRole: string;
  /** The policy that triggered this gate, if applicable. */
  policyId?: string;
  /** Maximum wait time in milliseconds. */
  timeoutMs: number;
  /** Whether to deny automatically on timeout. */
  denyOnTimeout: boolean;
  /** The LangGraph thread ID for the conversation to resume. */
  resumeThreadId: string;
}

/**
 * The external approval decision submitted by an approver.
 */
export interface ApprovalDecision {
  gateId: string;
  outcome: "granted" | "denied";
  /** The identity of the approver. Required for explicit decisions. */
  approverId?: string;
  approverRole?: string;
  notes?: string;
  decidedAt: ISOTimestamp;
}

/**
 * Service interface: Approval gate lifecycle manager.
 *
 * Implements the approval workflow between the orchestration layer
 * (which suspends the graph) and the external approval service (which
 * resolves the gate and triggers graph resumption).
 *
 * The approval flow:
 *   1. Guardrail returns "require-approval".
 *   2. Orchestration node calls `openGate()`.
 *   3. LangGraph interrupt suspends the graph; the thread_id is stored.
 *   4. Approval service sends the gate to the approver.
 *   5. Approver calls `resolveGate()` with their decision.
 *   6. The approval service calls `CompiledOrchestrationGraph.resumeApproval()`.
 *   7. The graph resumes from the approval node.
 */
export interface ApprovalGateway {
  /**
   * Open a new approval gate and notify the approval service.
   * Returns the fully populated ApprovalGateState to store in OrchestrationState.
   */
  openGate(request: ApprovalGateRequest): Promise<ApprovalGateState>;

  /**
   * Retrieve the current status of an existing gate.
   * Used by the resume path to verify the gate before continuing execution.
   */
  getGate(gateId: string): Promise<ApprovalGateState>;

  /**
   * Record the approver's decision for a gate.
   *
   * This is called by the approval service when an approver responds.
   * After this, the approval service is responsible for triggering
   * `CompiledOrchestrationGraph.resumeApproval()` with the decision.
   */
  resolveGate(decision: ApprovalDecision): Promise<ApprovalGateState>;
}

// ---------------------------------------------------------------------------
// ResponseSynthesizer — AI response generation service interface
// ---------------------------------------------------------------------------

/**
 * A sanitized governance outcome for the response synthesizer.
 *
 * This is the only guardrail information the response synthesizer receives.
 * Raw `GuardrailResult` objects must never be passed to the synthesizer —
 * they contain policy IDs, stage-level violation details, and internal
 * deny codes that, if injected into the LLM context, could:
 *   - Help adversarial users craft requests that circumvent specific policies.
 *   - Leak internal architecture and policy topology to external actors.
 *   - Create a feedback loop where the AI learns to avoid governance triggers.
 *
 * The orchestration layer is responsible for constructing this summary from
 * the `GuardrailResult` before handing off to the synthesizer.
 */
export interface GovernanceOutcomeSummary {
  /**
   * The guardrail decision.
   * "allow" → execution proceeded normally.
   * "deny" → request was blocked; synthesizer should compose a user-safe
   *          explanation without revealing which policy denied it.
   * "require-approval" → gate was opened; synthesizer should describe
   *                      the pending approval to the user.
   * "flag" → execution may have proceeded but was flagged for review.
   */
  decision: "allow" | "deny" | "require-approval" | "flag";
  /**
   * A pre-sanitized, user-safe explanation of the governance outcome.
   * This is composed by the orchestration layer, not the guardrail pipeline.
   * It must not contain policy names, IDs, or technical internal details.
   * Example: "This action requires additional authorization."
   */
  userSafeReason: string;
  /**
   * Whether the request was flagged for compliance or security review.
   * The synthesizer may use this to soften or caveat the response.
   */
  flagged: boolean;
  /**
   * Whether an approval gate was opened for this request.
   * The synthesizer uses this to inform the user that approval is pending.
   */
  approvalRequired: boolean;
}

/**
 * Context provided to the response synthesizer for a single turn.
 */
export interface ResponseSynthesisInput {
  /** The full conversation history (including the current user message). */
  messages: ConversationMessage[];
  /** The completed turn context — what happened during this turn. */
  completedTurn: Omit<CompletedConversationTurn, "assistantMessageId">;
  /**
   * The capability execution result, if execution ran this turn.
   * The synthesizer uses this to compose a result-aware response.
   */
  capabilityResult?: CapabilityExecutionResult;
  /**
   * A sanitized governance outcome summary, if guardrail evaluation ran
   * this turn and the decision was not a simple "allow".
   *
   * The orchestration layer constructs this from the raw `GuardrailResult`
   * before calling the synthesizer. Raw `GuardrailResult` objects must never
   * be passed here — see `GovernanceOutcomeSummary` for the rationale.
   */
  governanceOutcome?: GovernanceOutcomeSummary;
  /**
   * The orchestration error, if the turn faulted.
   * The synthesizer produces a user-safe error message.
   */
  error?: OrchestrationError;
  /** Extension context for domain-specific response guidance. */
  metadata?: Metadata;
}

/**
 * A streaming token chunk from the response synthesizer.
 */
export interface ResponseTokenChunk {
  /** Partial text content of the response. */
  delta: string;
  /** Running token count (input + output so far). */
  tokenUsage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
}

/**
 * Service interface: Natural language response generator.
 *
 * Generates the AI's conversational response for each turn. Implementations
 * typically wrap an LLM call with the conversation history and turn context.
 *
 * The `stream()` method is preferred for real-time UI updates. The
 * `generate()` method is available for batch or non-streaming contexts.
 *
 * Implementations must NOT leak:
 *   - Policy details that would help users circumvent guardrails.
 *   - Internal capability names or system architecture.
 *   - Error stack traces or raw exception messages.
 */
export interface ResponseSynthesizer {
  /**
   * Generate the full response in one call.
   * Returns the complete ConversationMessage for storage in state.
   */
  generate(input: ResponseSynthesisInput): Promise<ConversationMessage>;

  /**
   * Stream the response token by token.
   * Yields ResponseTokenChunk for each token and resolves with the
   * complete ConversationMessage when generation is done.
   */
  stream(
    input: ResponseSynthesisInput
  ): AsyncIterable<ResponseTokenChunk> & { message: Promise<ConversationMessage> };
}

// ---------------------------------------------------------------------------
// OrchestrationAuditEmitter — audit layer adapter
// ---------------------------------------------------------------------------

/**
 * Service interface: Audit record emitter for the orchestration layer.
 *
 * Provides a simple emit-and-forget interface that nodes use to write
 * audit records without being coupled to the audit store's implementation.
 *
 * Records are also accumulated in OrchestrationState.auditRecords so that
 * the caller can inspect or flush them after graph invocation.
 *
 * Implementations may:
 *   - Write directly to a database.
 *   - Buffer in memory and flush on turn completion.
 *   - Forward to an event bus (Kafka, SQS, etc.).
 *   - Do all of the above (fan-out).
 */
export interface OrchestrationAuditEmitter {
  emit(record: AuditRecord): Promise<void>;
  emitBatch(records: AuditRecord[]): Promise<void>;
}

// ---------------------------------------------------------------------------
// OrchestrationHookExecutor — hook framework adapter
// ---------------------------------------------------------------------------

/**
 * Hook context union for the contexts that the orchestration layer fires.
 * The onError context is excluded here — it is handled by the fault node.
 */
export type OrchestrationHookContext =
  | BeforeProjectionContext
  | AfterProjectionContext
  | BeforeGuardrailContext
  | AfterGuardrailContext
  | BeforeCapabilityContext
  | AfterCapabilityContext
  | OnErrorContext;

/**
 * Service interface: Hook executor for the orchestration layer.
 *
 * Resolves and runs all registered hooks for a given lifecycle stage.
 * The node function calls this at the appropriate seams; the executor
 * handles priority ordering, timeout enforcement, and error policy.
 *
 * The orchestration layer fires hooks at seven stages:
 *   beforeProjection  — before FrameProjector.project()
 *   afterProjection   — after FrameProjector.project()
 *   beforeGuardrail   — before GuardrailEvaluator.evaluate()
 *   afterGuardrail    — after GuardrailEvaluator.evaluate()
 *   beforeCapability  — before CapabilityDispatcher.dispatch()
 *   afterCapability   — after CapabilityDispatcher.dispatch()
 *   onError           — when a node faults
 */
export interface OrchestrationHookExecutor {
  run(
    stage: HookStage,
    context: OrchestrationHookContext
  ): Promise<HookExecutionResult>;
}

// ---------------------------------------------------------------------------
// Standard node IDs
// ---------------------------------------------------------------------------

/**
 * The built-in node identifiers in the standard PCP workflow graph.
 *
 * These are the node IDs used in `StandardWorkflowGraphDefinition` (graph.ts).
 * Custom graphs may use any NodeId values; these constants are provided for
 * reference and to avoid magic strings in router implementations.
 */
export const StandardNodeId = {
  /** Ingests the user message and initializes the active turn. */
  RECEIVE_INPUT: "receive-input",

  /** Calls FrameProjector to build a DecisionFrame from the user's intent. */
  PROJECT_FRAME: "project-frame",

  /**
   * Routes after projection:
   *   → EVALUATE_GUARDRAIL  when the AI produced an ExecutionRequest
   *   → GENERATE_RESPONSE   when the AI needs to ask a clarifying question
   *   → HANDLE_ERROR        when projection failed
   */
  ROUTE_FROM_PROJECTION: "route-from-projection",

  /** Calls GuardrailEvaluator to validate the pending ExecutionRequest. */
  EVALUATE_GUARDRAIL: "evaluate-guardrail",

  /**
   * Routes after guardrail evaluation:
   *   → EXECUTE_CAPABILITY  when decision is "allow" or "flag"
   *   → REQUEST_APPROVAL    when decision is "require-approval"
   *   → GENERATE_RESPONSE   when decision is "deny"
   *   → HANDLE_ERROR        when guardrail pipeline errored
   */
  ROUTE_FROM_GUARDRAIL: "route-from-guardrail",

  /**
   * Opens an approval gate via ApprovalGateway.
   * After opening the gate, this node signals LangGraph to interrupt,
   * suspending execution until the graph is resumed with an ApprovalDecision.
   */
  REQUEST_APPROVAL: "request-approval",

  /**
   * Routes after approval resolution (graph resume path):
   *   → EXECUTE_CAPABILITY  when approval was granted
   *   → GENERATE_RESPONSE   when approval was denied or timed out
   *   → HANDLE_ERROR        when approval system errored
   */
  ROUTE_FROM_APPROVAL: "route-from-approval",

  /** Calls CapabilityDispatcher to invoke the approved capability. */
  EXECUTE_CAPABILITY: "execute-capability",

  /**
   * Routes after capability execution:
   *   → GENERATE_RESPONSE  when execution completed (any status)
   *   → HANDLE_ERROR       when execution faulted unexpectedly
   */
  ROUTE_FROM_EXECUTION: "route-from-execution",

  /** Calls ResponseSynthesizer to generate the AI's conversational reply. */
  GENERATE_RESPONSE: "generate-response",

  /**
   * Examines OrchestrationState.error and decides:
   *   → GENERATE_RESPONSE  if the error is recoverable (tell the user)
   *   → TERMINATE          if the error is fatal (end the session)
   */
  HANDLE_ERROR: "handle-error",

  /** Terminal node — cleans up session state and closes the conversation. */
  TERMINATE: "terminate",
} as const;

export type StandardNodeId = (typeof StandardNodeId)[keyof typeof StandardNodeId];

// ---------------------------------------------------------------------------
// Node implementation contracts
// ---------------------------------------------------------------------------

/**
 * Contract for the RECEIVE_INPUT node.
 *
 * Reads:  phase (must be "idle"), conversationId, sessionId, principalId
 * Writes: phase → "intent-received"
 *         activeTurn (new ActiveConversationTurn)
 *         appendMessages (the user message)
 *         traceId (new trace for this turn)
 * Calls:  auditEmitter.emit("execution-requested" record)
 * Hooks:  none (pre-projection)
 */
export interface ReceiveInputNodeContract {
  readonly nodeId: typeof StandardNodeId.RECEIVE_INPUT;
  /** The raw user message text received from the conversation interface. */
  readonly userMessage: string;
}

/**
 * Contract for the PROJECT_FRAME node.
 *
 * Reads:  phase ("intent-received"), activeTurn, messages, completedTurns,
 *         principalId, sessionId, workflowId, correlationId
 * Writes: phase → "projecting" then → "awaiting-guardrail" | "generating-response" | "faulted"
 *         currentFrame (when outcome is "frame-built")
 *         pendingExecutionRequest (first ExecutionRequest from projection)
 *         error (when outcome is "failed")
 * Calls:  services.projector.project()
 * Hooks:  beforeProjection (pre-call), afterProjection (post-call)
 * Audit:  "frame-created" on success; "execution-requested" for each request
 */
export interface ProjectFrameNodeContract {
  readonly nodeId: typeof StandardNodeId.PROJECT_FRAME;
}

/**
 * Contract for the EVALUATE_GUARDRAIL node.
 *
 * Reads:  phase ("awaiting-guardrail"), pendingExecutionRequest, currentFrame
 * Writes: phase → "awaiting-approval" | "executing" | "generating-response" | "faulted"
 *         guardrailResult
 *         error (on unexpected pipeline error)
 * Calls:  services.guardrail.evaluate()
 * Hooks:  beforeGuardrail (pre-call), afterGuardrail (post-call)
 * Audit:  "guardrail-evaluated", "policy-violation" (for each violation),
 *         "entitlement-denied" (for authorization denials)
 */
export interface EvaluateGuardrailNodeContract {
  readonly nodeId: typeof StandardNodeId.EVALUATE_GUARDRAIL;
}

/**
 * Contract for the REQUEST_APPROVAL node.
 *
 * Reads:  phase ("awaiting-guardrail"), pendingExecutionRequest, currentFrame,
 *         guardrailResult (decision must be "require-approval")
 * Writes: phase → "awaiting-approval"
 *         activeApprovalGateId
 *         appendApprovalGates (the newly opened gate)
 * Calls:  services.approval.openGate()
 * Side:   Signals LangGraph interrupt — the graph suspends after this node.
 * Audit:  "approval-requested"
 */
export interface RequestApprovalNodeContract {
  readonly nodeId: typeof StandardNodeId.REQUEST_APPROVAL;
}

/**
 * Contract for the EXECUTE_CAPABILITY node.
 *
 * Reads:  phase ("executing"), pendingExecutionRequest, currentFrame,
 *         activeApprovalGateId (if execution follows approval)
 * Writes: phase → "generating-response" | "faulted"
 *         capabilityResult
 *         pendingExecutionRequest → null (cleared after execution)
 *         error (on unexpected dispatcher error)
 * Calls:  services.dispatcher.dispatch()
 * Hooks:  beforeCapability (pre-call), afterCapability (post-call)
 * Audit:  "capability-executed" | "execution-failed" | "execution-timed-out"
 */
export interface ExecuteCapabilityNodeContract {
  readonly nodeId: typeof StandardNodeId.EXECUTE_CAPABILITY;
}

/**
 * Contract for the GENERATE_RESPONSE node.
 *
 * Reads:  phase ("generating-response"), messages, activeTurn,
 *         guardrailResult, capabilityResult, error
 * Writes: phase → "completed"
 *         activeTurn → null (cleared; turn is complete)
 *         appendCompletedTurns (the finalized CompletedConversationTurn)
 *         appendMessages (the assistant response)
 *         currentFrame → null, guardrailResult → null, capabilityResult → null
 * Calls:  services.synthesizer.generate() or synthesizer.stream()
 * Audit:  none (response generation is not a governance event)
 */
export interface GenerateResponseNodeContract {
  readonly nodeId: typeof StandardNodeId.GENERATE_RESPONSE;
}

/**
 * Contract for the HANDLE_ERROR node.
 *
 * Reads:  phase ("faulted"), error
 * Writes: phase → "generating-response" (recoverable) | "terminated" (fatal)
 * Calls:  services.hookExecutor.run("onError", ...)
 * Audit:  delegates to the onError hook's HookExecutionResult audit records
 */
export interface HandleErrorNodeContract {
  readonly nodeId: typeof StandardNodeId.HANDLE_ERROR;
}

/**
 * Contract for the TERMINATE node.
 *
 * Reads:  conversationId, completedTurns, auditRecords
 * Writes: phase → "terminated"
 *         Flushes remaining auditRecords via auditEmitter.emitBatch()
 * Calls:  services.auditEmitter.emitBatch()
 * Audit:  "frame-expired" for any open frames
 */
export interface TerminateNodeContract {
  readonly nodeId: typeof StandardNodeId.TERMINATE;
}

// ---------------------------------------------------------------------------
// Node factory type
// ---------------------------------------------------------------------------

/**
 * A factory function that produces a node's OrchestrationNodeFn.
 *
 * Used in graph.ts to construct the standard node set. The factory
 * receives any node-specific static configuration and returns the
 * function that will be called by the graph runtime.
 *
 * @example
 *   const buildProjectFrameNode: NodeFactory = (config) => {
 *     return async (state, context) => {
 *       const result = await context.services.projector.project({ ... });
 *       return { phase: "awaiting-guardrail", currentFrame: result.frame };
 *     };
 *   };
 */
export type NodeFactory<TConfig = void> = TConfig extends void
  ? () => OrchestrationNodeFn
  : (config: TConfig) => OrchestrationNodeFn;
