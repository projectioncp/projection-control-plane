/**
 * Orchestrator — Shared Types
 *
 * These mirror the ExecutionScenario shape from src/lib/mock/execution.ts
 * so the dashboard can consume live traces without modification once
 * src/lib/runtime/client.ts is wired to the real endpoints.
 */

export type GuardrailDecision = "allow" | "deny" | "require-approval" | "flag";
export type CapabilityStatus  = "success" | "failed" | "denied" | "awaiting-approval" | "pending";
export type PipelineStatus    = "completed" | "denied" | "awaiting-approval" | "failed" | "pending";

// ---------------------------------------------------------------------------
// Inbound request
// ---------------------------------------------------------------------------

export interface ExecutionRequest {
  principalId: string;
  userMessage: string;
  sessionId?: string;
  conversationId?: string;
}

// ---------------------------------------------------------------------------
// Projection Frame
// ---------------------------------------------------------------------------

export interface ProjectedCapability {
  id: string;
  name: string;
  category: string;
}

export interface FrameConstraint {
  field: string;
  operator: string;
  value: string | number | boolean;
}

export interface FrameContextItem {
  label: string;
  value: string;
}

export interface ApprovalRequirement {
  id: string;
  trigger: string;
  approverRole: string;
  reason: string;
}

export interface ProjectedFrame {
  frameId: string;
  intent: {
    category: string;
    summary: string;
    confidence: number;
    rawIntent: string;
  };
  operationalContext: FrameContextItem[];
  authorizedCapabilities: ProjectedCapability[];
  constraints: FrameConstraint[];
  approvalRequirements: ApprovalRequirement[];
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Guardrail result
// ---------------------------------------------------------------------------

export interface GuardrailStage {
  name: string;
  label: string;
  durationMs: number;
  passed: boolean;
  detail?: string;
}

export interface GuardrailResult {
  decision: GuardrailDecision;
  stagesEvaluated: GuardrailStage[];
  violations: Array<{ policy: string; severity: string; message: string }>;
  flags: Array<{ reason: string; reviewQueue: string }>;
  totalDurationMs: number;
  governanceSummary: string;
}

// ---------------------------------------------------------------------------
// Capability result
// ---------------------------------------------------------------------------

export interface CapabilityResult {
  capabilityId: string;
  capabilityName: string;
  category: string;
  status: CapabilityStatus;
  durationMs: number;
  output?: Record<string, string | number | boolean>;
  approvalGateId?: string;
  approvalStatus?: string;
}

// ---------------------------------------------------------------------------
// Audit event
// ---------------------------------------------------------------------------

export interface AuditEvent {
  eventId: string;
  type: string;
  outcome: string;
  timestamp: string;
  durationMs?: number;
  actor: string;
  detail: string;
  spanId: string;
}

// ---------------------------------------------------------------------------
// Full execution trace (returned by the server, consumed by the dashboard)
// ---------------------------------------------------------------------------

export interface ExecutionTrace {
  id: string;
  label: string;
  description: string;
  overallStatus: PipelineStatus;
  totalDurationMs: number;
  request: {
    id: string;
    principalId: string;
    sessionId: string;
    conversationId: string;
    userMessage: string;
    timestamp: string;
    model: string;
  };
  projectionFrame: ProjectedFrame;
  guardrailResult: GuardrailResult;
  capabilityResult: CapabilityResult;
  auditEvents: AuditEvent[];
  synthesizedResponse: string;
}

// ---------------------------------------------------------------------------
// Projector raw output (from Gemma JSON)
// ---------------------------------------------------------------------------

export interface ProjectorOutput {
  intent: {
    category: string;
    summary: string;
    confidence: number;
    rawIntent: string;
  };
  authorizedCapabilities: ProjectedCapability[];
  constraints: FrameConstraint[];
  operationalContext: FrameContextItem[];
  requiresApproval: boolean;
  approvalReason: string | null;
}
