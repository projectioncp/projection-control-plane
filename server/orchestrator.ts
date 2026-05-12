/**
 * Orchestrator — Execution Pipeline
 *
 * Assembles the full governed execution pipeline:
 *
 *   1. Frame Projection   — Gemma interprets the request → structured Decision Frame
 *   2. Guardrail          — Rule-based policy evaluation → allow / deny / require-approval
 *   3. Capability Dispatch — Execute authorized capabilities (or block if denied)
 *   4. Response Synthesis — Gemma generates a natural-language operational response
 *   5. Audit Assembly     — Build the full ExecutionTrace for dashboard consumption
 *
 * The orchestrator is the single entry point for the runtime. It returns an
 * ExecutionTrace that mirrors the MockExecutionScenario shape so the dashboard
 * can consume it without modification.
 */

import { randomUUID } from "crypto";
import { project } from "./projector";
import { evaluate } from "./guardrail";
import { dispatch } from "./dispatcher";
import { synthesize } from "./synthesizer";
import type {
  ExecutionRequest,
  ExecutionTrace,
  ProjectedFrame,
  AuditEvent,
  CapabilityResult,
} from "./types";

// ---------------------------------------------------------------------------
// In-memory trace store (MVP — use Redis or a DB in production)
// ---------------------------------------------------------------------------

const traceStore = new Map<string, ExecutionTrace>();

export function getTrace(id: string): ExecutionTrace | undefined {
  return traceStore.get(id);
}

// ---------------------------------------------------------------------------
// Conversation history store — enables multi-turn context
// ---------------------------------------------------------------------------

type HistoryEntry = { role: "user" | "assistant"; content: string };
const conversationHistoryStore = new Map<string, HistoryEntry[]>();

function getHistory(conversationId: string): HistoryEntry[] {
  return conversationHistoryStore.get(conversationId) ?? [];
}

function appendHistory(conversationId: string, entries: HistoryEntry[]): void {
  const existing = conversationHistoryStore.get(conversationId) ?? [];
  conversationHistoryStore.set(conversationId, [...existing, ...entries]);
}

// ---------------------------------------------------------------------------
// Audit event factory
// ---------------------------------------------------------------------------

function makeAuditEvent(
  type: string,
  outcome: string,
  actor: string,
  detail: string,
  durationMs?: number,
): AuditEvent {
  return {
    eventId: `evt-${randomUUID().slice(0, 8)}`,
    type,
    outcome,
    timestamp: new Date().toISOString(),
    ...(durationMs !== undefined ? { durationMs } : {}),
    actor,
    detail,
    spanId: `span-${randomUUID().slice(0, 8)}`,
  };
}

// ---------------------------------------------------------------------------
// Map ProjectorOutput → ProjectedFrame (adds frameId, durationMs, etc.)
// ---------------------------------------------------------------------------

function buildProjectedFrame(
  raw: Awaited<ReturnType<typeof project>>,
  durationMs: number,
): ProjectedFrame {
  return {
    frameId: `frame-${randomUUID().slice(0, 8)}`,
    intent: raw.intent,
    operationalContext: raw.operationalContext,
    authorizedCapabilities: raw.authorizedCapabilities,
    constraints: raw.constraints,
    approvalRequirements: raw.requiresApproval
      ? [
          {
            id: `apr-${randomUUID().slice(0, 8)}`,
            trigger: "operational-threshold",
            approverRole: "plant-operations-director",
            reason: raw.approvalReason ?? "Write operation requires explicit authorization",
          },
        ]
      : [],
    durationMs,
  };
}

// ---------------------------------------------------------------------------
// Derive overall pipeline status from guardrail + capability
// ---------------------------------------------------------------------------

function deriveStatus(
  guardrailDecision: string,
  capabilityStatus: string,
): ExecutionTrace["overallStatus"] {
  if (guardrailDecision === "deny") return "denied";
  if (guardrailDecision === "require-approval") return "awaiting-approval";
  if (capabilityStatus === "failed") return "failed";
  if (capabilityStatus === "awaiting-approval") return "awaiting-approval";
  return "completed";
}

// ---------------------------------------------------------------------------
// execute() — the public interface
// ---------------------------------------------------------------------------

export async function execute(req: ExecutionRequest): Promise<ExecutionTrace> {
  const traceId   = `trace-${randomUUID().slice(0, 8)}`;
  const requestId = `req-${randomUUID().slice(0, 8)}`;
  const sessionId = req.sessionId   ?? `sess-${randomUUID().slice(0, 8)}`;
  const convId    = req.conversationId ?? `conv-${randomUUID().slice(0, 8)}`;
  const pipelineStart = Date.now();

  const auditEvents: AuditEvent[] = [];

  auditEvents.push(
    makeAuditEvent(
      "request-received",
      "success",
      req.principalId,
      `Operational request received from ${req.principalId}`,
    ),
  );

  // -------------------------------------------------------------------------
  // Stage 1: Frame Projection
  // -------------------------------------------------------------------------

  const history = getHistory(convId);

  const projectionStart = Date.now();
  let frame: Awaited<ReturnType<typeof project>>;

  try {
    frame = await project(req.userMessage, history);
  } catch (err) {
    console.error("[orchestrator] Projection failed:", err);
    throw new Error("Frame projection failed — unable to process request");
  }

  const projectionDurationMs = Date.now() - projectionStart;
  const projectedFrame = buildProjectedFrame(frame, projectionDurationMs);

  auditEvents.push(
    makeAuditEvent(
      "frame-projected",
      "success",
      "projection-engine",
      `Decision frame built: ${frame.intent.summary} (confidence ${frame.intent.confidence})`,
      projectionDurationMs,
    ),
  );

  // -------------------------------------------------------------------------
  // Stage 2: Guardrail Evaluation
  // -------------------------------------------------------------------------

  const guardrailStart = Date.now();
  const guardrailResult = evaluate(req.principalId, frame, req.userMessage);
  const guardrailDurationMs = Date.now() - guardrailStart;

  auditEvents.push(
    makeAuditEvent(
      "guardrail-evaluated",
      guardrailResult.decision === "allow" ? "success" : guardrailResult.decision,
      "guardrail-engine",
      guardrailResult.governanceSummary,
      guardrailDurationMs,
    ),
  );

  if (guardrailResult.violations.length > 0) {
    for (const v of guardrailResult.violations) {
      auditEvents.push(
        makeAuditEvent(
          "policy-violation",
          "blocked",
          "guardrail-engine",
          `Policy ${v.policy}: ${v.message}`,
        ),
      );
    }
  }

  // -------------------------------------------------------------------------
  // Stage 3: Capability Dispatch
  // -------------------------------------------------------------------------

  let capabilityResult: CapabilityResult;

  if (guardrailResult.decision === "deny") {
    // Guardrail blocked — no capability execution
    const primary = frame.authorizedCapabilities[0];
    capabilityResult = {
      capabilityId: primary?.id ?? "cap-none",
      capabilityName: primary?.name ?? "none",
      category: primary?.category ?? "unknown",
      status: "denied",
      durationMs: 0,
      output: { reason: "Blocked by guardrail policy" },
    };

    auditEvents.push(
      makeAuditEvent(
        "capability-blocked",
        "denied",
        "guardrail-engine",
        `Capability execution blocked — ${guardrailResult.governanceSummary}`,
        0,
      ),
    );
  } else {
    const dispatchStart = Date.now();
    capabilityResult = dispatch(frame);

    auditEvents.push(
      makeAuditEvent(
        "capability-executed",
        capabilityResult.status,
        "capability-dispatcher",
        capabilityResult.status === "awaiting-approval"
          ? `${capabilityResult.capabilityName} submitted for approval — gate ${capabilityResult.approvalGateId ?? "unknown"}`
          : `${capabilityResult.capabilityName} executed — status: ${capabilityResult.status}`,
        Date.now() - dispatchStart,
      ),
    );
  }

  // -------------------------------------------------------------------------
  // Stage 4: Response Synthesis
  // -------------------------------------------------------------------------

  const synthesisStart = Date.now();
  const synthesizedResponse = await synthesize(
    req.userMessage,
    frame,
    guardrailResult,
    capabilityResult,
    history,
  );
  const synthesisDurationMs = Date.now() - synthesisStart;

  auditEvents.push(
    makeAuditEvent(
      "response-synthesized",
      "success",
      "synthesis-engine",
      "Natural-language operational response generated",
      synthesisDurationMs,
    ),
  );

  // -------------------------------------------------------------------------
  // Assemble ExecutionTrace
  // -------------------------------------------------------------------------

  const totalDurationMs = Date.now() - pipelineStart;
  const overallStatus = deriveStatus(guardrailResult.decision, capabilityResult.status);

  const trace: ExecutionTrace = {
    id: traceId,
    label: frame.intent.rawIntent ?? frame.intent.summary.slice(0, 40),
    description: frame.intent.summary,
    overallStatus,
    totalDurationMs,
    request: {
      id: requestId,
      principalId: req.principalId,
      sessionId,
      conversationId: convId,
      userMessage: req.userMessage,
      timestamp: new Date().toISOString(),
      model: process.env["PROJECTION_MODEL"] ?? "gemma3:4b",
    },
    projectionFrame: projectedFrame,
    guardrailResult,
    capabilityResult,
    auditEvents,
    synthesizedResponse,
  };

  // Persist to in-memory stores
  traceStore.set(traceId, trace);
  appendHistory(convId, [
    { role: "user",      content: req.userMessage },
    { role: "assistant", content: synthesizedResponse },
  ]);

  return trace;
}
