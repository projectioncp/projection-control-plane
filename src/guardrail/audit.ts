/**
 * Guardrail — Audit Record Factory
 *
 * Every governance event that occurs during pipeline evaluation is recorded
 * as an AuditRecord. This module provides typed factory functions for each
 * event type so that the stage implementations stay focused on logic rather
 * than record construction.
 *
 * Design constraints:
 * - Records are constructed with `checksum: undefined` initially, then the
 *   checksum is computed from the canonical serialisation. This prevents
 *   any field from being mutated after creation.
 * - IDs are generated with `crypto.randomUUID()` (Node 20 built-in).
 * - Timestamps default to the moment of record creation (`new Date()`).
 *   Callers may pass an explicit timestamp for determinism in tests.
 */

import { createHash, randomUUID } from "node:crypto";
import type {
  AuditRecord,
  AuditEventType,
  AuditOutcome,
  ExecutionRequest,
  GuardrailPolicy,
  Metadata,
} from "../types.js";
import type { DecisionFrame } from "../projection/schema.js";
import type {
  GuardrailDenyCode,
  GuardrailFlag,
  GuardrailResult,
  StageName,
} from "./types.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Canonical JSON representation used for checksum computation. */
function canonicalize(record: Omit<AuditRecord, "checksum">): string {
  // Sort keys for deterministic serialisation.
  return JSON.stringify(record, Object.keys(record).sort());
}

/** Compute a SHA-256 checksum over the record (excluding the checksum field). */
function computeChecksum(record: Omit<AuditRecord, "checksum">): string {
  return createHash("sha256").update(canonicalize(record)).digest("hex");
}

/**
 * Build a sealed AuditRecord from partial input.
 * Generates a new ID, fills in defaults, and appends the checksum.
 */
function buildRecord(
  partial: {
    timestamp?: string;
    eventType: AuditEventType;
    outcome: AuditOutcome;
    executionRequestId?: string;
    decisionFrameId?: string;
    capabilityId?: string;
    policyId?: string;
    hookId?: string;
    principalId: string;
    sessionId: string;
    details: Metadata;
    metadata?: Metadata;
  }
): AuditRecord {
  const id = randomUUID();
  const timestamp = partial.timestamp ?? new Date().toISOString();

  const core: Omit<AuditRecord, "checksum"> = {
    id,
    timestamp,
    eventType: partial.eventType,
    outcome: partial.outcome,
    principalId: partial.principalId,
    sessionId: partial.sessionId,
    details: partial.details,
    metadata: partial.metadata ?? {},
    ...(partial.executionRequestId !== undefined && {
      executionRequestId: partial.executionRequestId,
    }),
    ...(partial.decisionFrameId !== undefined && {
      decisionFrameId: partial.decisionFrameId,
    }),
    ...(partial.capabilityId !== undefined && {
      capabilityId: partial.capabilityId,
    }),
    ...(partial.policyId !== undefined && { policyId: partial.policyId }),
    ...(partial.hookId !== undefined && { hookId: partial.hookId }),
  };

  return { ...core, checksum: computeChecksum(core) };
}

// ---------------------------------------------------------------------------
// Shared context extractor
// ---------------------------------------------------------------------------

/** Pull the common cross-reference fields from a request + frame pair. */
function ctx(request: ExecutionRequest, frame: DecisionFrame) {
  return {
    executionRequestId: request.id,
    decisionFrameId: frame.id,
    capabilityId: request.capabilityId,
    principalId: request.principalId,
    sessionId: request.sessionId,
  };
}

// ---------------------------------------------------------------------------
// Factory functions — one per AuditEventType used by the guardrail layer
// ---------------------------------------------------------------------------

/**
 * Emitted at the end of every pipeline run.
 * Records the final decision, all stage outcomes, and timing.
 */
export function createGuardrailEvaluatedRecord(
  request: ExecutionRequest,
  frame: DecisionFrame,
  result: GuardrailResult
): AuditRecord {
  const outcomeMap: Record<GuardrailResult["decision"], AuditOutcome> = {
    allow: "success",
    deny: "denied",
    "require-approval": "pending",
    flag: "success",
  };

  return buildRecord({
    timestamp: result.evaluatedAt,
    eventType: "guardrail-evaluated",
    outcome: outcomeMap[result.decision],
    ...ctx(request, frame),
    details: {
      decision: result.decision,
      denyCode: result.denyCode,
      denyReason: result.denyReason,
      approvalRequirementIds: result.approvalRequirementIds,
      flags: result.flags,
      stagesRun: result.stageResults.map((s) => s.stage),
      totalDurationMs: result.totalDurationMs,
    },
  });
}

/**
 * Emitted when a GuardrailPolicy fires its action (deny, flag, require-approval).
 * Also emitted for confidence threshold violations within a policy.
 */
export function createPolicyViolationRecord(
  request: ExecutionRequest,
  frame: DecisionFrame,
  policy: GuardrailPolicy,
  reason: string,
  outcome: AuditOutcome = "denied"
): AuditRecord {
  return buildRecord({
    eventType: "policy-violation",
    outcome,
    ...ctx(request, frame),
    policyId: policy.id,
    details: {
      policyName: policy.name,
      policyAction: policy.action,
      policyPriority: policy.priority,
      reason,
      requestConfidence: request.confidence,
      confidenceThreshold: policy.confidenceThreshold,
    },
  });
}

/**
 * Emitted when an approval workflow is triggered.
 * Includes the full approval requirement objects so the approval service
 * has all the information it needs without a secondary lookup.
 */
export function createApprovalRequestedRecord(
  request: ExecutionRequest,
  frame: DecisionFrame,
  requirementIds: string[],
  reason: string,
  policyId?: string
): AuditRecord {
  const requirements = frame.approvalRequirements.filter((r) =>
    requirementIds.includes(r.requirementId)
  );

  return buildRecord({
    eventType: "approval-requested",
    outcome: "pending",
    ...ctx(request, frame),
    ...(policyId !== undefined ? { policyId } : {}),
    details: {
      requirementIds,
      reason,
      requirements,
    },
  });
}

/**
 * Emitted when the request is denied due to an authorization failure.
 * Covers: frame expiry, principal mismatch, capability scope, and entitlements.
 */
export function createAuthorizationDeniedRecord(
  request: ExecutionRequest,
  frame: DecisionFrame,
  denyCode: GuardrailDenyCode,
  reason: string,
  extra: Metadata = {}
): AuditRecord {
  return buildRecord({
    eventType: "entitlement-denied",
    outcome: "denied",
    ...ctx(request, frame),
    details: {
      denyCode,
      reason,
      ...extra,
    },
  });
}

/**
 * Emitted when a frame-level PolicyConstraint is violated.
 */
export function createConstraintViolationRecord(
  request: ExecutionRequest,
  frame: DecisionFrame,
  constraintId: string,
  constraintDescription: string,
  reason: string,
  stage: StageName
): AuditRecord {
  return buildRecord({
    eventType: "policy-violation",
    outcome: "denied",
    ...ctx(request, frame),
    details: {
      denyCode: "FRAME_CONSTRAINT_VIOLATION",
      constraintId,
      constraintDescription,
      reason,
      stage,
    },
  });
}
