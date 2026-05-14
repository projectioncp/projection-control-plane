/**
 * Projection Control Plane — Runtime Client
 *
 * Wires the UI layer to the PCP Orchestrator (server/index.ts).
 *
 * submitRequest  → POST /api/execute  (returns full ExecutionTrace)
 * getExecutionTrace → GET /api/execute/:id
 * resolveApprovalGate → POST /api/approve/:gateId  (stubbed — not yet on server)
 * streamEvents → SSE /api/execute/:id/stream        (stubbed — not yet on server)
 */

import type { ExecutionScenario, MockAuditEvent } from "../mock/execution";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface RuntimeClientConfig {
  baseUrl: string;
  timeoutMs?: number;
}

export const DEFAULT_CONFIG: RuntimeClientConfig = {
  baseUrl: "",  // relative — requests go through Next.js API routes at /api/execute
  timeoutMs: 60_000,
};

// ---------------------------------------------------------------------------
// Request submission
// ---------------------------------------------------------------------------

export interface SubmitRequestPayload {
  principalId: string;
  sessionId: string;
  userMessage: string;
  metadata?: Record<string, unknown>;
}

/**
 * Submit a new user request to the PCP runtime.
 * POSTs to /api/execute and returns the trace ID from the full response.
 */
export async function submitRequest(
  payload: SubmitRequestPayload,
  config: RuntimeClientConfig = DEFAULT_CONFIG,
): Promise<string> {
  const res = await fetch(`${config.baseUrl}/api/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      principalId: payload.principalId,
      userMessage: payload.userMessage,
      sessionId: payload.sessionId,
    }),
    signal: AbortSignal.timeout(config.timeoutMs ?? 60_000),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`[runtime] POST /api/execute failed ${res.status}: ${body}`);
  }

  const trace = (await res.json()) as { id: string };
  return trace.id;
}

// ---------------------------------------------------------------------------
// Execution trace retrieval
// ---------------------------------------------------------------------------

/**
 * Retrieve the execution trace for a completed execution.
 * GETs /api/execute/:id and returns the trace shaped as ExecutionScenario.
 */
export async function getExecutionTrace(
  executionId: string,
  config: RuntimeClientConfig = DEFAULT_CONFIG,
): Promise<ExecutionScenario | null> {
  const res = await fetch(`${config.baseUrl}/api/execute/${executionId}`, {
    signal: AbortSignal.timeout(config.timeoutMs ?? 60_000),
  });

  if (res.status === 404) return null;

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`[runtime] GET /api/execute/${executionId} failed ${res.status}: ${body}`);
  }

  // ExecutionTrace (server) and ExecutionScenario (UI) are structurally identical
  return res.json() as Promise<ExecutionScenario>;
}

// ---------------------------------------------------------------------------
// Multi-turn chat
// ---------------------------------------------------------------------------

export interface ChatTurnPayload {
  principalId: string;
  userMessage: string;
  conversationId: string;
  sessionId?: string;
}

export interface ChatTurnResult {
  conversationId: string;
  response: string;
  phase: string;
  turnCount: number;
  auditEvents: MockAuditEvent[];
}

export async function sendChatMessage(
  payload: ChatTurnPayload,
  config: RuntimeClientConfig = DEFAULT_CONFIG,
): Promise<ChatTurnResult> {
  const res = await fetch(`${config.baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(config.timeoutMs ?? 60_000),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`[runtime] POST /api/chat failed ${res.status}: ${body}`);
  }

  return res.json() as Promise<ChatTurnResult>;
}

// ---------------------------------------------------------------------------
// Approval gate resolution (stubbed — server endpoint not yet implemented)
// ---------------------------------------------------------------------------

export interface ApprovalResolutionPayload {
  gateId: string;
  outcome: "granted" | "denied";
  approverId: string;
  notes?: string;
}

export async function resolveApprovalGate(
  _payload: ApprovalResolutionPayload,
  _config: RuntimeClientConfig = DEFAULT_CONFIG,
): Promise<{ resumed: boolean }> {
  // TODO: POST /api/approve/:gateId when the server exposes this endpoint
  return { resumed: true };
}

// ---------------------------------------------------------------------------
// Event streaming (stubbed — server SSE endpoint not yet implemented)
// ---------------------------------------------------------------------------

export function streamEvents(
  _executionId: string,
  _onEvent: (event: Record<string, unknown>) => void,
  _config: RuntimeClientConfig = DEFAULT_CONFIG,
): () => void {
  // TODO: wire to EventSource('/api/execute/:id/stream') when server exposes SSE
  return () => undefined;
}
