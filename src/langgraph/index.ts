/**
 * LangGraph Integration Layer — Public API
 *
 * Entry point for all LangGraph orchestration integration exports.
 *
 * Four modules make up this layer:
 *
 *   types.ts    — Framework-agnostic orchestration state, conversation model,
 *                 node/router function types, graph definition types
 *   nodes.ts    — Service interfaces (FrameProjector, GuardrailEvaluator, etc.)
 *                 and standard node ID constants
 *   adapter.ts  — LangGraph bridging contracts: state channel mapping,
 *                 node/edge wrappers, compiled graph interface, checkpointer
 *   graph.ts    — Standard workflow graph topology, routers, WorkflowGraphBuilder
 *
 * Architecture summary:
 *
 *   ┌─────────────────────────────────────────────────────────────────────┐
 *   │  Application Layer (your code)                                      │
 *   │    - Implements service interfaces (FrameProjector, etc.)           │
 *   │    - Instantiates concrete LangGraphOrchestrationAdapter            │
 *   │    - Builds graph via WorkflowGraphBuilder                          │
 *   │    - Invokes via CompiledOrchestrationGraph                         │
 *   ├─────────────────────────────────────────────────────────────────────┤
 *   │  This module (boundary specification)                               │
 *   │    - OrchestrationState (what LangGraph persists)                   │
 *   │    - OrchestrationNodeFn (what nodes implement)                     │
 *   │    - Service interfaces (what nodes call)                           │
 *   │    - Adapter interfaces (what LangGraph must implement)             │
 *   │    - StandardWorkflowGraphDefinition (pre-wired topology)          │
 *   ├─────────────────────────────────────────────────────────────────────┤
 *   │  PCP Business Layers (no awareness of this module)                  │
 *   │    Projection  ── Guardrail  ── Capabilities  ── Audit  ── Hooks   │
 *   └─────────────────────────────────────────────────────────────────────┘
 *
 * Coupling invariants enforced by this module:
 *   1. Zero imports from `@langchain/langgraph` anywhere in this module.
 *   2. Zero imports from this module in Projection, Guardrail, Capabilities,
 *      Audit, or Hooks layers.
 *   3. LangGraph types appear ONLY as generic type parameters in adapter.ts.
 *   4. All business logic (frame building, guardrail evaluation, capability
 *      invocation) is accessed through service interfaces, never through
 *      concrete class imports.
 *
 * Typical wiring — new application:
 *
 *   import {
 *     WorkflowGraphBuilder,
 *     StandardWorkflowGraphDefinition,
 *     StandardNodeId,
 *     ORCHESTRATION_STATE_CHANNELS,
 *   } from "projection-control-plane/langgraph";
 *
 *   // 1. Provide concrete service implementations
 *   const services: OrchestrationServices = {
 *     projector:    new MyFrameProjector(llmClient, retrievalStore),
 *     guardrail:    new MyGuardrailEvaluator(pipeline, hookRegistry),
 *     dispatcher:   new MyCapabilityDispatcher(capabilityRegistry),
 *     approval:     new MyApprovalGateway(approvalService),
 *     synthesizer:  new MyResponseSynthesizer(llmClient),
 *     auditEmitter: new MyAuditEmitter(db),
 *     hookExecutor: new MyHookExecutor(hookRegistry),
 *   };
 *
 *   // 2. Build the graph with concrete node implementations
 *   const graphDefinition = new WorkflowGraphBuilder(StandardWorkflowGraphDefinition)
 *     .replaceNode(StandardNodeId.RECEIVE_INPUT,      buildReceiveInputNode())
 *     .replaceNode(StandardNodeId.PROJECT_FRAME,      buildProjectFrameNode())
 *     .replaceNode(StandardNodeId.EVALUATE_GUARDRAIL, buildEvaluateGuardrailNode())
 *     .replaceNode(StandardNodeId.REQUEST_APPROVAL,   buildRequestApprovalNode())
 *     .replaceNode(StandardNodeId.EXECUTE_CAPABILITY, buildExecuteCapabilityNode())
 *     .replaceNode(StandardNodeId.GENERATE_RESPONSE,  buildGenerateResponseNode())
 *     .replaceNode(StandardNodeId.HANDLE_ERROR,       buildHandleErrorNode())
 *     .replaceNode(StandardNodeId.TERMINATE,          buildTerminateNode())
 *     .build();
 *
 *   // 3. Instantiate the concrete LangGraph adapter (the only LangGraph import)
 *   import { LangGraphAdapter } from "./adapters/langgraph-adapter.js";
 *   const adapter = new LangGraphAdapter({ checkpointer: new MemorySaver() });
 *
 *   // 4. Compile once at startup
 *   const context: OrchestrationContext = { services, runId: "...", logger };
 *   const compiledGraph = adapter.buildGraph(graphDefinition, context);
 *
 *   // 5. Invoke per turn
 *   const { state } = await compiledGraph.invoke(
 *     { conversationId, sessionId, principalId, userMessage: "..." },
 *     { threadId: conversationId }
 *   );
 *
 *   // 6. Stream real-time events
 *   for await (const event of compiledGraph.stream(input, config)) {
 *     if (event.eventType === "message-delta") sendToClient(event.delta);
 *     if (event.eventType === "approval-required") notifyApprovers(event.approvalGate);
 *   }
 *
 *   // 7. Resume after approval
 *   const { state } = await compiledGraph.resumeApproval(
 *     { gateId, outcome: "granted", approverId, decidedAt: new Date().toISOString() },
 *     { threadId: conversationId }
 *   );
 */

// ---------------------------------------------------------------------------
// Types — framework-agnostic orchestration model
// ---------------------------------------------------------------------------

export type {
  // State machine
  WorkflowPhase,

  // Conversation model
  ConversationRole,
  TextContentBlock,
  CapabilityRequestContentBlock,
  CapabilityResultContentBlock,
  ConversationContentBlock,
  ConversationMessage,
  TurnOutcome,
  ActiveConversationTurn,
  CompletedConversationTurn,

  // Approval gate
  ApprovalGateStatus,
  ApprovalGateState,

  // Error
  OrchestrationErrorCode,
  OrchestrationError,

  // Core orchestration state
  OrchestrationState,
  OrchestrationStateUpdate,

  // Node/router function types
  NodeId,
  OrchestrationRoutingDecision,
  OrchestrationNodeFn,
  OrchestrationRouter,

  // Context
  OrchestrationContext,
  OrchestrationServices,
  OrchestrationLogger,

  // Graph definition
  OrchestrationNodeDefinition,
  OrchestrationUnconditionalEdge,
  OrchestrationConditionalEdge,
  OrchestrationEdgeDefinition,
  OrchestrationGraphDefinition,

  // Invocation
  OrchestrationStartInput,
  OrchestrationContinueInput,
  OrchestrationRunConfig,
  OrchestrationStreamEvent,

  // Re-exported canonical primitive aliases
  CapabilityId,
  ConfidenceScore,
  FrameId,
  ISOTimestamp,
  Metadata,
  PrincipalId,
  TraceId,
} from "./types.js";

// ---------------------------------------------------------------------------
// Nodes — service interfaces and standard node IDs
// ---------------------------------------------------------------------------

export {
  /** The built-in node ID constants for the standard PCP workflow graph. */
  StandardNodeId,
} from "./nodes.js";

export type {
  // Standard node ID type
  StandardNodeId as StandardNodeIdType,

  // Service interfaces
  ProjectionInput,
  ProjectionResult,
  FrameProjector,

  GuardrailEvaluationInput,
  GuardrailEvaluator,

  DispatchInput,
  CapabilityDispatcher,

  ApprovalGateRequest,
  ApprovalDecision,
  ApprovalGateway,

  GovernanceOutcomeSummary,
  ResponseSynthesisInput,
  ResponseTokenChunk,
  ResponseSynthesizer,

  OrchestrationAuditEmitter,

  OrchestrationHookContext,
  OrchestrationHookExecutor,

  // Node contracts (for documentation and type checking)
  ReceiveInputNodeContract,
  ProjectFrameNodeContract,
  EvaluateGuardrailNodeContract,
  RequestApprovalNodeContract,
  ExecuteCapabilityNodeContract,
  GenerateResponseNodeContract,
  HandleErrorNodeContract,
  TerminateNodeContract,

  // Node factory
  NodeFactory,
} from "./nodes.js";

// ---------------------------------------------------------------------------
// Adapter — LangGraph bridging contracts
// ---------------------------------------------------------------------------

export {
  /** The canonical state channel map for OrchestrationState fields. */
  ORCHESTRATION_STATE_CHANNELS,
} from "./adapter.js";

export type {
  // Channel configuration
  StateUpdateSemantic,
  StateChannelConfig,
  OrchestrationStateChannelMap,

  // Node/edge wrappers (opaque LangGraph types as generics)
  LangGraphNodeWrapper,
  LangGraphEdgeWrapper,

  // Compiled graph
  OrchestrationRunMetadata,
  CompiledOrchestrationGraph,

  // Checkpointer
  OrchestrationCheckpoint,
  CheckpointerAdapter,

  // Main adapter
  LangGraphOrchestrationAdapter,

  // Approval suspension
  ApprovalSuspensionPayload,

  // Config
  LangGraphAdapterConfig,
} from "./adapter.js";

// ---------------------------------------------------------------------------
// Graph — topology definition and builder
// ---------------------------------------------------------------------------

export {
  // Router functions (for use in custom graph topologies)
  routeFromProjection,
  routeFromGuardrail,
  routeFromApproval,
  routeFromExecution,
  routeFromErrorHandler,

  // Standard graph definition
  StandardWorkflowGraphDefinition,

  // Fluent builder
  WorkflowGraphBuilder,
} from "./graph.js";
