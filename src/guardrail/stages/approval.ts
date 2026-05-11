/**
 * Guardrail Stage 4 — Approval Routing
 *
 * Determines whether this execution request requires human or system approval
 * before the Capability may be invoked.
 *
 * Approval is required when ANY of the following is true:
 *   1. The Capability itself declares `requiresApproval: true`
 *   2. The frame contains one or more ApprovalRequirements
 *      (placed there by the Projection layer at frame-construction time)
 *
 * Both conditions are checked independently. When either triggers, the stage
 * returns a `require-approval` verdict with the full list of requirement IDs
 * that the approval service must clear before execution can proceed.
 *
 * If the capability requires approval but the frame has no ApprovalRequirements,
 * a synthetic requirement is generated with a sentinel ID so the caller can
 * always treat `approvalRequirementIds` as the authoritative list of gates.
 *
 * This stage never denies — it either passes or routes to approval. Denial for
 * policy-level approval decisions is handled by Stage 2 (policy.ts).
 *
 * Relationship to Stage 2:
 *   - Stage 2 may return `require-approval` when a GuardrailPolicy's action is
 *     `require-approval`. That halts Stage 2 and the pipeline immediately routes
 *     to approval — Stage 4 is not reached.
 *   - Stage 4 is reached only when Stages 1–3 all passed. It provides an
 *     independent, capability- and frame-level approval gate.
 */

import { randomUUID } from "node:crypto";
import { createApprovalRequestedRecord } from "../audit.js";
import type { GuardrailContext, StageResult, VerdictRequireApproval } from "../types.js";

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function elapsed(start: number): number {
  return Date.now() - start;
}

// ---------------------------------------------------------------------------
// Stage implementation
// ---------------------------------------------------------------------------

/**
 * Run the approval stage against the current context.
 *
 * Returns a `pass` verdict when no approval is required, or a
 * `require-approval` verdict with the list of requirement IDs to satisfy.
 */
export function runApprovalStage(ctx: GuardrailContext): StageResult {
  const start = Date.now();
  const { request, frame, capability } = ctx;

  const reasons: string[] = [];
  const requirementIds: string[] = [];

  // ------------------------------------------------------------------
  // Source 1: Capability-level approval requirement
  // ------------------------------------------------------------------
  if (capability.requiresApproval) {
    reasons.push(
      `Capability "${capability.id}" (${capability.name}) declares requiresApproval: true`
    );

    // Map to frame approval requirements if available.
    // If the frame has none, synthesize a sentinel ID so the caller
    // always gets a non-empty requirementIds array to route on.
    if (frame.approvalRequirements.length > 0) {
      for (const req of frame.approvalRequirements) {
        if (!requirementIds.includes(req.requirementId)) {
          requirementIds.push(req.requirementId);
        }
      }
    } else {
      // No frame requirements defined — generate a synthetic gate.
      // The approval service must handle this ID as an ad-hoc gate.
      const syntheticId = `synthetic:capability-approval:${capability.id}:${randomUUID()}`;
      requirementIds.push(syntheticId);
    }
  }

  // ------------------------------------------------------------------
  // Source 2: Frame-level approval requirements (Projection layer rules)
  // ------------------------------------------------------------------
  for (const req of frame.approvalRequirements) {
    if (!requirementIds.includes(req.requirementId)) {
      requirementIds.push(req.requirementId);
      reasons.push(
        `Frame approval requirement "${req.requirementId}": ${req.reason} ` +
          `(approver role: ${req.approverRole})`
      );
    }
  }

  // ------------------------------------------------------------------
  // No approval needed — pass through.
  // ------------------------------------------------------------------
  if (requirementIds.length === 0) {
    return {
      stage: "approval",
      verdict: { outcome: "pass" },
      auditRecords: [],
      durationMs: elapsed(start),
    };
  }

  // ------------------------------------------------------------------
  // Approval required — build verdict and audit record.
  // ------------------------------------------------------------------
  const reason = reasons.join("; ");

  const auditRecord = createApprovalRequestedRecord(
    request,
    frame,
    requirementIds,
    reason
  );

  const verdict: VerdictRequireApproval = {
    outcome: "require-approval",
    requirementIds,
    reason,
  };

  return {
    stage: "approval",
    verdict,
    auditRecords: [auditRecord],
    durationMs: elapsed(start),
  };
}
