/**
 * LangGraph Integration — Standard Workflow Graph Topology
 *
 * This module defines the standard PCP orchestration graph: the node set,
 * edge topology, routing logic, and a fluent builder for custom variants.
 *
 * What this module provides:
 *   - `StandardNodeId` constants (re-exported from nodes.ts for convenience)
 *   - Router functions for each conditional edge in the standard workflow
 *   - `StandardWorkflowGraphDefinition` — the pre-wired graph definition
 *   - `WorkflowGraphBuilder` — fluent builder for custom topologies
 *
 * What this module does NOT provide:
 *   - Node function implementations (those live in application code; they
 *     depend on concrete service implementations the framework cannot provide)
 *   - LangGraph StateGraph construction (that is the adapter's responsibility)
 *
 * Standard workflow graph:
 *
 *   START
 *     └─► receive-input
 *               └─► project-frame
 *                         └─► route-from-projection
 *                               ├─[execution-requested]─► evaluate-guardrail
 *                               │                               └─► route-from-guardrail
 *                               │                                     ├─[allow/flag]──► execute-capability
 *                               │                                     │                       └─► route-from-execution
 *                               │                                     │                             ├─[success]──► generate-response
 *                               │                                     │                             └─[error]────► handle-error
 *                               │                                     ├─[require-approval]─► request-approval
 *                               │                                     │                           └─► route-from-approval
 *                               │                                     │                                 ├─[granted]──► execute-capability
 *                               │                                     │                                 ├─[denied]───► generate-response
 *                               │                                     │                                 └─[error]────► handle-error
 *                               │                                     ├─[deny]─────────► generate-response
 *                               │                                     └─[error]─────────► handle-error
 *                               ├─[clarification-needed]─► generate-response
 *                               └─[error]────────────────► handle-error
 *
 *   handle-error
 *     ├─[recoverable]─► generate-response
 *     └─[fatal]───────► terminate
 *
 *   generate-response ──► END
 *   terminate         ──► END
 */

import type {
  OrchestrationConditionalEdge,
  OrchestrationEdgeDefinition,
  OrchestrationGraphDefinition,
  OrchestrationNodeDefinition,
  OrchestrationNodeFn,
  OrchestrationRoutingDecision,
  OrchestrationRouter,
  OrchestrationState,
  OrchestrationUnconditionalEdge,
} from "./types.js";
import {
  StandardNodeId,
  type StandardNodeId as StandardNodeIdType,
} from "./nodes.js";

// ---------------------------------------------------------------------------
// Router implementations
// ---------------------------------------------------------------------------

/**
 * Routes after the PROJECT_FRAME node based on the projection outcome.
 *
 * The node sets `phase` before returning, so the router reads only `phase`:
 *   "awaiting-guardrail" → an ExecutionRequest is pending guardrail evaluation
 *   "generating-response" → clarification needed; skip execution
 *   "faulted" → projection failed; route to error handler
 */
export const routeFromProjection: OrchestrationRouter = (
  state: Readonly<OrchestrationState>
): OrchestrationRoutingDecision => {
  switch (state.phase) {
    case "awaiting-guardrail":
      return {
        nextNode: StandardNodeId.EVALUATE_GUARDRAIL,
        reason: "Projection produced an execution request; routing to guardrail",
      };
    case "generating-response":
      return {
        nextNode: StandardNodeId.GENERATE_RESPONSE,
        reason: "Projection determined clarification is needed; routing to response",
      };
    case "faulted":
      return {
        nextNode: StandardNodeId.HANDLE_ERROR,
        reason: "Projection phase faulted; routing to error handler",
      };
    default:
      return {
        nextNode: StandardNodeId.HANDLE_ERROR,
        reason: `Unexpected phase after projection: ${state.phase}`,
      };
  }
};

/**
 * Routes after the EVALUATE_GUARDRAIL node based on the guardrail decision.
 *
 * Reads `guardrailResult.decision` (not `phase`) because the decision is the
 * authoritative signal. The node also sets `phase` consistently, but the
 * decision field is the semantically correct discriminant for routing.
 */
export const routeFromGuardrail: OrchestrationRouter = (
  state: Readonly<OrchestrationState>
): OrchestrationRoutingDecision => {
  if (state.phase === "faulted") {
    return {
      nextNode: StandardNodeId.HANDLE_ERROR,
      reason: "Guardrail phase faulted; routing to error handler",
    };
  }

  const decision = state.guardrailResult?.decision;

  switch (decision) {
    case "allow":
    case "flag":
      return {
        nextNode: StandardNodeId.EXECUTE_CAPABILITY,
        reason: `Guardrail decision: ${decision}; routing to capability execution`,
      };
    case "require-approval":
      return {
        nextNode: StandardNodeId.REQUEST_APPROVAL,
        reason: "Guardrail requires approval; opening approval gate",
      };
    case "deny":
      return {
        nextNode: StandardNodeId.GENERATE_RESPONSE,
        reason: "Guardrail denied the request; routing to response generation",
      };
    default:
      return {
        nextNode: StandardNodeId.HANDLE_ERROR,
        reason: `Unexpected guardrail decision: ${String(decision)}`,
      };
  }
};

/**
 * Routes after the REQUEST_APPROVAL node resolves (graph resume path).
 *
 * This router fires when LangGraph resumes after an approval interrupt.
 * The approval gate has been resolved; the router reads the active gate's
 * status to determine the next step.
 */
export const routeFromApproval: OrchestrationRouter = (
  state: Readonly<OrchestrationState>
): OrchestrationRoutingDecision => {
  if (state.phase === "faulted") {
    return {
      nextNode: StandardNodeId.HANDLE_ERROR,
      reason: "Approval phase faulted; routing to error handler",
    };
  }

  const activeGateId = state.activeApprovalGateId;
  if (!activeGateId) {
    return {
      nextNode: StandardNodeId.HANDLE_ERROR,
      reason: "No active approval gate found on resume; routing to error handler",
    };
  }

  const gate = state.approvalGates.find((g) => g.gateId === activeGateId);
  if (!gate) {
    return {
      nextNode: StandardNodeId.HANDLE_ERROR,
      reason: `Active approval gate ${activeGateId} not found in state`,
    };
  }

  switch (gate.status) {
    case "granted":
      return {
        nextNode: StandardNodeId.EXECUTE_CAPABILITY,
        reason: "Approval granted; proceeding to capability execution",
      };
    case "denied":
    case "timed-out":
      return {
        nextNode: StandardNodeId.GENERATE_RESPONSE,
        reason: `Approval ${gate.status}; routing to response generation`,
      };
    case "open":
      // Should not happen on the resume path — the interrupt only resumes
      // when a decision has been submitted. Treat as an error.
      return {
        nextNode: StandardNodeId.HANDLE_ERROR,
        reason: "Approval gate still open on resume path; possible race condition",
      };
    default:
      return {
        nextNode: StandardNodeId.HANDLE_ERROR,
        reason: `Unknown approval gate status: ${String(gate.status)}`,
      };
  }
};

/**
 * Routes after the EXECUTE_CAPABILITY node.
 *
 * The capability node sets `phase` before returning. On unexpected fault,
 * it routes to the error handler. On successful completion (any status —
 * success, failure, partial, timeout), it routes to response generation
 * so the AI can describe what happened.
 */
export const routeFromExecution: OrchestrationRouter = (
  state: Readonly<OrchestrationState>
): OrchestrationRoutingDecision => {
  if (state.phase === "faulted") {
    return {
      nextNode: StandardNodeId.HANDLE_ERROR,
      reason: "Execution phase faulted unexpectedly; routing to error handler",
    };
  }

  // All non-fault outcomes route to response generation.
  // The synthesizer receives `capabilityResult` and adapts its response
  // based on status (success / failure / partial / timed-out / denied).
  return {
    nextNode: StandardNodeId.GENERATE_RESPONSE,
    reason: `Execution completed with status: ${state.capabilityResult?.status ?? "unknown"}`,
  };
};

/**
 * Routes after the HANDLE_ERROR node based on error recoverability.
 *
 * Recoverable errors route to response generation so the AI can tell
 * the user what went wrong in a safe, user-friendly way.
 * Fatal errors route to session termination.
 */
export const routeFromErrorHandler: OrchestrationRouter = (
  state: Readonly<OrchestrationState>
): OrchestrationRoutingDecision => {
  if (!state.error) {
    // The error was cleared by the handler — treat as recovered.
    return {
      nextNode: StandardNodeId.GENERATE_RESPONSE,
      reason: "Error was cleared by handler; resuming normal response path",
    };
  }

  if (state.error.recoverable) {
    return {
      nextNode: StandardNodeId.GENERATE_RESPONSE,
      reason: `Recoverable error (${state.error.code}); routing to response to inform user`,
    };
  }

  return {
    nextNode: StandardNodeId.TERMINATE,
    reason: `Fatal error (${state.error.code}); terminating session`,
  };
};

// ---------------------------------------------------------------------------
// Edge topology helpers
// ---------------------------------------------------------------------------

/** Construct an unconditional edge. */
function unconditional(
  from: StandardNodeIdType | "START",
  to: StandardNodeIdType | "__end__"
): OrchestrationUnconditionalEdge {
  return { kind: "unconditional", from, to };
}

/** Construct a conditional edge with its router and declared targets. */
function conditional(
  from: StandardNodeIdType,
  router: OrchestrationRouter,
  routes: Record<string, StandardNodeIdType | "__end__">
): OrchestrationConditionalEdge {
  return { kind: "conditional", from, router, routes };
}

// ---------------------------------------------------------------------------
// Standard node placeholder factory
// ---------------------------------------------------------------------------

/**
 * A sentinel node function used to declare the standard node set without
 * providing concrete implementations.
 *
 * The actual node functions are provided by the application layer via
 * `WorkflowGraphBuilder.replaceNode()`. If a sentinel node executes at
 * runtime, it throws — this prevents partially-wired graphs from silently
 * doing nothing.
 *
 * @param nodeId  The node whose implementation is missing.
 */
function sentinelNode(nodeId: string): OrchestrationNodeFn {
  return async (_state, _context) => {
    throw new Error(
      `[PCP] Orchestration node "${nodeId}" has no implementation. ` +
        `Provide an implementation via WorkflowGraphBuilder.replaceNode("${nodeId}", fn).`
    );
  };
}

// ---------------------------------------------------------------------------
// Standard node definitions (declarations without implementations)
// ---------------------------------------------------------------------------

/**
 * The standard node declarations for the PCP workflow graph.
 *
 * Each node is declared with a sentinel implementation. The application
 * bootstrapper must supply concrete implementations via `WorkflowGraphBuilder`
 * before the graph can be compiled and invoked.
 *
 * This design ensures:
 *   - The graph topology is fully specified here (nodes, edges, routing).
 *   - Concrete implementations are injected by the application (dependency inversion).
 *   - Missing implementations are caught at startup, not at first invocation.
 */
const STANDARD_NODES: OrchestrationNodeDefinition[] = [
  {
    nodeId: StandardNodeId.RECEIVE_INPUT,
    name: "Receive Input",
    description: "Ingests the user message and initializes the active conversation turn",
    fn: sentinelNode(StandardNodeId.RECEIVE_INPUT),
  },
  {
    nodeId: StandardNodeId.PROJECT_FRAME,
    name: "Project Frame",
    description:
      "Calls the FrameProjector to build a Decision Frame from the user's intent. " +
      "Runs beforeProjection and afterProjection hooks.",
    fn: sentinelNode(StandardNodeId.PROJECT_FRAME),
  },
  {
    nodeId: StandardNodeId.EVALUATE_GUARDRAIL,
    name: "Evaluate Guardrail",
    description:
      "Runs the Guardrail pipeline against the pending ExecutionRequest. " +
      "Runs beforeGuardrail and afterGuardrail hooks.",
    fn: sentinelNode(StandardNodeId.EVALUATE_GUARDRAIL),
  },
  {
    nodeId: StandardNodeId.REQUEST_APPROVAL,
    name: "Request Approval",
    description:
      "Opens an approval gate via ApprovalGateway and signals LangGraph to interrupt, " +
      "suspending the conversation until the approval resolves.",
    fn: sentinelNode(StandardNodeId.REQUEST_APPROVAL),
  },
  {
    nodeId: StandardNodeId.EXECUTE_CAPABILITY,
    name: "Execute Capability",
    description:
      "Dispatches the approved ExecutionRequest to the CapabilityDispatcher. " +
      "Runs beforeCapability and afterCapability hooks.",
    fn: sentinelNode(StandardNodeId.EXECUTE_CAPABILITY),
  },
  {
    nodeId: StandardNodeId.GENERATE_RESPONSE,
    name: "Generate Response",
    description:
      "Calls the ResponseSynthesizer to compose the AI's conversational reply. " +
      "Finalizes the completed turn and appends the response to conversation history.",
    fn: sentinelNode(StandardNodeId.GENERATE_RESPONSE),
  },
  {
    nodeId: StandardNodeId.HANDLE_ERROR,
    name: "Handle Error",
    description:
      "Classifies OrchestrationState.error and decides: route to response " +
      "(recoverable errors) or terminate (fatal errors). Fires onError hooks.",
    fn: sentinelNode(StandardNodeId.HANDLE_ERROR),
  },
  {
    nodeId: StandardNodeId.TERMINATE,
    name: "Terminate",
    description:
      "Closes the conversation session, flushes remaining audit records, " +
      "and transitions state to 'terminated'.",
    fn: sentinelNode(StandardNodeId.TERMINATE),
  },
];

// ---------------------------------------------------------------------------
// Standard edge topology
// ---------------------------------------------------------------------------

/**
 * The complete edge set for the standard PCP workflow graph.
 *
 * Router functions are declared here, referencing the canonical router
 * implementations above. The adapter uses these to add conditional edges
 * to the LangGraph StateGraph.
 */
const STANDARD_EDGES: OrchestrationEdgeDefinition[] = [
  // Entry
  unconditional("START", StandardNodeId.RECEIVE_INPUT),
  unconditional(StandardNodeId.RECEIVE_INPUT, StandardNodeId.PROJECT_FRAME),

  // Projection → conditional routing
  conditional(StandardNodeId.PROJECT_FRAME, routeFromProjection, {
    "execution-requested": StandardNodeId.EVALUATE_GUARDRAIL,
    "clarification-needed": StandardNodeId.GENERATE_RESPONSE,
    "error": StandardNodeId.HANDLE_ERROR,
  }),

  // Guardrail → conditional routing
  conditional(StandardNodeId.EVALUATE_GUARDRAIL, routeFromGuardrail, {
    "allow": StandardNodeId.EXECUTE_CAPABILITY,
    "flag": StandardNodeId.EXECUTE_CAPABILITY,
    "require-approval": StandardNodeId.REQUEST_APPROVAL,
    "deny": StandardNodeId.GENERATE_RESPONSE,
    "error": StandardNodeId.HANDLE_ERROR,
  }),

  // Approval → conditional routing (resume path)
  conditional(StandardNodeId.REQUEST_APPROVAL, routeFromApproval, {
    "granted": StandardNodeId.EXECUTE_CAPABILITY,
    "denied": StandardNodeId.GENERATE_RESPONSE,
    "timed-out": StandardNodeId.GENERATE_RESPONSE,
    "error": StandardNodeId.HANDLE_ERROR,
  }),

  // Execution → conditional routing
  conditional(StandardNodeId.EXECUTE_CAPABILITY, routeFromExecution, {
    "completed": StandardNodeId.GENERATE_RESPONSE,
    "error": StandardNodeId.HANDLE_ERROR,
  }),

  // Error handler → conditional routing
  conditional(StandardNodeId.HANDLE_ERROR, routeFromErrorHandler, {
    "recoverable": StandardNodeId.GENERATE_RESPONSE,
    "fatal": StandardNodeId.TERMINATE,
  }),

  // Terminal edges
  unconditional(StandardNodeId.GENERATE_RESPONSE, "__end__"),
  unconditional(StandardNodeId.TERMINATE, "__end__"),
];

// ---------------------------------------------------------------------------
// StandardWorkflowGraphDefinition
// ---------------------------------------------------------------------------

/**
 * The canonical, pre-wired graph definition for the PCP standard workflow.
 *
 * This is the entry point for most applications. Pass it to
 * `LangGraphOrchestrationAdapter.buildGraph()` after replacing the sentinel
 * node implementations via `WorkflowGraphBuilder`.
 *
 * Usage:
 *
 *   const graph = new WorkflowGraphBuilder(StandardWorkflowGraphDefinition)
 *     .replaceNode(StandardNodeId.RECEIVE_INPUT,      receiveInputNode)
 *     .replaceNode(StandardNodeId.PROJECT_FRAME,      projectFrameNode)
 *     .replaceNode(StandardNodeId.EVALUATE_GUARDRAIL, evaluateGuardrailNode)
 *     .replaceNode(StandardNodeId.REQUEST_APPROVAL,   requestApprovalNode)
 *     .replaceNode(StandardNodeId.EXECUTE_CAPABILITY, executeCapabilityNode)
 *     .replaceNode(StandardNodeId.GENERATE_RESPONSE,  generateResponseNode)
 *     .replaceNode(StandardNodeId.HANDLE_ERROR,       handleErrorNode)
 *     .replaceNode(StandardNodeId.TERMINATE,          terminateNode)
 *     .build();
 *
 *   const compiledGraph = adapter.buildGraph(graph, context);
 */
export const StandardWorkflowGraphDefinition: OrchestrationGraphDefinition = {
  name: "PCP Standard Workflow",
  nodes: STANDARD_NODES,
  edges: STANDARD_EDGES,
  entryPoint: StandardNodeId.RECEIVE_INPUT,
  interruptibleNodes: [StandardNodeId.REQUEST_APPROVAL],
};

// ---------------------------------------------------------------------------
// WorkflowGraphBuilder
// ---------------------------------------------------------------------------

/**
 * Fluent builder for assembling and customizing an orchestration graph.
 *
 * Typical usage starts from `StandardWorkflowGraphDefinition` and replaces
 * the sentinel node implementations with real ones:
 *
 *   const definition = new WorkflowGraphBuilder(StandardWorkflowGraphDefinition)
 *     .replaceNode(StandardNodeId.PROJECT_FRAME, myProjectFrameNode)
 *     .addNode({ nodeId: "my-custom-node", name: "Custom", fn: myNodeFn })
 *     .addEdge({ kind: "unconditional", from: "my-custom-node", to: StandardNodeId.GENERATE_RESPONSE })
 *     .build();
 *
 * For entirely custom topologies, start with an empty builder:
 *
 *   const definition = WorkflowGraphBuilder.empty("My Custom Workflow", "entry-node")
 *     .addNode(...)
 *     .addEdge(...)
 *     .build();
 */
export class WorkflowGraphBuilder {
  private _name: string;
  private readonly _nodes: Map<string, OrchestrationNodeDefinition>;
  private readonly _edges: OrchestrationEdgeDefinition[];
  private _entryPoint: string;
  private _interruptibleNodes: string[];

  constructor(base?: OrchestrationGraphDefinition) {
    if (base) {
      this._name = base.name;
      this._nodes = new Map(base.nodes.map((n) => [n.nodeId, { ...n }]));
      this._edges = [...base.edges];
      this._entryPoint = base.entryPoint;
      this._interruptibleNodes = [...(base.interruptibleNodes ?? [])];
    } else {
      this._name = "Custom Workflow";
      this._nodes = new Map();
      this._edges = [];
      this._entryPoint = "";
      this._interruptibleNodes = [];
    }
  }

  /**
   * Start a fresh builder for a fully custom graph (no standard nodes).
   */
  static empty(name: string, entryPoint: string): WorkflowGraphBuilder {
    const builder = new WorkflowGraphBuilder();
    builder._name = name;
    builder._entryPoint = entryPoint;
    return builder;
  }

  /**
   * Replace the implementation of an existing node.
   *
   * Use this to provide concrete implementations for the sentinel nodes
   * in `StandardWorkflowGraphDefinition`.
   *
   * @throws Error if `nodeId` is not a registered node.
   */
  replaceNode(nodeId: string, fn: OrchestrationNodeFn): this {
    const existing = this._nodes.get(nodeId);
    if (!existing) {
      throw new Error(
        `[WorkflowGraphBuilder] Cannot replace node "${nodeId}": node not found. ` +
          `Use addNode() to add a new node.`
      );
    }
    this._nodes.set(nodeId, { ...existing, fn });
    return this;
  }

  /**
   * Add a new node to the graph.
   *
   * @throws Error if a node with the same nodeId already exists.
   */
  addNode(node: OrchestrationNodeDefinition): this {
    if (this._nodes.has(node.nodeId)) {
      throw new Error(
        `[WorkflowGraphBuilder] Node "${node.nodeId}" already exists. ` +
          `Use replaceNode() to replace an existing node's implementation.`
      );
    }
    this._nodes.set(node.nodeId, node);
    return this;
  }

  /**
   * Add an edge (unconditional or conditional) to the graph.
   */
  addEdge(edge: OrchestrationEdgeDefinition): this {
    this._edges.push(edge);
    return this;
  }

  /**
   * Override the graph entry point.
   */
  setEntryPoint(nodeId: string): this {
    this._entryPoint = nodeId;
    return this;
  }

  /**
   * Mark a node as interruptible (approval-suspendable).
   *
   * The adapter configures LangGraph's `interruptBefore` for these nodes.
   */
  addInterruptibleNode(nodeId: string): this {
    if (!this._interruptibleNodes.includes(nodeId)) {
      this._interruptibleNodes.push(nodeId);
    }
    return this;
  }

  /**
   * Validate the graph definition for common wiring errors and return it.
   *
   * Validation checks:
   *   - Entry point references a registered node.
   *   - All edge source and target nodes are registered.
   *   - All router `routes` target nodes are registered.
   *   - All interruptible nodes are registered.
   *   - All sentinel implementations have been replaced.
   *
   * @throws Error (with a descriptive list) if any check fails.
   */
  build(): OrchestrationGraphDefinition {
    const errors: string[] = [];
    const nodeIds = new Set(this._nodes.keys());

    // Entry point check
    if (!nodeIds.has(this._entryPoint)) {
      errors.push(`Entry point "${this._entryPoint}" is not a registered node.`);
    }

    // Edge checks
    for (const edge of this._edges) {
      const from = edge.from;
      if (from !== "START" && !nodeIds.has(from)) {
        errors.push(`Edge source "${from}" is not a registered node.`);
      }
      if (edge.kind === "unconditional") {
        if (edge.to !== "__end__" && !nodeIds.has(edge.to)) {
          errors.push(`Edge target "${edge.to}" is not a registered node.`);
        }
      } else {
        for (const [label, target] of Object.entries(edge.routes)) {
          if (target !== "__end__" && !nodeIds.has(target)) {
            errors.push(
              `Conditional edge from "${from}" route "${label}" targets ` +
                `unknown node "${target}".`
            );
          }
        }
      }
    }

    // Interruptible node checks
    for (const nodeId of this._interruptibleNodes) {
      if (!nodeIds.has(nodeId)) {
        errors.push(`Interruptible node "${nodeId}" is not a registered node.`);
      }
    }

    // Sentinel implementation check
    for (const [nodeId, node] of this._nodes) {
      // Sentinel functions have a recognizable toString() — check by name pattern
      const fnStr = node.fn.toString();
      if (fnStr.includes("sentinelNode") || fnStr.includes("has no implementation")) {
        errors.push(
          `Node "${nodeId}" still has a sentinel implementation. ` +
            `Call replaceNode("${nodeId}", yourFn) before building.`
        );
      }
    }

    if (errors.length > 0) {
      throw new Error(
        `[WorkflowGraphBuilder] Graph "${this._name}" has ${errors.length} error(s):\n` +
          errors.map((e) => `  • ${e}`).join("\n")
      );
    }

    const definition: OrchestrationGraphDefinition = {
      name: this._name,
      nodes: Array.from(this._nodes.values()),
      edges: [...this._edges],
      entryPoint: this._entryPoint,
    };

    if (this._interruptibleNodes.length > 0) {
      definition.interruptibleNodes = [...this._interruptibleNodes];
    }

    return definition;
  }
}
