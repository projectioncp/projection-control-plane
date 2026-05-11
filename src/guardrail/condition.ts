/**
 * Guardrail — Condition Evaluator
 *
 * Evaluates PolicyCondition and PolicyConstraint predicates against an
 * ExecutionRequest. Both types share the same operator vocabulary; this
 * module handles them uniformly.
 *
 * Field paths use dot notation and are resolved against the full
 * ExecutionRequest object:
 *
 *   "confidence"          → request.confidence
 *   "capabilityId"        → request.capabilityId
 *   "input.amount"        → request.input.amount
 *   "metadata.region"     → request.metadata.region
 *
 * Evaluation is pure and synchronous — no side effects, no I/O.
 */

import type { ExecutionRequest, PolicyConstraint } from "../types.js";

// The operator type is shared between PolicyConstraint and PolicyCondition.
export type EvalOperator = PolicyConstraint["operator"];

/**
 * Minimal interface covering both PolicyCondition and PolicyConstraint.
 * `value` is optional at the type level because Zod infers z.unknown() as
 * potentially absent under exactOptionalPropertyTypes. All operators
 * handle a missing value gracefully (they return false).
 */
export interface EvaluableCondition {
  field: string;
  operator: EvalOperator;
  value?: unknown;
}

// ---------------------------------------------------------------------------
// Field accessor
// ---------------------------------------------------------------------------

/**
 * Resolve a dot-notation path against an arbitrary object.
 * Returns `undefined` for missing or non-traversable paths.
 *
 * @example
 * getFieldValue({ input: { amount: 500 } }, "input.amount") // 500
 * getFieldValue({ confidence: 0.9 }, "confidence")           // 0.9
 * getFieldValue({ a: null }, "a.b")                          // undefined
 */
export function getFieldValue(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  return parts.reduce<unknown>((current, key) => {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object" || Array.isArray(current)) return undefined;
    return (current as Record<string, unknown>)[key];
  }, obj);
}

// ---------------------------------------------------------------------------
// Operator evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate a single operator comparison between an actual runtime value
 * and the expected value from the condition definition.
 *
 * Type mismatches return `false` rather than throwing — an unevaluable
 * condition is treated as unmatched.
 */
export function evalOperator(
  actual: unknown,
  operator: EvalOperator,
  expected: unknown
): boolean {
  switch (operator) {
    // Equality
    case "eq":
      return actual === expected;

    case "neq":
      return actual !== expected;

    // Numeric comparisons — strict type enforcement
    case "gt":
      return (
        typeof actual === "number" &&
        typeof expected === "number" &&
        actual > expected
      );

    case "lt":
      return (
        typeof actual === "number" &&
        typeof expected === "number" &&
        actual < expected
      );

    case "gte":
      return (
        typeof actual === "number" &&
        typeof expected === "number" &&
        actual >= expected
      );

    case "lte":
      return (
        typeof actual === "number" &&
        typeof expected === "number" &&
        actual <= expected
      );

    // Membership
    case "in":
      return Array.isArray(expected) && expected.includes(actual);

    case "not-in":
      return Array.isArray(expected) && !expected.includes(actual);

    // String / array containment
    case "contains":
      if (typeof actual === "string" && typeof expected === "string") {
        return actual.includes(expected);
      }
      if (Array.isArray(actual)) {
        return actual.includes(expected);
      }
      return false;

    // Regex — expected is the pattern string
    case "regex": {
      if (typeof actual !== "string" || typeof expected !== "string") {
        return false;
      }
      try {
        return new RegExp(expected).test(actual);
      } catch {
        // Invalid regex pattern — treat as non-matching
        return false;
      }
    }

    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Evaluate a single condition against an ExecutionRequest.
 * Returns `true` if the condition is satisfied.
 *
 * @example
 * evaluateCondition(
 *   { field: "confidence", operator: "gte", value: 0.8 },
 *   request
 * ); // true if request.confidence >= 0.8
 */
export function evaluateCondition(
  condition: EvaluableCondition,
  request: ExecutionRequest
): boolean {
  const actual = getFieldValue(request, condition.field);
  return evalOperator(actual, condition.operator, condition.value);
}

/**
 * Evaluate a list of conditions against an ExecutionRequest (AND semantics).
 *
 * - An empty conditions array always returns `true` (match-everything).
 * - Returns `false` as soon as any single condition fails.
 *
 * @example
 * evaluateConditions(policy.conditions, request);
 */
export function evaluateConditions(
  conditions: EvaluableCondition[],
  request: ExecutionRequest
): boolean {
  return conditions.every((c) => evaluateCondition(c, request));
}

/**
 * Evaluate conditions and return the first failing condition, or `null` if all pass.
 * Useful for producing a precise error message about which constraint was violated.
 */
export function findFailingCondition(
  conditions: EvaluableCondition[],
  request: ExecutionRequest
): EvaluableCondition | null {
  return conditions.find((c) => !evaluateCondition(c, request)) ?? null;
}
