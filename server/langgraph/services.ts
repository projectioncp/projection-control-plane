/**
 * Orchestrator — LangGraph Service Implementations
 *
 * Bridge layer between the server-side pipeline functions (projector, guardrail,
 * dispatcher, synthesizer) and the canonical service interfaces defined in
 * src/langgraph/nodes.ts.
 *
 * These implementations adapt the simplified server types to the canonical
 * src/ types expected by the OrchestrationNodeFn contract.
 */

import { randomUUID } from "crypto";
import type {
  FrameProjector,
  ProjectionInput,
  ProjectionResult,
  GuardrailEvaluator,
  GuardrailEvaluationInput,
  CapabilityDispatcher,
  DispatchInput,
  ApprovalGateway,
  ApprovalGateRequest,
  ApprovalDecision,
  ResponseSynthesizer,
  ResponseSynthesisInput,
  OrchestrationAuditEmitter,
  OrchestrationHookExecutor,
  OrchestrationHookContext,
} from "../../src/langgraph/nodes.js";
import type {
  ApprovalGateState,
  ConversationMessage,
  OrchestrationServices,
} from "../../src/langgraph/types.js";
import type { DecisionFrame, CapabilityRef, CapabilityCategory } from "../../src/projection/frame.js";
import type { ExecutionRequest as CanonicalExecutionRequest } from "../../src/types.js";
import type {
  GuardrailResult as CanonicalGuardrailResult,
  GuardrailFlag,
  StageResult,
  StageVerdict,
} from "../../src/guardrail/types.js";
import type { CapabilityExecutionResult } from "../../src/capabilities/execution.js";
import type { HookExecutionResult, HookStage } from "../../src/hooks/types.js";
import { project as serverProject } from "../projector.js";
import { evaluate as serverEvaluate } from "../guardrail.js";
import { dispatch as serverDispatch } from "../dispatcher.js";
import { synthesize as serverSynthesize } from "../synthesizer.js";
import type {
  ProjectorOutput,
  GuardrailResult as ServerGuardrailResult,
  CapabilityResult as ServerCapabilityResult,
} from "../types.js";

// ---------------------------------------------------------------------------
// Type mapping helpers
// ---------------------------------------------------------------------------

function mapStageName(
  serverName: string,
): "authorization" | "policy" | "constraints" | "approval" {
  switch (serverName) {
    case "authorization":
    case "operational-scope":
      return "authorization";
    case "export-control":
    case "supplier-access":
      return "policy";
    case "operational-threshold":
      return "approval";
    default:
      return "policy";
  }
}

export function buildDecisionFrame(
  output: ProjectorOutput,
  principalId: string,
  sessionId: string,
): DecisionFrame {
  const now = new Date().toISOString();
  const frameId = randomUUID();

  const authorizedCapabilities: CapabilityRef[] = output.authorizedCapabilities.map((cap) => ({
    capabilityId: cap.id,
    name: cap.name,
    version: "1.0.0",
    category: (cap.category ?? "operational") as CapabilityCategory,
    requiredEntitlements: [],
    requiresApproval: output.requiresApproval,
    rollbackSupported: false,
  }));

  return {
    frameId,
    createdAt: now,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    userIntent: {
      raw: output.operationalContext.map((c) => `${c.label}: ${c.value}`).join("; "),
      normalized: output.intent.rawIntent,
      interpretationConfidence: output.intent.confidence,
    },
    projectedContext: {
      sessionId,
      principalId,
      entitlements: [],
      operationalState: Object.fromEntries(
        output.operationalContext.map((c) => [c.label, c.value]),
      ),
    },
    authorizedCapabilities,
    executionConstraints: {
      allowedCapabilityIds: output.authorizedCapabilities.map((c) => c.id),
      maxExecutions: 1,
      frameTtlMs: 5 * 60 * 1000,
      allowCascade: false,
      policyConstraints: output.constraints.map((c, i) => ({
        constraintId: `c-${i}`,
        description: `${c.field} ${c.operator} ${String(c.value)}`,
        field: c.field,
        operator: c.operator as "eq" | "neq" | "gt" | "lt" | "gte" | "lte" | "in" | "not-in" | "contains" | "regex",
        value: c.value,
      })),
    },
    approvalRequirements:
      output.requiresApproval && output.approvalReason
        ? [
            {
              requirementId: "req-1",
              reason: output.approvalReason,
              approverRole: "plant-operations-director",
              timeoutMs: 24 * 60 * 60 * 1000,
              denyOnTimeout: true,
            },
          ]
        : [],
    retrievalContext: { results: [], retrievedAt: now },
    telemetryReferences: [],
    auditMetadata: {
      triggerSource: "user-request",
      projectionVersion: "1.0.0",
      policySetVersion: "1.0.0",
      tags: [],
    },
    // Store server-side output in metadata for use by downstream nodes
    metadata: {
      category: output.intent.category,
      summary: output.intent.summary,
      projectOutput: output as unknown as Record<string, unknown>,
    },
  };
}

export function buildExecutionRequest(
  output: ProjectorOutput,
  frameId: string,
  principalId: string,
  sessionId: string,
): CanonicalExecutionRequest {
  const primary = output.authorizedCapabilities[0];

  return {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    capabilityId: primary?.id ?? "cap-generate-report",
    input: Object.fromEntries(output.operationalContext.map((c) => [c.label, c.value])),
    decisionFrameId: frameId,
    sessionId,
    principalId,
    confidence: output.intent.confidence,
    rationale: output.intent.summary,
    status: "pending",
    metadata: {},
  };
}

export function buildCanonicalGuardrailResult(
  serverResult: ServerGuardrailResult,
  requestId: string,
): CanonicalGuardrailResult & { _serverResult: ServerGuardrailResult } {
  const stageResults: StageResult[] = serverResult.stagesEvaluated.map((stage) => {
    let verdict: StageVerdict;
    if (!stage.passed) {
      if (serverResult.decision === "require-approval") {
        verdict = {
          outcome: "require-approval",
          requirementIds: ["req-1"],
          reason: stage.detail ?? "Approval required",
        };
      } else {
        verdict = {
          outcome: "deny",
          code: "POLICY_DENY",
          reason: stage.detail ?? "Policy violation",
        };
      }
    } else {
      verdict = { outcome: "pass" };
    }

    return {
      stage: mapStageName(stage.name),
      verdict,
      auditRecords: [],
      durationMs: stage.durationMs,
    };
  });

  const flags: GuardrailFlag[] = serverResult.flags.map((f) => ({
    stage: "approval",
    reason: f.reason,
  }));

  return {
    decision: serverResult.decision,
    executionRequestId: requestId,
    stageResults,
    auditRecords: [],
    flags,
    evaluatedAt: new Date().toISOString(),
    totalDurationMs: serverResult.totalDurationMs,
    ...(serverResult.decision === "deny"
      ? { denyCode: "POLICY_DENY" as const, denyReason: serverResult.governanceSummary }
      : {}),
    ...(serverResult.decision === "require-approval"
      ? { approvalRequirementIds: ["req-1"] }
      : {}),
    // Non-standard field for downstream use — stored at runtime only
    _serverResult: serverResult,
  };
}

export function buildCapabilityExecutionResult(
  serverResult: ServerCapabilityResult,
  requestId: string,
): CapabilityExecutionResult {
  return {
    requestId,
    capabilityId: serverResult.capabilityId,
    status: serverResult.status as "success" | "failure" | "partial" | "timeout" | "denied" | "retrying",
    ...(serverResult.output ? { output: serverResult.output as Record<string, unknown> } : {}),
    attemptNumber: 1,
    executionDurationMs: serverResult.durationMs,
    completedAt: new Date().toISOString(),
    // Store server result for synthesizer use
    metadata: { serverResult: serverResult as unknown as Record<string, unknown> },
  };
}

// ---------------------------------------------------------------------------
// ServerFrameProjector
// ---------------------------------------------------------------------------

export class ServerFrameProjector implements FrameProjector {
  async project(input: ProjectionInput): Promise<ProjectionResult> {
    const history = input.conversationHistory
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: typeof m.content === "string" ? m.content : "",
      }));

    const output = await serverProject(input.rawIntent, history);

    const frame = buildDecisionFrame(output, input.principalId, input.sessionId);
    const executionRequest = buildExecutionRequest(
      output,
      frame.frameId,
      input.principalId,
      input.sessionId,
    );

    return {
      outcome: "frame-built",
      frame,
      executionRequest,
    };
  }
}

// ---------------------------------------------------------------------------
// ServerGuardrailEvaluator
// ---------------------------------------------------------------------------

export class ServerGuardrailEvaluator implements GuardrailEvaluator {
  async evaluate(input: GuardrailEvaluationInput): Promise<CanonicalGuardrailResult> {
    const projectOutput = input.frame.metadata?.["projectOutput"] as ProjectorOutput | undefined;
    if (!projectOutput) {
      throw new Error("Frame metadata missing projectOutput — cannot evaluate guardrail");
    }

    const userMessage = input.frame.userIntent.raw ?? "";
    const principalId = input.frame.projectedContext.principalId;

    const serverResult = serverEvaluate(principalId, projectOutput, userMessage);
    return buildCanonicalGuardrailResult(serverResult, input.request.id);
  }
}

// ---------------------------------------------------------------------------
// ServerCapabilityDispatcher
// ---------------------------------------------------------------------------

export class ServerCapabilityDispatcher implements CapabilityDispatcher {
  async dispatch(input: DispatchInput): Promise<CapabilityExecutionResult> {
    const projectOutput = input.frame.metadata?.["projectOutput"] as ProjectorOutput | undefined;
    if (!projectOutput) {
      throw new Error("Frame metadata missing projectOutput — cannot dispatch capability");
    }

    const serverResult = serverDispatch(projectOutput);
    return buildCapabilityExecutionResult(serverResult, input.request.id);
  }
}

// ---------------------------------------------------------------------------
// ServerResponseSynthesizer
// ---------------------------------------------------------------------------

export class ServerResponseSynthesizer implements ResponseSynthesizer {
  async generate(input: ResponseSynthesisInput): Promise<ConversationMessage> {
    const projectOutput = input.metadata?.["projectOutput"] as ProjectorOutput | undefined;
    const userMessage = input.metadata?.["userMessage"] as string | undefined ?? "";
    const serverGuardrailResult = input.metadata?.["serverGuardrailResult"] as ServerGuardrailResult | undefined;
    const serverCapabilityResult = input.metadata?.["serverCapabilityResult"] as ServerCapabilityResult | undefined;

    let responseText: string;

    if (projectOutput && serverGuardrailResult && serverCapabilityResult) {
      const history = input.messages
        .slice(0, -1) // exclude the current user message
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: typeof m.content === "string" ? m.content : "",
        }));

      responseText = await serverSynthesize(
        userMessage,
        projectOutput,
        serverGuardrailResult,
        serverCapabilityResult,
        history,
      );
    } else if (input.error) {
      responseText =
        "I encountered an issue processing your request. Please rephrase and try again.";
    } else {
      responseText = "I was unable to generate a response for this request.";
    }

    return {
      messageId: randomUUID(),
      role: "assistant",
      content: responseText,
      createdAt: new Date().toISOString(),
    };
  }

  stream(): never {
    throw new Error("Streaming not yet implemented");
  }
}

// ---------------------------------------------------------------------------
// NoopApprovalGateway — stub for approval workflow
// ---------------------------------------------------------------------------

export class NoopApprovalGateway implements ApprovalGateway {
  async openGate(request: ApprovalGateRequest): Promise<ApprovalGateState> {
    const now = new Date().toISOString();
    return {
      gateId: `gate-${randomUUID().slice(0, 8)}`,
      turnId: request.resumeThreadId,
      executionRequestId: request.executionRequest.id,
      capabilityId: request.capabilityId,
      requirementIds: request.requirementIds,
      approverRole: request.approverRole,
      openedAt: now,
      timeoutAt: new Date(Date.now() + request.timeoutMs).toISOString(),
      status: "open",
    };
  }

  async getGate(gateId: string): Promise<ApprovalGateState> {
    throw new Error(`Gate ${gateId} not found — NoopApprovalGateway has no persistence`);
  }

  async resolveGate(_decision: ApprovalDecision): Promise<ApprovalGateState> {
    throw new Error("NoopApprovalGateway does not support gate resolution");
  }
}

// ---------------------------------------------------------------------------
// ConsoleAuditEmitter
// ---------------------------------------------------------------------------

export class ConsoleAuditEmitter implements OrchestrationAuditEmitter {
  async emit(record: unknown): Promise<void> {
    console.log("[audit]", JSON.stringify(record));
  }

  async emitBatch(records: unknown[]): Promise<void> {
    for (const record of records) {
      console.log("[audit]", JSON.stringify(record));
    }
  }
}

// ---------------------------------------------------------------------------
// NoopHookExecutor
// ---------------------------------------------------------------------------

export class NoopHookExecutor implements OrchestrationHookExecutor {
  async run(stage: HookStage, _context: OrchestrationHookContext): Promise<HookExecutionResult> {
    return {
      stage,
      hookResults: [],
      terminalOutcome: "continue",
      executedAt: new Date().toISOString(),
      durationMs: 0,
    };
  }
}

// ---------------------------------------------------------------------------
// createServices — wire all services together
// ---------------------------------------------------------------------------

export function createServices(): OrchestrationServices {
  return {
    projector: new ServerFrameProjector(),
    guardrail: new ServerGuardrailEvaluator(),
    dispatcher: new ServerCapabilityDispatcher(),
    approval: new NoopApprovalGateway(),
    synthesizer: new ServerResponseSynthesizer(),
    auditEmitter: new ConsoleAuditEmitter() as any,
    hookExecutor: new NoopHookExecutor(),
  };
}
