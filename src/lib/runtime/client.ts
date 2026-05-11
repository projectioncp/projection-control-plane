/**
 * Projection Control Plane — Runtime Client (Placeholder)
 *
 * This module is the integration point between the UI layer and the PCP
 * runtime. When the backend is wired, replace the mock return values with
 * real HTTP/SSE/WebSocket calls to the LangGraph-backed runtime.
 *
 * Integration path:
 *   1. Compile the library:          npm run build:lib
 *   2. Stand up the runtime server:  (to be implemented)
 *   3. Replace submitRequest/getExecutionTrace with real API calls.
 *   4. Wire streamEvents to the server-sent-events endpoint.
 *
 * The runtime server will:
 *   - Accept OrchestrationStartInput (see src/langgraph/types.ts)
 *   - Invoke the compiled LangGraph graph via LangGraphOrchestrationAdapter
 *   - Stream OrchestrationStreamEvents back to this client
 *   - Expose a resumeApproval endpoint for approval gate resolution
 */

import type { ExecutionScenario } from "../mock/execution";
import { MOCK_SCENARIOS } from "../mock/execution";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface RuntimeClientConfig {
  /** Base URL of the PCP runtime server. */
  baseUrl: string;
  /** API key for authenticating with the runtime. */
  apiKey?: string;
  /** Request timeout in milliseconds. Default: 30_000. */
  timeoutMs?: number;
}

export const DEFAULT_CONFIG: RuntimeClientConfig = {
  baseUrl: process.env["NEXT_PUBLIC_RUNTIME_URL"] ?? "http://localhost:3001",
  timeoutMs: 30_000,
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
 *
 * TODO: Replace with POST /api/execute when the runtime server is running.
 * Returns a mock execution ID for now.
 */
export async function submitRequest(
  _payload: SubmitRequestPayload,
  _config: RuntimeClientConfig = DEFAULT_CONFIG,
): Promise<string> {
  // Simulate network latency
  await new Promise((resolve) => setTimeout(resolve, 150));
  return `exec-${Math.random().toString(36).slice(2, 10)}`;
}

// ---------------------------------------------------------------------------
// Execution trace retrieval
// ---------------------------------------------------------------------------

/**
 * Retrieve the execution trace for a completed or in-progress execution.
 *
 * TODO: Replace with GET /api/execute/:id when the runtime server is running.
 * Returns mock scenario data for demo purposes.
 */
export async function getExecutionTrace(
  executionId: string,
  _config: RuntimeClientConfig = DEFAULT_CONFIG,
): Promise<ExecutionScenario | null> {
  await new Promise((resolve) => setTimeout(resolve, 80));

  // Match mock scenario by ID prefix, or return the first scenario as default
  const matched = MOCK_SCENARIOS.find((s) =>
    s.id.startsWith(executionId.slice(0, 8)),
  );
  return matched ?? (MOCK_SCENARIOS[0] ?? null);
}

// ---------------------------------------------------------------------------
// Approval gate resolution
// ---------------------------------------------------------------------------

export interface ApprovalResolutionPayload {
  gateId: string;
  outcome: "granted" | "denied";
  approverId: string;
  notes?: string;
}

/**
 * Resolve a pending approval gate.
 *
 * TODO: Replace with POST /api/approve/:gateId when the runtime server
 * is running. This triggers CompiledOrchestrationGraph.resumeApproval()
 * on the server, which resumes the suspended LangGraph thread.
 */
export async function resolveApprovalGate(
  _payload: ApprovalResolutionPayload,
  _config: RuntimeClientConfig = DEFAULT_CONFIG,
): Promise<{ resumed: boolean }> {
  await new Promise((resolve) => setTimeout(resolve, 120));
  return { resumed: true };
}

// ---------------------------------------------------------------------------
// Event streaming (SSE placeholder)
// ---------------------------------------------------------------------------

/**
 * Stream real-time orchestration events for an active execution.
 *
 * TODO: Replace with EventSource('/api/execute/:id/stream') when the
 * runtime server exposes an SSE endpoint for OrchestrationStreamEvents.
 *
 * The server-side stream yields:
 *   OrchestrationStreamEvent — see src/langgraph/types.ts
 * Event types: message-delta, node-started, node-completed, phase-changed,
 *              approval-required, execution-completed, error
 */
export function streamEvents(
  _executionId: string,
  _onEvent: (event: Record<string, unknown>) => void,
  _config: RuntimeClientConfig = DEFAULT_CONFIG,
): () => void {
  // TODO: return an EventSource and wire _onEvent to its message handler.
  // Return a no-op cleanup function until real streaming is implemented.
  return () => undefined;
}
