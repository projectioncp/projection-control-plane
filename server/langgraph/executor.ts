/**
 * Orchestrator — LangGraph Sequential Graph Executor
 *
 * A lightweight, framework-agnostic executor that runs the standard PCP
 * workflow graph sequentially and persists conversation state in memory.
 *
 * This executor replaces the stateless execute() pipeline from orchestrator.ts
 * with a multi-turn-capable conversation loop. State is keyed by conversationId
 * so follow-up messages continue the same conversation thread.
 *
 * Architecture:
 *   1. Load or create OrchestrationState for the conversationId
 *   2. Append the user message to state.messages
 *   3. Run the graph from the entry node, following edges until __end__
 *   4. Persist the updated state
 *   5. Return the last assistant message as the response
 *
 * When @langchain/langgraph is installed, replace this executor with the
 * concrete LangGraphOrchestrationAdapter (adapter.ts) for full LangGraph
 * features: streaming, approval interrupts, checkpoint persistence, etc.
 */

import { randomUUID } from "crypto";
import type {
  OrchestrationState,
  OrchestrationStateUpdate,
  OrchestrationContext,
  ConversationMessage,
  WorkflowPhase,
} from "../../src/langgraph/types.js";
import {
  StandardWorkflowGraphDefinition,
  WorkflowGraphBuilder,
} from "../../src/langgraph/graph.js";
import { StandardNodeId } from "../../src/langgraph/nodes.js";
import {
  receiveInputNode,
  projectFrameNode,
  evaluateGuardrailNode,
  requestApprovalNode,
  executeCapabilityNode,
  generateResponseNode,
  handleErrorNode,
  terminateNode,
} from "./node-fns.js";
import { createServices } from "./services.js";

// ---------------------------------------------------------------------------
// In-memory conversation state store
// ---------------------------------------------------------------------------

const conversationStore = new Map<string, OrchestrationState>();

// ---------------------------------------------------------------------------
// State helpers
// ---------------------------------------------------------------------------

function createInitialState(
  conversationId: string,
  sessionId: string,
  principalId: string,
): OrchestrationState {
  return {
    conversationId,
    sessionId,
    principalId,
    phase: "idle",
    messages: [],
    completedTurns: [],
    approvalGates: [],
    auditRecords: [],
  };
}

function applyUpdate(
  state: OrchestrationState,
  update: OrchestrationStateUpdate,
): OrchestrationState {
  const next: OrchestrationState = { ...state };

  // Replace fields
  if (update.phase !== undefined) next.phase = update.phase;
  if ("activeTurn" in update) {
    if (update.activeTurn != null) next.activeTurn = update.activeTurn;
    else delete next.activeTurn;
  }
  if ("currentFrame" in update) {
    if (update.currentFrame != null) next.currentFrame = update.currentFrame;
    else delete next.currentFrame;
  }
  if ("pendingExecutionRequest" in update) {
    if (update.pendingExecutionRequest != null) next.pendingExecutionRequest = update.pendingExecutionRequest;
    else delete next.pendingExecutionRequest;
  }
  if ("guardrailResult" in update) {
    if (update.guardrailResult != null) next.guardrailResult = update.guardrailResult;
    else delete next.guardrailResult;
  }
  if ("capabilityResult" in update) {
    if (update.capabilityResult != null) next.capabilityResult = update.capabilityResult;
    else delete next.capabilityResult;
  }
  if ("activeApprovalGateId" in update) {
    if (update.activeApprovalGateId != null) next.activeApprovalGateId = update.activeApprovalGateId;
    else delete next.activeApprovalGateId;
  }
  if ("error" in update) {
    if (update.error != null) next.error = update.error;
    else delete next.error;
  }
  if (update.traceId !== undefined) next.traceId = update.traceId;

  // Append fields
  if (update.appendMessages?.length) {
    next.messages = [...state.messages, ...update.appendMessages];
  }
  if (update.appendCompletedTurns?.length) {
    next.completedTurns = [...state.completedTurns, ...update.appendCompletedTurns];
  }
  if (update.appendApprovalGates?.length) {
    next.approvalGates = [...state.approvalGates, ...update.appendApprovalGates];
  }

  // Merge metadata
  if (update.mergeMetadata) {
    next.metadata = { ...(state.metadata ?? {}), ...update.mergeMetadata };
  }

  return next;
}

// ---------------------------------------------------------------------------
// Graph setup — compile once at module load
// ---------------------------------------------------------------------------

const graphDefinition = new WorkflowGraphBuilder(StandardWorkflowGraphDefinition)
  .replaceNode(StandardNodeId.RECEIVE_INPUT,      receiveInputNode)
  .replaceNode(StandardNodeId.PROJECT_FRAME,      projectFrameNode)
  .replaceNode(StandardNodeId.EVALUATE_GUARDRAIL, evaluateGuardrailNode)
  .replaceNode(StandardNodeId.REQUEST_APPROVAL,   requestApprovalNode)
  .replaceNode(StandardNodeId.EXECUTE_CAPABILITY, executeCapabilityNode)
  .replaceNode(StandardNodeId.GENERATE_RESPONSE,  generateResponseNode)
  .replaceNode(StandardNodeId.HANDLE_ERROR,       handleErrorNode)
  .replaceNode(StandardNodeId.TERMINATE,          terminateNode)
  .build();

const nodeMap = new Map(graphDefinition.nodes.map((n) => [n.nodeId, n.fn]));

function getNextNodeId(currentNodeId: string, state: OrchestrationState): string | null {
  const edges = graphDefinition.edges.filter((e) => e.from === currentNodeId);

  for (const edge of edges) {
    if (edge.kind === "unconditional") {
      return edge.to === "__end__" ? null : edge.to;
    }
    if (edge.kind === "conditional") {
      const decision = edge.router(state);
      return decision.nextNode === "__end__" ? null : decision.nextNode;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ConversationTurnInput {
  conversationId: string;
  sessionId: string;
  principalId: string;
  userMessage: string;
}

export interface ConversationTurnResult {
  conversationId: string;
  response: string;
  phase: WorkflowPhase;
  turnCount: number;
}

export async function runConversationTurn(
  input: ConversationTurnInput,
): Promise<ConversationTurnResult> {
  const { conversationId, sessionId, principalId, userMessage } = input;

  // Load or create conversation state
  let state =
    conversationStore.get(conversationId) ??
    createInitialState(conversationId, sessionId, principalId);

  // Pre-seed: append the new user message before the graph starts
  const userMsg: ConversationMessage = {
    messageId: randomUUID(),
    role: "user",
    content: userMessage,
    createdAt: new Date().toISOString(),
  };
  state = { ...state, messages: [...state.messages, userMsg], phase: "idle" };

  // Build context (services are stateless — recreated per run)
  const context: OrchestrationContext = {
    services: createServices(),
    runId: randomUUID(),
  };

  // Execute the graph sequentially
  let currentNodeId: string | null = graphDefinition.entryPoint;
  const maxSteps = 20; // safety limit
  let steps = 0;

  while (currentNodeId !== null && steps < maxSteps) {
    steps++;
    const nodeFn = nodeMap.get(currentNodeId);
    if (!nodeFn) {
      throw new Error(`[executor] Node "${currentNodeId}" not found in graph`);
    }

    console.log(`[executor] Running node: ${currentNodeId}`);
    const update = await nodeFn(state, context);
    state = applyUpdate(state, update);

    // Stop if the graph reached a terminal state
    if (state.phase === "terminated") break;

    currentNodeId = getNextNodeId(currentNodeId, state);
  }

  // Persist the updated state
  conversationStore.set(conversationId, state);

  // Extract the last assistant message as the response
  const lastAssistantMsg = [...state.messages]
    .reverse()
    .find((m) => m.role === "assistant");

  const response =
    typeof lastAssistantMsg?.content === "string"
      ? lastAssistantMsg.content
      : "I was unable to generate a response.";

  return {
    conversationId,
    response,
    phase: state.phase,
    turnCount: state.completedTurns.length,
  };
}

export function getConversationState(conversationId: string): OrchestrationState | undefined {
  return conversationStore.get(conversationId);
}

export function clearConversation(conversationId: string): void {
  conversationStore.delete(conversationId);
}
