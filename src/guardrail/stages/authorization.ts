/**
 * Guardrail Stage 1 — Authorization
 *
 * The first gate in the pipeline. Answers the question:
 * "Is this principal allowed to invoke this capability within this frame?"
 *
 * Checks (in order):
 *   1. Frame expiry              — the frame must still be valid
 *   2. Principal binding         — the requesting principal must match the frame
 *   3. Frame capability scope    — the capability must be in authorizedCapabilityIds
 *   4. Execution boundary scope  — the capability must be in executionBoundaries.allowedCapabilityIds
 *   5. Entitlement check         — the principal must hold all requiredEntitlements
 *
 * Any failure halts the pipeline immediately. Authorization failures are
 * recorded as `entitlement-denied` audit events.
 *
 * This stage has no dependency on policies — it validates structural and
 * identity invariants that must hold before any policy is consulted.
 */

import type { AuditRecord } from "../../types.js";
import { createAuthorizationDeniedRecord } from "../audit.js";
import type { GuardrailContext, GuardrailDenyCode, StageResult, VerdictDeny } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function elapsed(start: number): number {
  return Date.now() - start;
}

function deny(
  code: GuardrailDenyCode,
  reason: string,
  auditRecords: AuditRecord[],
  start: number
): StageResult {
  const verdict: VerdictDeny = { outcome: "deny", code, reason };
  return { stage: "authorization", verdict, auditRecords, durationMs: elapsed(start) };
}

function pass(start: number): StageResult {
  return {
    stage: "authorization",
    verdict: { outcome: "pass" },
    auditRecords: [],
    durationMs: elapsed(start),
  };
}

// ---------------------------------------------------------------------------
// Stage implementation
// ---------------------------------------------------------------------------

/**
 * Run the authorization stage against the provided context.
 *
 * Returns a `StageResult` with a `pass` verdict on success, or a `deny`
 * verdict (with a populated audit record) on the first failure found.
 * This stage always short-circuits on the first failure — there is no
 * value in continuing once an identity or scope check fails.
 */
export function runAuthorizationStage(ctx: GuardrailContext): StageResult {
  const start = Date.now();
  const { request, frame, capability, now } = ctx;

  // ------------------------------------------------------------------
  // Check 1: Frame must not be expired
  // ------------------------------------------------------------------
  const frameExpiry = new Date(frame.expiresAt);
  if (frameExpiry <= now) {
    const reason =
      `Decision Frame "${frame.id}" expired at ${frame.expiresAt} ` +
      `(evaluated at ${now.toISOString()})`;
    return deny(
      "FRAME_EXPIRED",
      reason,
      [createAuthorizationDeniedRecord(request, frame, "FRAME_EXPIRED", reason, {
        frameExpiresAt: frame.expiresAt,
        evaluatedAt: now.toISOString(),
      })],
      start
    );
  }

  // ------------------------------------------------------------------
  // Check 2: Principal must match the frame's issued principal
  // ------------------------------------------------------------------
  if (request.principalId !== frame.principalId) {
    const reason =
      `Request principal "${request.principalId}" does not match ` +
      `the principal this frame was issued to ("${frame.principalId}")`;
    return deny(
      "PRINCIPAL_MISMATCH",
      reason,
      [createAuthorizationDeniedRecord(request, frame, "PRINCIPAL_MISMATCH", reason, {
        requestPrincipalId: request.principalId,
        framePrincipalId: frame.principalId,
      })],
      start
    );
  }

  // ------------------------------------------------------------------
  // Check 3: Capability must be in the frame's authorized capability list
  // ------------------------------------------------------------------
  if (!frame.authorizedCapabilityIds.includes(capability.id)) {
    const reason =
      `Capability "${capability.id}" is not in the frame's authorized ` +
      `capability list (authorizedCapabilityIds)`;
    return deny(
      "CAPABILITY_NOT_IN_FRAME",
      reason,
      [createAuthorizationDeniedRecord(request, frame, "CAPABILITY_NOT_IN_FRAME", reason, {
        capabilityId: capability.id,
        authorizedCapabilityIds: frame.authorizedCapabilityIds,
      })],
      start
    );
  }

  // ------------------------------------------------------------------
  // Check 4: Capability must be within the frame's execution boundary
  // ------------------------------------------------------------------
  if (!frame.executionBoundaries.allowedCapabilityIds.includes(capability.id)) {
    const reason =
      `Capability "${capability.id}" is not within the frame's execution ` +
      `boundary (executionBoundaries.allowedCapabilityIds)`;
    return deny(
      "CAPABILITY_NOT_IN_BOUNDARY",
      reason,
      [createAuthorizationDeniedRecord(request, frame, "CAPABILITY_NOT_IN_BOUNDARY", reason, {
        capabilityId: capability.id,
        allowedCapabilityIds: frame.executionBoundaries.allowedCapabilityIds,
      })],
      start
    );
  }

  // ------------------------------------------------------------------
  // Check 5: Principal must hold all entitlements required by the capability
  // ------------------------------------------------------------------
  const principalEntitlements = new Set(frame.entitlements);
  const missingEntitlements = capability.requiredEntitlements.filter(
    (e) => !principalEntitlements.has(e)
  );

  if (missingEntitlements.length > 0) {
    const reason =
      `Principal "${request.principalId}" is missing ${missingEntitlements.length} ` +
      `required entitlement(s): ${missingEntitlements.map((e) => `"${e}"`).join(", ")}`;
    return deny(
      "ENTITLEMENT_MISSING",
      reason,
      [createAuthorizationDeniedRecord(request, frame, "ENTITLEMENT_MISSING", reason, {
        missingEntitlements,
        requiredEntitlements: capability.requiredEntitlements,
        principalEntitlements: [...principalEntitlements],
      })],
      start
    );
  }

  // ------------------------------------------------------------------
  // All checks passed
  // ------------------------------------------------------------------
  return pass(start);
}
