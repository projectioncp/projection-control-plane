/**
 * Guardrail Stage 3 — Frame Constraint Evaluation
 *
 * Evaluates the frame-level PolicyConstraints baked into the Decision Frame
 * by the Projection layer. These constraints are independent of the policy
 * library: they represent the Projection layer's per-request governance rules
 * that apply unconditionally to this specific frame.
 *
 * Common uses:
 *   - "confidence must be ≥ 0.85 for this workflow step"
 *   - "capabilityId must not be 'delete-production-data'"
 *   - "input.amount must be ≤ 50000"
 *
 * All constraints are evaluated (no short-circuit). The stage returns the
 * first violation as a deny verdict; if multiple constraints fail, all
 * violations are included in the details of the single audit record.
 *
 * Constraint semantics:
 *   A constraint is SATISFIED when `evalOperator(actual, operator, value)` is
 *   true. If the operator returns false, the constraint is VIOLATED and the
 *   stage denies the request.
 *
 * Note: the policy library's `confidenceThreshold` field is handled by Stage 2
 * (policy.ts). This stage handles the frame's policyConstraints array, which
 * can target confidence or any other field on ExecutionRequest.
 */

import type { AuditRecord } from "../../types.js";
// Use the Zod-inferred PolicyConstraint (value?: unknown) since frame.policyConstraints
// is typed from DecisionFrameSchema. The types.ts interface has value: unknown (required),
// but Zod infers z.unknown() as optional under exactOptionalPropertyTypes.
import type { PolicyConstraint } from "../../projection/schema.js";
import { createConstraintViolationRecord } from "../audit.js";
import {
  evalOperator,
  getFieldValue,
  type EvaluableCondition,
} from "../condition.js";
import type { GuardrailContext, StageResult, VerdictDeny } from "../types.js";

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function elapsed(start: number): number {
  return Date.now() - start;
}

// ---------------------------------------------------------------------------
// Constraint evaluation
// ---------------------------------------------------------------------------

interface ConstraintViolation {
  constraint: PolicyConstraint;
  actualValue: unknown;
  reason: string;
}

/**
 * Evaluate a single PolicyConstraint against the ExecutionRequest.
 *
 * A constraint expresses: "field OPERATOR value must be true."
 * If the actual value does not satisfy the operator, the constraint is violated.
 */
function evaluateConstraint(
  constraint: PolicyConstraint,
  ctx: GuardrailContext
): ConstraintViolation | null {
  const actual = getFieldValue(ctx.request, constraint.field);

  const asCondition: EvaluableCondition = {
    field: constraint.field,
    operator: constraint.operator,
    value: constraint.value,
  };

  const satisfied = evalOperator(actual, asCondition.operator, constraint.value);

  if (!satisfied) {
    const reason =
      `Frame constraint "${constraint.constraintId}" violated: ` +
      `field "${constraint.field}" — ${constraint.description}. ` +
      `Expected: ${constraint.operator} ${JSON.stringify(constraint.value)}, ` +
      `received: ${JSON.stringify(actual)}`;
    return { constraint, actualValue: actual, reason };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Stage implementation
// ---------------------------------------------------------------------------

/**
 * Run all frame-level PolicyConstraints against the ExecutionRequest.
 *
 * Returns:
 *  - `pass`  — all constraints satisfied
 *  - `deny`  — at least one constraint was violated (FRAME_CONSTRAINT_VIOLATION)
 *
 * All violations are evaluated before returning so the audit record contains
 * the full set. The denial reason contains the primary (first) violation;
 * all violations are in the audit record details.
 */
export function runConstraintsStage(ctx: GuardrailContext): StageResult {
  const start = Date.now();
  const { request, frame } = ctx;
  const constraints = frame.policyConstraints;

  if (constraints.length === 0) {
    return {
      stage: "constraints",
      verdict: { outcome: "pass" },
      auditRecords: [],
      durationMs: elapsed(start),
    };
  }

  // Evaluate all constraints — collect every violation, don't short-circuit.
  const violations: ConstraintViolation[] = [];
  for (const constraint of constraints) {
    const violation = evaluateConstraint(constraint, ctx);
    if (violation !== null) {
      violations.push(violation);
    }
  }

  if (violations.length === 0) {
    return {
      stage: "constraints",
      verdict: { outcome: "pass" },
      auditRecords: [],
      durationMs: elapsed(start),
    };
  }

  // ------------------------------------------------------------------
  // One or more violations found — build audit records and deny.
  // ------------------------------------------------------------------

  const auditRecords: AuditRecord[] = violations.map((v) =>
    createConstraintViolationRecord(
      request,
      frame,
      v.constraint.constraintId,
      v.constraint.description,
      v.reason,
      "constraints"
    )
  );

  // Primary violation drives the stage verdict.
  // violations.length > 0 is guaranteed at this point (checked above).
  const primary = violations[0]!;

  const reason =
    violations.length === 1
      ? primary.reason
      : `${violations.length} frame constraint(s) violated. Primary: ${primary.reason}`;

  const verdict: VerdictDeny = {
    outcome: "deny",
    code: "FRAME_CONSTRAINT_VIOLATION",
    reason,
    constraintId: primary.constraint.constraintId,
  };

  // All violations are captured in auditRecords above.
  // The pipeline flattens auditRecords from every stage into the final result.
  return {
    stage: "constraints",
    verdict,
    auditRecords,
    durationMs: elapsed(start),
  };
}
