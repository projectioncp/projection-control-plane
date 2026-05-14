/**
 * LangGraph Integration — Adapter Layer
 *
 * This module defines the bridging contracts between the framework-agnostic
 * orchestration model (types.ts) and LangGraph's concrete runtime.
 *
 * CRITICAL: This file NEVER imports from `@langchain/langgraph`.
 *
 * LangGraph-specific types appear only as generic type parameters:
 *   TLangGraphState   — LangGraph's generated state type (from Annotation.Root())
 *   TCompiledGraph    — LangGraph's CompiledStateGraph
 *   TCheckpointer     — LangGraph's BaseCheckpointSaver
 *   TConfig           — LangGraph's RunnableConfig
 *
 * A concrete LangGraphAdapter implementation will:
 *   1. Import from `@langchain/langgraph` and `@langchain/core/runnables`.
 *   2. Implement the LangGraphOrchestrationAdapter<...> interface with real types.
 *   3. Translate OrchestrationState ↔ LangGraph state via the channel mappings.
 *   4. Wrap OrchestrationNodeFn as LangGraph node functions.
 *   5. Compile OrchestrationGraphDefinition into a StateGraph.
 *
 * This file provides the interface specification, channel semantic declarations,
 * and the compiled graph interface — everything a concrete adapter needs to
 * implement correctly without the type system depending on LangGraph.
 *
 * Anti-corruption layer pattern:
 *
 *   OrchestrationState (PCP domain model)
 *       ↕  LangGraphOrchestrationAdapter.toLangGraphState()
 *       ↕  LangGraphOrchestrationAdapter.fromLangGraphState()
 *   TLangGraphState  (LangGraph runtime model — opaque here)
 *       ↕  LangGraph's StateGraph runtime
 *   Persisted checkpoint (opaque to this module)
 */

import type {
  ISOTimestamp,
  Metadata,
  OrchestrationContext,
  OrchestrationEdgeDefinition,
  OrchestrationGraphDefinition,
  OrchestrationNodeDefinition,
  OrchestrationNodeFn,
  OrchestrationRouter,
  OrchestrationRoutingDecision,
  OrchestrationRunConfig,
  OrchestrationStartInput,
  OrchestrationState,
  OrchestrationStateUpdate,
  OrchestrationStreamEvent,
} from "./types.js";
import type { ApprovalDecision } from "./nodes.js";

// ---------------------------------------------------------------------------
// State channel semantics
// ---------------------------------------------------------------------------

/**
 * The update semantics for a single field in OrchestrationState.
 *
 * These semantics determine how LangGraph merges a node's partial state
 * update into the persistent graph state. The concrete adapter translates
 * each semantic into a LangGraph `Annotation` reducer.
 *
 *   replace   → default LangGraph reducer: new value overwrites old value
 *   append    → custom reducer: new array is concatenated to existing array
 *   merge     → custom reducer: new object is shallow-merged into existing object
 *   clear-set → set to new value, or clear to undefined/null when explicitly nulled
 */
export type StateUpdateSemantic = "replace" | "append" | "merge" | "clear-set";

/**
 * Channel configuration for a single field in OrchestrationState.
 *
 * The adapter uses this to generate the LangGraph `Annotation.Root()` call:
 *
 *   Annotation.Root({
 *     messages: Annotation<ConversationMessage[]>({
 *       reducer: (prev, next) => [...prev, ...next],   // "append" semantic
 *       default: () => [],
 *     }),
 *     currentFrame: Annotation<DecisionFrame | undefined>({
 *       reducer: (_, next) => next,                     // "replace" semantic
 *       default: () => undefined,
 *     }),
 *   })
 *
 * @typeParam T  The type of the OrchestrationState field this channel covers.
 */
export interface StateChannelConfig<T> {
  /** How updates to this field are merged with the existing value. */
  semantic: StateUpdateSemantic;
  /** Factory for the field's initial value when a new conversation starts. */
  defaultValue: () => T;
  /**
   * Optional serializer for values that need transformation before
   * LangGraph's checkpointer persists them (e.g. converting Map to plain object).
   * Identity if absent.
   */
  serialize?: (value: T) => unknown;
  /**
   * Optional deserializer for values that need transformation after
   * LangGraph's checkpointer restores them.
   * Identity if absent.
   */
  deserialize?: (raw: unknown) => T;
}

/**
 * The complete channel configuration map for OrchestrationState.
 *
 * Each key corresponds to a field in OrchestrationState. The concrete adapter
 * uses this map to build the LangGraph `Annotation.Root()` definition.
 *
 * OrchestrationStateUpdate field mapping:
 *   appendMessages         → messages         (append)
 *   appendCompletedTurns   → completedTurns   (append)
 *   appendApprovalGates    → approvalGates    (append)
 *   appendAuditRecords     → auditRecords     (append)
 *   mergeMetadata          → metadata         (merge)
 *   all other fields       → (replace / clear-set)
 */
export type OrchestrationStateChannelMap = {
  [K in keyof OrchestrationState]-?: StateChannelConfig<OrchestrationState[K]>;
};

/**
 * The canonical channel map for the standard PCP OrchestrationState.
 *
 * Concrete adapters should use this as the source of truth when building
 * the LangGraph Annotation definition. Custom graph implementations may
 * extend this map for additional fields.
 */
export const ORCHESTRATION_STATE_CHANNELS: OrchestrationStateChannelMap = {
  conversationId:          { semantic: "replace",   defaultValue: () => "" },
  sessionId:               { semantic: "replace",   defaultValue: () => "" },
  principalId:             { semantic: "replace",   defaultValue: () => "" },
  workflowId:              { semantic: "clear-set", defaultValue: () => undefined },
  correlationId:           { semantic: "clear-set", defaultValue: () => undefined },
  phase:                   { semantic: "replace",   defaultValue: () => "idle" as const },
  messages:                { semantic: "append",    defaultValue: () => [] },
  activeTurn:              { semantic: "clear-set", defaultValue: () => undefined },
  completedTurns:          { semantic: "append",    defaultValue: () => [] },
  currentFrame:            { semantic: "clear-set", defaultValue: () => undefined },
  pendingExecutionRequest: { semantic: "clear-set", defaultValue: () => undefined },
  guardrailResult:         { semantic: "clear-set", defaultValue: () => undefined },
  capabilityResult:        { semantic: "clear-set", defaultValue: () => undefined },
  activeApprovalGateId:    { semantic: "clear-set", defaultValue: () => undefined },
  approvalGates:           { semantic: "append",    defaultValue: () => [] },
  traceId:                 { semantic: "clear-set", defaultValue: () => undefined },
  auditRecords:            { semantic: "append",    defaultValue: () => [] },
  error:                   { semantic: "clear-set", defaultValue: () => undefined },
  metadata:                { semantic: "merge",     defaultValue: () => ({}) },
};

// ---------------------------------------------------------------------------
// Node and edge wrapper types (opaque LangGraph types as generics)
// ---------------------------------------------------------------------------

/**
 * A LangGraph-wrapped node function.
 *
 * The concrete adapter produces this by wrapping an OrchestrationNodeFn:
 *   async (langGraphState: TLangGraphState, config: TConfig) => {
 *     const state = adapter.fromLangGraphState(langGraphState);
 *     const update = await fn(state, orchContext);
 *     return adapter.updateToLangGraphDelta(update);
 *   }
 *
 * @typeParam TLangGraphState  LangGraph's generated state type.
 * @typeParam TConfig          LangGraph's RunnableConfig.
 * @typeParam TDelta           Partial state delta LangGraph accepts as return value.
 */
export interface LangGraphNodeWrapper<
  TLangGraphState,
  TConfig = unknown,
  TDelta = Partial<TLangGraphState>,
> {
  readonly nodeId: string;
  /**
   * The wrapped function with the LangGraph node signature.
   * Type: `(state: TLangGraphState, config?: TConfig) => Promise<TDelta>`
   */
  readonly fn: (state: TLangGraphState, config?: TConfig) => Promise<TDelta>;
}

/**
 * A LangGraph-wrapped conditional edge (router).
 *
 * The concrete adapter produces this by wrapping an OrchestrationRouter:
 *   (langGraphState: TLangGraphState) => {
 *     const state = adapter.fromLangGraphState(langGraphState);
 *     return router(state).nextNode;
 *   }
 *
 * @typeParam TLangGraphState  LangGraph's generated state type.
 */
export interface LangGraphEdgeWrapper<TLangGraphState> {
  readonly fromNodeId: string;
  /** The wrapped router with the LangGraph conditional edge signature. */
  readonly fn: (state: TLangGraphState) => string;
  /** All possible target node IDs, for LangGraph's static edge declaration. */
  readonly possibleTargets: string[];
}

// ---------------------------------------------------------------------------
// Compiled graph interface (opaque TCompiledGraph)
// ---------------------------------------------------------------------------

/**
 * Metadata about a graph invocation run.
 */
export interface OrchestrationRunMetadata {
  runId: string;
  threadId: string;
  startedAt: ISOTimestamp;
  completedAt: ISOTimestamp;
  stepCount: number;
}

/**
 * The compiled, invocable orchestration graph.
 *
 * This interface wraps the LangGraph `CompiledStateGraph` and exposes
 * a framework-agnostic API. Callers never interact with LangGraph directly —
 * they use this interface for all graph invocation.
 *
 * Generic parameter TCompiledGraph provides escape-hatch access to the raw
 * LangGraph graph for advanced use cases (e.g. direct LangGraph streaming,
 * custom interrupt handling, visualization exports). Normal usage does not
 * need this type parameter.
 *
 * @typeParam TCompiledGraph  LangGraph's CompiledStateGraph — opaque here.
 */
export interface CompiledOrchestrationGraph<TCompiledGraph = unknown> {
  /**
   * Access to the raw LangGraph CompiledStateGraph.
   * Use only when you need capabilities not exposed by this interface.
   * Prefer the typed methods below for all standard use cases.
   */
  readonly compiledGraph: TCompiledGraph;

  /**
   * Start a new conversation or continue an existing one with a user message.
   *
   * For a new conversation, `input` should include the full start payload.
   * For continuation, pass only `conversationId` and `userMessage` — the
   * checkpointer restores the rest of the state from the last checkpoint.
   *
   * Internally calls: `compiledGraph.invoke(input, { configurable: { thread_id } })`
   */
  invoke(
    input: OrchestrationStartInput,
    config: OrchestrationRunConfig
  ): Promise<{ state: OrchestrationState; run: OrchestrationRunMetadata }>;

  /**
   * Start a new conversation or continue one, streaming events in real time.
   *
   * Yields OrchestrationStreamEvent for each observable transition:
   *   phase changes, partial response tokens, node completions, approval gates.
   *
   * Internally uses LangGraph's `streamEvents()` or `stream()` API and
   * translates the framework-specific events to OrchestrationStreamEvent.
   */
  stream(
    input: OrchestrationStartInput,
    config: OrchestrationRunConfig
  ): AsyncIterable<OrchestrationStreamEvent>;

  /**
   * Resume an approval-suspended conversation with the approver's decision.
   *
   * When the REQUEST_APPROVAL node fires, it signals LangGraph to interrupt.
   * The caller stores the `conversationId` and polls or receives the approval
   * decision externally. Once the decision arrives, call this method.
   *
   * Internally uses LangGraph's `Command({ resume: decision })` mechanism:
   *   compiledGraph.invoke(
   *     new Command({ resume: decision }),
   *     { configurable: { thread_id: config.threadId } }
   *   )
   */
  resumeApproval(
    decision: ApprovalDecision,
    config: OrchestrationRunConfig
  ): Promise<{ state: OrchestrationState; run: OrchestrationRunMetadata }>;

  /**
   * Stream events after resuming from an approval interrupt.
   */
  streamResumedApproval(
    decision: ApprovalDecision,
    config: OrchestrationRunConfig
  ): AsyncIterable<OrchestrationStreamEvent>;

  /**
   * Retrieve the current persisted state for a conversation.
   *
   * Returns undefined if no checkpoint exists for the given threadId.
   * Internally calls: `compiledGraph.getState({ configurable: { thread_id } })`
   */
  getState(config: OrchestrationRunConfig): Promise<OrchestrationState | undefined>;
}

// ---------------------------------------------------------------------------
// Checkpointer adapter
// ---------------------------------------------------------------------------

/**
 * A persisted conversation checkpoint.
 *
 * Abstracts LangGraph's checkpoint format into a domain-friendly shape.
 * Used for external checkpoint inspection without a LangGraph dependency.
 */
export interface OrchestrationCheckpoint {
  threadId: string;
  checkpointId: string;
  state: OrchestrationState;
  createdAt: ISOTimestamp;
  parentCheckpointId?: string;
}

/**
 * Adapter interface for LangGraph's checkpoint persistence layer.
 *
 * Implementations wrap LangGraph's `BaseCheckpointSaver` and translate
 * its checkpoint format to OrchestrationCheckpoint. This allows the
 * application to inspect, restore, or export conversation state without
 * importing LangGraph types.
 *
 * @typeParam TCheckpointer  LangGraph's BaseCheckpointSaver — opaque here.
 */
export interface CheckpointerAdapter<TCheckpointer = unknown> {
  /** Access to the raw LangGraph checkpointer. */
  readonly checkpointer: TCheckpointer;

  /** Retrieve the most recent checkpoint for a conversation. */
  getLatest(threadId: string): Promise<OrchestrationCheckpoint | undefined>;

  /** Retrieve all checkpoints for a conversation, newest-first. */
  listHistory(threadId: string, limit?: number): Promise<OrchestrationCheckpoint[]>;

  /** Delete all checkpoints for a conversation (GDPR, data retention). */
  deleteThread(threadId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Main adapter interface
// ---------------------------------------------------------------------------

/**
 * The central adapter bridging OrchestrationState ↔ LangGraph runtime.
 *
 * A single concrete implementation of this interface encapsulates all
 * LangGraph-specific knowledge. Application code only uses:
 *   - LangGraphOrchestrationAdapter.buildGraph() to compile the graph once.
 *   - CompiledOrchestrationGraph to invoke and stream turns.
 *
 * The adapter is the ONLY place in the codebase that imports from
 * `@langchain/langgraph`. Everything else works through these interfaces.
 *
 * @typeParam TLangGraphState  LangGraph's generated state type.
 * @typeParam TCompiledGraph   LangGraph's CompiledStateGraph.
 * @typeParam TCheckpointer    LangGraph's BaseCheckpointSaver.
 *
 * Typical usage:
 *
 *   // 1. Instantiate the concrete adapter (only import in the app layer)
 *   import { LangGraphAdapter } from "./adapters/langgraph-adapter.js";
 *   const adapter = new LangGraphAdapter({ checkpointer: postgresCheckpointer });
 *
 *   // 2. Build the graph once at startup
 *   const graph = adapter.buildGraph(StandardWorkflowGraphDefinition, context);
 *
 *   // 3. Invoke per turn — fully framework-agnostic
 *   const { state } = await graph.invoke(userInput, { threadId: conversationId });
 *
 *   // 4. Stream events for real-time UI
 *   for await (const event of graph.stream(userInput, { threadId: conversationId })) {
 *     if (event.eventType === "message-delta") sendToClient(event.delta);
 *   }
 *
 *   // 5. Resume after approval
 *   const { state } = await graph.resumeApproval(decision, { threadId: conversationId });
 */
export interface LangGraphOrchestrationAdapter<
  TLangGraphState = unknown,
  TCompiledGraph = unknown,
  TCheckpointer = unknown,
> {
  // -- State translation --

  /**
   * Translate a full OrchestrationState to the LangGraph state format.
   *
   * Used for the initial graph invocation (`.invoke()`) and for test assertions.
   * The concrete implementation maps each OrchestrationState field to its
   * corresponding LangGraph Annotation channel.
   */
  toLangGraphState(state: Partial<OrchestrationState>): TLangGraphState;

  /**
   * Translate a LangGraph state snapshot back to OrchestrationState.
   *
   * Used after graph execution to extract the final state for the caller.
   * Also used inside node wrappers to give OrchestrationNodeFn its input.
   */
  fromLangGraphState(lgState: TLangGraphState): OrchestrationState;

  /**
   * Translate an OrchestrationStateUpdate to the partial state delta format
   * that LangGraph expects as a node function's return value.
   *
   * This is the core of the adapter: it applies channel semantics:
   *   - `appendMessages` → `{ messages: update.appendMessages }` (reducer appends)
   *   - `currentFrame: null` → `{ currentFrame: undefined }` (clear-set)
   *   - `mergeMetadata` → `{ metadata: merged }` (merge reducer)
   *
   * The returned value is what a wrapped node function returns to LangGraph.
   */
  updateToLangGraphDelta(update: OrchestrationStateUpdate): Partial<TLangGraphState>;

  // -- Node wrapping --

  /**
   * Wrap a framework-agnostic OrchestrationNodeFn as a LangGraph node function.
   *
   * The wrapper:
   *   1. Receives LangGraph state.
   *   2. Translates to OrchestrationState via `fromLangGraphState()`.
   *   3. Calls the OrchestrationNodeFn with the state and context.
   *   4. Translates the returned OrchestrationStateUpdate via `updateToLangGraphDelta()`.
   *   5. Returns the delta to LangGraph.
   *
   * Error handling: if the node function throws, the wrapper catches the error,
   * translates it to an OrchestrationError, and returns a state update that
   * sets `phase: "faulted"` and `error: ...` rather than letting LangGraph see
   * a raw exception.
   */
  wrapNode(
    nodeId: string,
    fn: OrchestrationNodeFn,
    context: OrchestrationContext
  ): LangGraphNodeWrapper<TLangGraphState>;

  /**
   * Wrap a framework-agnostic OrchestrationRouter as a LangGraph conditional edge.
   *
   * The wrapper:
   *   1. Receives LangGraph state.
   *   2. Translates to OrchestrationState via `fromLangGraphState()`.
   *   3. Calls the OrchestrationRouter.
   *   4. Returns the `nextNode` string to LangGraph.
   *
   * The `possibleTargets` field of the returned wrapper must enumerate all
   * node IDs the router may return — LangGraph requires this for static
   * edge declaration.
   */
  wrapRouter(
    fromNodeId: string,
    router: OrchestrationRouter,
    possibleTargets: string[]
  ): LangGraphEdgeWrapper<TLangGraphState>;

  // -- Graph compilation --

  /**
   * Compile an OrchestrationGraphDefinition into a CompiledOrchestrationGraph.
   *
   * This is the primary entry point for graph construction. The concrete
   * implementation:
   *   1. Creates a `StateGraph(Annotation.Root({...}))` with channels from
   *      `ORCHESTRATION_STATE_CHANNELS`.
   *   2. Adds each node from `definition.nodes` (wrapped via `wrapNode()`).
   *   3. Adds each edge from `definition.edges` (conditional edges wrapped via
   *      `wrapRouter()`, unconditional added directly).
   *   4. Sets the entry point to `definition.entryPoint`.
   *   5. Configures `interruptBefore` for `definition.interruptibleNodes`.
   *   6. Calls `.compile({ checkpointer })` to produce the compiled graph.
   *   7. Returns a CompiledOrchestrationGraph wrapping the compiled graph.
   */
  buildGraph(
    definition: OrchestrationGraphDefinition,
    context: OrchestrationContext
  ): CompiledOrchestrationGraph<TCompiledGraph>;

  // -- Checkpointer --

  /** Access to the checkpoint management adapter. */
  readonly checkpointerAdapter: CheckpointerAdapter<TCheckpointer>;
}

// ---------------------------------------------------------------------------
// Approval suspension contract
// ---------------------------------------------------------------------------

/**
 * The data produced by the REQUEST_APPROVAL node that the graph runtime
 * needs to suspend and later resume.
 *
 * In LangGraph this flows through the `interrupt()` mechanism:
 *
 *   // Inside the LangGraph-wrapped REQUEST_APPROVAL node:
 *   const suspension = buildApprovalSuspension(state, gate);
 *   interrupt(suspension);  // <-- LangGraph pauses here
 *   // Execution resumes only when resumeApproval() is called
 *
 * The suspension value is stored by LangGraph in the checkpoint and
 * returned to the caller as the `interrupt` value in the run result.
 *
 * The adapter exposes this through `CompiledOrchestrationGraph.resumeApproval()`
 * so callers never see raw LangGraph interrupt mechanics.
 */
export interface ApprovalSuspensionPayload {
  /** The conversation to resume when the approval is resolved. */
  threadId: string;
  /** The gate that was opened. */
  gateId: string;
  executionRequestId: string;
  capabilityId: string;
  requirementIds: string[];
  approverRole: string;
  /** ISO timestamp when the gate expires. */
  timeoutAt: ISOTimestamp;
}

// ---------------------------------------------------------------------------
// Adapter configuration
// ---------------------------------------------------------------------------

/**
 * Configuration options for the concrete LangGraphOrchestrationAdapter.
 *
 * Passed to the adapter constructor by the application bootstrapper.
 * The generic type parameters correspond to the LangGraph types the
 * concrete implementation works with.
 *
 * @typeParam TCheckpointer  LangGraph's BaseCheckpointSaver implementation.
 */
export interface LangGraphAdapterConfig<TCheckpointer = unknown> {
  /**
   * The LangGraph checkpointer instance for conversation persistence.
   *
   * Examples:
   *   - `new MemorySaver()` for in-memory (dev/testing)
   *   - `new PostgresSaver(pool)` for production persistence
   *   - `new SqliteSaver(db)` for lightweight deployments
   */
  checkpointer: TCheckpointer;

  /**
   * Maximum number of graph steps before LangGraph raises a RecursionError.
   * Defaults to 25. Increase for complex multi-step workflows.
   */
  recursionLimit?: number;

  /**
   * Optional logger forwarded to OrchestrationContext.logger during graph runs.
   */
  logger?: import("./types.js").OrchestrationLogger;

  /**
   * Optional override for the state channel configuration.
   * If provided, merged over ORCHESTRATION_STATE_CHANNELS.
   * Use to customize reducers for extended state fields.
   */
  channelOverrides?: Partial<OrchestrationStateChannelMap>;
}
