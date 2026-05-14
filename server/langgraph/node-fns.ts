/**
 * Orchestrator — LangGraph Node Function Implementations
 *
 * Concrete implementations of OrchestrationNodeFn for each node in the
 * standard PCP workflow graph. These functions implement the stateless
 * node contract: receive state + context, return a state update.
 *
 * All business logic is delegated to context.services (see services.ts).
 */

import { randomUUID } from "crypto";
import type {
  OrchestrationNodeFn,
  OrchestrationStateUpdate,
  ConversationMessage,
  ActiveConversationTurn,
  CompletedConversationTurn,
  TurnOutcome,
} from "../../src/langgraph/types.js";
import type { ProjectorOutput, GuardrailResult as ServerGuardrailResult, CapabilityResult as ServerCapabilityResult } from "../types.js";

// ---------------------------------------------------------------------------
// receive-input
// ---------------------------------------------------------------------------

export const receiveInputNode: OrchestrationNodeFn = async (state, _context) => {
  const now = new Date().toISOString();
  const turnId = randomUUID();

  // The latest user message was pre-seeded into state.messages by the executor
  const latestUserMsg = [...state.messages].reverse().find((m) => m.role === "user");

  if (!latestUserMsg) {
    return {
      phase: "faulted",
      error: {
        code: "STATE_INVALID",
        message: "No user message found in conversation state",
        failedPhase: "idle",
        recoverable: false,
      },
    };
  }

  const activeTurn: ActiveConversationTurn = {
    turnId,
    startedAt: now,
    userMessage: latestUserMsg,
    phase: "intent-received",
  };

  return {
    phase: "intent-received",
    activeTurn,
    traceId: randomUUID(),
    // Clear any residual state from the previous turn
    currentFrame: null,
    guardrailResult: null,
    capabilityResult: null,
    activeApprovalGateId: null,
    error: null,
  };
};

// ---------------------------------------------------------------------------
// project-frame
// ---------------------------------------------------------------------------

export const projectFrameNode: OrchestrationNodeFn = async (state, context) => {
  if (!state.activeTurn) {
    return {
      phase: "faulted",
      error: {
        code: "STATE_INVALID",
        message: "No active turn when project-frame node ran",
        failedPhase: "intent-received",
        recoverable: false,
      },
    };
  }

  const userMsg = state.activeTurn.userMessage;
  const rawIntent = typeof userMsg.content === "string" ? userMsg.content : "";

  // Conversation history excludes the current user message
  const conversationHistory = state.messages.filter(
    (m) => m.messageId !== userMsg.messageId,
  );

  try {
    const result = await context.services.projector.project({
      rawIntent,
      principalId: state.principalId,
      sessionId: state.sessionId,
      conversationHistory,
      priorTurns: state.completedTurns,
    });

    if (result.outcome === "failed") {
      return { phase: "faulted", error: result.error };
    }

    if (result.outcome === "clarification-needed") {
      return {
        phase: "generating-response",
        mergeMetadata: { clarificationMessage: result.clarificationMessage },
      };
    }

    // frame-built — store frame with user message for downstream nodes
    return {
      phase: "awaiting-guardrail",
      currentFrame: {
        ...result.frame,
        // Augment frame metadata with the raw user message for synthesizer
        metadata: {
          ...(result.frame.metadata ?? {}),
          rawUserMessage: rawIntent,
        },
      },
      pendingExecutionRequest: result.executionRequest,
    };
  } catch (err) {
    return {
      phase: "faulted",
      error: {
        code: "PROJECTION_FAILED",
        message: err instanceof Error ? err.message : "Projection failed unexpectedly",
        failedPhase: "intent-received",
        recoverable: true,
      },
    };
  }
};

// ---------------------------------------------------------------------------
// evaluate-guardrail
// ---------------------------------------------------------------------------

export const evaluateGuardrailNode: OrchestrationNodeFn = async (state, context) => {
  if (!state.currentFrame || !state.pendingExecutionRequest) {
    return {
      phase: "faulted",
      error: {
        code: "STATE_INVALID",
        message: "Frame or execution request missing when guardrail evaluated",
        failedPhase: "awaiting-guardrail",
        recoverable: false,
      },
    };
  }

  try {
    const result = await context.services.guardrail.evaluate({
      request: state.pendingExecutionRequest,
      frame: state.currentFrame,
    });

    let phase: OrchestrationStateUpdate["phase"];
    switch (result.decision) {
      case "allow":
      case "flag":
        phase = "executing";
        break;
      case "require-approval":
        phase = "awaiting-approval";
        break;
      case "deny":
        phase = "generating-response";
        break;
      default:
        phase = "faulted";
    }

    return { phase, guardrailResult: result };
  } catch (err) {
    return {
      phase: "faulted",
      error: {
        code: "GUARDRAIL_ERROR",
        message: err instanceof Error ? err.message : "Guardrail evaluation failed",
        failedPhase: "awaiting-guardrail",
        recoverable: true,
      },
    };
  }
};

// ---------------------------------------------------------------------------
// request-approval
// ---------------------------------------------------------------------------

export const requestApprovalNode: OrchestrationNodeFn = async (state, context) => {
  if (!state.pendingExecutionRequest || !state.currentFrame || !state.guardrailResult) {
    return {
      phase: "faulted",
      error: {
        code: "STATE_INVALID",
        message: "Missing required state for approval gate creation",
        failedPhase: "awaiting-approval",
        recoverable: false,
      },
    };
  }

  const primary = state.currentFrame.authorizedCapabilities[0];

  try {
    const gate = await context.services.approval.openGate({
      executionRequest: state.pendingExecutionRequest,
      capabilityId: primary?.capabilityId ?? "unknown",
      requirementIds: state.guardrailResult.approvalRequirementIds ?? ["req-1"],
      approverRole: "plant-operations-director",
      timeoutMs: 24 * 60 * 60 * 1000,
      denyOnTimeout: true,
      resumeThreadId: state.conversationId,
    });

    // After opening the gate, route to generate-response so the user is
    // informed that approval is pending. Full interrupt/resume (LangGraph)
    // can be wired later when a real approval gateway is in place.
    return {
      phase: "generating-response",
      activeApprovalGateId: gate.gateId,
      appendApprovalGates: [gate],
    };
  } catch (err) {
    return {
      phase: "faulted",
      error: {
        code: "APPROVAL_SYSTEM_ERROR",
        message: err instanceof Error ? err.message : "Failed to open approval gate",
        failedPhase: "awaiting-approval",
        recoverable: true,
      },
    };
  }
};

// ---------------------------------------------------------------------------
// execute-capability
// ---------------------------------------------------------------------------

export const executeCapabilityNode: OrchestrationNodeFn = async (state, context) => {
  if (!state.pendingExecutionRequest || !state.currentFrame) {
    return {
      phase: "faulted",
      error: {
        code: "STATE_INVALID",
        message: "Missing execution request or frame for capability dispatch",
        failedPhase: "executing",
        recoverable: false,
      },
    };
  }

  try {
    const result = await context.services.dispatcher.dispatch({
      request: state.pendingExecutionRequest,
      frame: state.currentFrame,
      ...(state.activeApprovalGateId
        ? { clearedApprovalGateId: state.activeApprovalGateId }
        : {}),
    });

    return {
      phase: "generating-response",
      capabilityResult: result,
      pendingExecutionRequest: null,
    };
  } catch (err) {
    return {
      phase: "faulted",
      error: {
        code: "CAPABILITY_ERROR",
        message: err instanceof Error ? err.message : "Capability execution failed",
        failedPhase: "executing",
        recoverable: true,
      },
    };
  }
};

// ---------------------------------------------------------------------------
// generate-response
// ---------------------------------------------------------------------------

export const generateResponseNode: OrchestrationNodeFn = async (state, context) => {
  const now = new Date().toISOString();

  try {
    const turnId = state.activeTurn?.turnId ?? randomUUID();
    const startedAt = state.activeTurn?.startedAt ?? now;
    const userMessageId = state.activeTurn?.userMessage.messageId ?? "";

    // Determine outcome
    let outcome: TurnOutcome = "responded";
    if (state.error) outcome = "error";
    else if (state.guardrailResult?.decision === "deny") outcome = "denied";
    else if (
      state.guardrailResult?.decision === "require-approval" ||
      state.activeApprovalGateId
    )
      outcome = "awaiting-approval";
    else if (state.capabilityResult) outcome = "executed";

    // Extract server-side types stored in frame/result metadata for synthesizer
    const projectOutput = state.currentFrame?.metadata?.["projectOutput"] as
      | ProjectorOutput
      | undefined;
    const rawUserMessage =
      (state.currentFrame?.metadata?.["rawUserMessage"] as string | undefined) ??
      (typeof state.activeTurn?.userMessage.content === "string"
        ? state.activeTurn.userMessage.content
        : "");
    const serverGuardrailResult = (
      state.guardrailResult as (typeof state.guardrailResult & { _serverResult?: ServerGuardrailResult })
    )?._serverResult;
    const serverCapabilityResult = state.capabilityResult?.metadata?.["serverResult"] as
      | ServerCapabilityResult
      | undefined;

    // Build conversation history for synthesizer (all messages up to but not including current)
    const historyForSynth = state.messages
      .filter((m) => m.messageId !== state.activeTurn?.userMessage.messageId)
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: typeof m.content === "string" ? m.content : "",
      }));

    const completedTurnBase: Omit<CompletedConversationTurn, "assistantMessageId"> = {
      turnId,
      startedAt,
      completedAt: now,
      durationMs: Date.now() - new Date(startedAt).getTime(),
      outcome,
      userMessageId,
      ...(state.currentFrame ? { frameId: state.currentFrame.frameId } : {}),
      ...(state.guardrailResult
        ? { guardrailDecision: state.guardrailResult.decision }
        : {}),
      ...(state.capabilityResult
        ? { capabilityId: state.capabilityResult.capabilityId }
        : {}),
    };

    const responseMsg = await context.services.synthesizer.generate({
      messages: state.messages,
      completedTurn: completedTurnBase,
      ...(state.capabilityResult ? { capabilityResult: state.capabilityResult } : {}),
      ...(state.guardrailResult && state.guardrailResult.decision !== "allow"
        ? {
            governanceOutcome: {
              decision: state.guardrailResult.decision,
              userSafeReason:
                state.guardrailResult.denyReason ??
                "A governance policy was applied to this request.",
              flagged: state.guardrailResult.decision === "flag",
              approvalRequired:
                state.guardrailResult.decision === "require-approval",
            },
          }
        : {}),
      ...(state.error ? { error: state.error } : {}),
      // Pass server-side types for the synthesizer bridge
      metadata: {
        projectOutput: projectOutput as unknown as Record<string, unknown>,
        serverGuardrailResult: serverGuardrailResult as unknown as Record<string, unknown>,
        serverCapabilityResult: serverCapabilityResult as unknown as Record<string, unknown>,
        userMessage: rawUserMessage,
        conversationHistory: historyForSynth as unknown as Record<string, unknown>[],
      },
    });

    const completedTurn: CompletedConversationTurn = {
      ...completedTurnBase,
      assistantMessageId: responseMsg.messageId,
    };

    return {
      phase: "completed",
      activeTurn: null,
      currentFrame: null,
      guardrailResult: null,
      capabilityResult: null,
      activeApprovalGateId: null,
      error: null,
      appendMessages: [responseMsg],
      appendCompletedTurns: [completedTurn],
    };
  } catch (err) {
    // Fallback: never leave the user without a response
    const fallbackMsg: ConversationMessage = {
      messageId: randomUUID(),
      role: "assistant",
      content:
        "I encountered an unexpected error processing your request. Please try again.",
      createdAt: now,
    };

    return {
      phase: "completed",
      activeTurn: null,
      currentFrame: null,
      guardrailResult: null,
      capabilityResult: null,
      appendMessages: [fallbackMsg],
    };
  }
};

// ---------------------------------------------------------------------------
// handle-error
// ---------------------------------------------------------------------------

export const handleErrorNode: OrchestrationNodeFn = async (state, _context) => {
  if (!state.error || state.error.recoverable) {
    return { phase: "generating-response" };
  }
  return { phase: "terminated" };
};

// ---------------------------------------------------------------------------
// terminate
// ---------------------------------------------------------------------------

export const terminateNode: OrchestrationNodeFn = async (_state, _context) => {
  return { phase: "terminated" };
};
