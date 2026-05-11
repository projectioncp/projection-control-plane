/**
 * Decision Frame — Validation Layer
 *
 * Validation runs in two sequential phases:
 *
 *   Phase 1 — Schema validation (Zod)
 *     Checks types, formats, required fields, and value ranges.
 *     Produces `INVALID_TYPE`, `REQUIRED_FIELD`, `INVALID_FORMAT`, and
 *     `INVALID_RANGE` issues.
 *
 *   Phase 2 — Business rules
 *     Checks cross-field semantic constraints that cannot be expressed in
 *     a schema. Each rule is a named, independently testable function.
 *     Both phases run to completion so callers receive all errors at once.
 *
 * Usage:
 *
 *   const result = validateDecisionFrame(untrustedInput);
 *   if (!result.ok) {
 *     console.error(result.errors);
 *     return;
 *   }
 *   const frame: DecisionFrame = result.data;
 *
 * For a throwing variant:
 *
 *   const frame = assertDecisionFrame(untrustedInput);
 */

import { ZodError } from "zod";
import { DecisionFrameSchema, type DecisionFrame } from "./schema.js";

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

/** Enumerated error codes for programmatic handling by callers. */
export type ValidationErrorCode =
  | "INVALID_TYPE"            // wrong JS type for a field
  | "REQUIRED_FIELD"          // expected field is missing
  | "INVALID_FORMAT"          // value present but malformed (e.g. bad timestamp)
  | "INVALID_RANGE"           // numeric value outside permitted bounds
  | "BLANK_INTENT"            // intent is whitespace only
  | "TEMPORAL_ORDER"          // expiresAt is not after createdAt
  | "FRAME_EXPIRED"           // frame has already expired at validation time
  | "TELEMETRY_FROM_FUTURE"   // telemetry.capturedAt is after frame.createdAt
  | "CAPABILITY_NOT_AUTHORIZED" // executionBoundaries references an unauthorized capability
  | "DUPLICATE_CONSTRAINT_ID" // two PolicyConstraints share a constraintId
  | "DUPLICATE_APPROVAL_ID"   // two ApprovalRequirements share a requirementId
  | "DUPLICATE_CAPABILITY_ID" // authorizedCapabilityIds contains duplicates
  | "DUPLICATE_MEMORY_REF"    // contextualMemoryRefs contains duplicates
  | "EMPTY_CAPABILITY_BOUNDARY"; // allowedCapabilityIds is empty when maxExecutions > 0

/** A single validation issue with a machine-readable code and a navigable path. */
export interface ValidationIssue {
  /** Machine-readable error code for programmatic handling. */
  code: ValidationErrorCode;
  /**
   * Array of property names / indices forming the path to the offending field.
   * An empty array means the issue is at the root object level.
   * Examples: ["expiresAt"], ["policyConstraints", 1, "constraintId"]
   */
  path: (string | number)[];
  /** Human-readable description of the problem. */
  message: string;
  /** The value that was received (if available and safe to log). */
  received?: unknown;
  /** A description of what was expected. */
  expected?: string;
}

export interface ValidationSuccess<T> {
  ok: true;
  data: T;
}

export interface ValidationFailure {
  ok: false;
  errors: ValidationIssue[];
}

export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface ValidationOptions {
  /**
   * If true, skip the check that `expiresAt` is in the future.
   * Use this when validating historical frames (e.g. replaying audit logs).
   * Default: false — frames are expected to be unexpired.
   */
  allowExpired?: boolean;
  /**
   * Reference point for expiry checks. Defaults to `new Date()`.
   * Inject a fixed value in tests to keep assertions deterministic.
   */
  now?: Date;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse an ISO-8601 string to a Date, returning null on failure. */
function parseTs(ts: string): Date | null {
  const d = new Date(ts);
  return isNaN(d.getTime()) ? null : d;
}

/** Collect duplicate values from an array, returning the set of duplicates. */
function findDuplicates<T>(arr: T[]): Set<T> {
  const seen = new Set<T>();
  const dupes = new Set<T>();
  for (const v of arr) {
    if (seen.has(v)) dupes.add(v);
    else seen.add(v);
  }
  return dupes;
}

// ---------------------------------------------------------------------------
// Phase 1 — Zod schema → ValidationIssue[]
// ---------------------------------------------------------------------------

/**
 * Convert a ZodError into our ValidationIssue format.
 * Maps Zod issue codes to our ValidationErrorCode enum.
 */
function zodErrorToIssues(err: ZodError): ValidationIssue[] {
  return err.issues.map((zi) => {
    let code: ValidationErrorCode = "INVALID_TYPE";
    if (zi.code === "invalid_type") {
      code = zi.received === "undefined" ? "REQUIRED_FIELD" : "INVALID_TYPE";
    } else if (zi.code === "invalid_string") {
      code = "INVALID_FORMAT";
    } else if (
      zi.code === "too_small" ||
      zi.code === "too_big" ||
      zi.code === "invalid_enum_value"
    ) {
      code = "INVALID_RANGE";
    }

    const issue: ValidationIssue = {
      code,
      path: zi.path as (string | number)[],
      message: zi.message,
    };
    if ("received" in zi) issue.received = zi.received;
    if ("expected" in zi) issue.expected = String(zi.expected);
    return issue;
  });
}

// ---------------------------------------------------------------------------
// Phase 2 — Business rules
// ---------------------------------------------------------------------------

/**
 * Rule: expiresAt must be strictly after createdAt.
 * A frame that expires before or at its creation time is structurally invalid.
 */
function ruleTemporalOrder(frame: DecisionFrame): ValidationIssue[] {
  const created = parseTs(frame.createdAt);
  const expires = parseTs(frame.expiresAt);
  if (!created || !expires) return []; // already caught by schema
  if (expires <= created) {
    return [
      {
        code: "TEMPORAL_ORDER",
        path: ["expiresAt"],
        message: `expiresAt (${frame.expiresAt}) must be strictly after createdAt (${frame.createdAt})`,
        received: frame.expiresAt,
        expected: `timestamp after ${frame.createdAt}`,
      },
    ];
  }
  return [];
}

/**
 * Rule: frame must not already be expired at validation time.
 * Skipped when ValidationOptions.allowExpired is true.
 */
function ruleFrameNotExpired(
  frame: DecisionFrame,
  now: Date
): ValidationIssue[] {
  const expires = parseTs(frame.expiresAt);
  if (!expires) return [];
  if (expires <= now) {
    return [
      {
        code: "FRAME_EXPIRED",
        path: ["expiresAt"],
        message: `Decision Frame expired at ${frame.expiresAt} (now: ${now.toISOString()})`,
        received: frame.expiresAt,
        expected: `timestamp after ${now.toISOString()}`,
      },
    ];
  }
  return [];
}

/**
 * Rule: telemetry must not have been captured after the frame was created.
 * Telemetry from the future indicates a data pipeline error or clock skew.
 */
function ruleTelemetryNotFromFuture(frame: DecisionFrame): ValidationIssue[] {
  const created = parseTs(frame.createdAt);
  const captured = parseTs(frame.telemetry.capturedAt);
  if (!created || !captured) return [];
  if (captured > created) {
    return [
      {
        code: "TELEMETRY_FROM_FUTURE",
        path: ["telemetry", "capturedAt"],
        message:
          `telemetry.capturedAt (${frame.telemetry.capturedAt}) is after ` +
          `frame.createdAt (${frame.createdAt}). Telemetry must be a past snapshot.`,
        received: frame.telemetry.capturedAt,
        expected: `timestamp ≤ ${frame.createdAt}`,
      },
    ];
  }
  return [];
}

/**
 * Rule: intent must not be blank.
 * Zod's .min(1) catches empty strings but not whitespace-only strings like "  ".
 */
function ruleNonBlankIntent(frame: DecisionFrame): ValidationIssue[] {
  if (frame.intent.trim().length === 0) {
    return [
      {
        code: "BLANK_INTENT",
        path: ["intent"],
        message: "intent must not be blank or whitespace-only",
        received: frame.intent,
        expected: "non-empty, non-whitespace string",
      },
    ];
  }
  return [];
}

/**
 * Rule: executionBoundaries.allowedCapabilityIds must be a subset of
 * authorizedCapabilityIds.
 *
 * The execution boundary narrows what the frame authorizes; it cannot
 * grant access to capabilities the frame hasn't authorized.
 */
function ruleCapabilitySubset(frame: DecisionFrame): ValidationIssue[] {
  const authorized = new Set(frame.authorizedCapabilityIds);
  const issues: ValidationIssue[] = [];
  frame.executionBoundaries.allowedCapabilityIds.forEach((capId, idx) => {
    if (!authorized.has(capId)) {
      issues.push({
        code: "CAPABILITY_NOT_AUTHORIZED",
        path: ["executionBoundaries", "allowedCapabilityIds", idx],
        message:
          `Capability "${capId}" appears in executionBoundaries.allowedCapabilityIds ` +
          `but is not in authorizedCapabilityIds`,
        received: capId,
        expected: "a capability ID present in authorizedCapabilityIds",
      });
    }
  });
  return issues;
}

/**
 * Rule: when maxExecutions > 0, allowedCapabilityIds must not be empty.
 * An execution budget with no allowed capabilities is a configuration error.
 */
function ruleNonEmptyCapabilityBoundary(frame: DecisionFrame): ValidationIssue[] {
  if (
    frame.executionBoundaries.maxExecutions > 0 &&
    frame.executionBoundaries.allowedCapabilityIds.length === 0
  ) {
    return [
      {
        code: "EMPTY_CAPABILITY_BOUNDARY",
        path: ["executionBoundaries", "allowedCapabilityIds"],
        message:
          "executionBoundaries.allowedCapabilityIds must not be empty " +
          "when maxExecutions > 0",
        received: [],
        expected: "at least one capability ID",
      },
    ];
  }
  return [];
}

/**
 * Rule: each PolicyConstraint must have a unique constraintId within the frame.
 * Duplicate IDs cause undefined evaluation behavior in the Guardrail layer.
 */
function ruleNoDuplicateConstraintIds(frame: DecisionFrame): ValidationIssue[] {
  const ids = frame.policyConstraints.map((c) => c.constraintId);
  const dupes = findDuplicates(ids);
  if (dupes.size === 0) return [];

  return frame.policyConstraints.flatMap((c, idx) =>
    dupes.has(c.constraintId)
      ? [
          {
            code: "DUPLICATE_CONSTRAINT_ID" as const,
            path: ["policyConstraints", idx, "constraintId"],
            message: `Duplicate constraintId "${c.constraintId}" in policyConstraints`,
            received: c.constraintId,
            expected: "unique constraintId within this frame",
          },
        ]
      : []
  );
}

/**
 * Rule: each ApprovalRequirement must have a unique requirementId within the frame.
 * Duplicate IDs cause approval routing to match the wrong gate.
 */
function ruleNoDuplicateApprovalIds(frame: DecisionFrame): ValidationIssue[] {
  const ids = frame.approvalRequirements.map((r) => r.requirementId);
  const dupes = findDuplicates(ids);
  if (dupes.size === 0) return [];

  return frame.approvalRequirements.flatMap((r, idx) =>
    dupes.has(r.requirementId)
      ? [
          {
            code: "DUPLICATE_APPROVAL_ID" as const,
            path: ["approvalRequirements", idx, "requirementId"],
            message: `Duplicate requirementId "${r.requirementId}" in approvalRequirements`,
            received: r.requirementId,
            expected: "unique requirementId within this frame",
          },
        ]
      : []
  );
}

/**
 * Rule: authorizedCapabilityIds must contain no duplicates.
 * Duplicates bloat the authorization set and may mask policy evaluation bugs.
 */
function ruleNoDuplicateCapabilityIds(frame: DecisionFrame): ValidationIssue[] {
  const dupes = findDuplicates(frame.authorizedCapabilityIds);
  if (dupes.size === 0) return [];

  return frame.authorizedCapabilityIds.flatMap((id, idx) =>
    dupes.has(id)
      ? [
          {
            code: "DUPLICATE_CAPABILITY_ID" as const,
            path: ["authorizedCapabilityIds", idx],
            message: `Duplicate capability ID "${id}" in authorizedCapabilityIds`,
            received: id,
            expected: "each capability ID to appear at most once",
          },
        ]
      : []
  );
}

/**
 * Rule: contextualMemoryRefs must contain no duplicates.
 * Duplicate refs cause the AI to see and potentially cite the same memory
 * entry multiple times, inflating context weight.
 */
function ruleNoDuplicateMemoryRefs(frame: DecisionFrame): ValidationIssue[] {
  const dupes = findDuplicates(frame.contextualMemoryRefs);
  if (dupes.size === 0) return [];

  return frame.contextualMemoryRefs.flatMap((ref, idx) =>
    dupes.has(ref)
      ? [
          {
            code: "DUPLICATE_MEMORY_REF" as const,
            path: ["contextualMemoryRefs", idx],
            message: `Duplicate memory reference "${ref}" in contextualMemoryRefs`,
            received: ref,
            expected: "each memory reference to appear at most once",
          },
        ]
      : []
  );
}

// ---------------------------------------------------------------------------
// Business rule registry
// ---------------------------------------------------------------------------

/**
 * The ordered list of business rule functions applied during Phase 2.
 * Add new rules here to include them in all validation calls.
 *
 * Rules receive the fully-parsed DecisionFrame (Phase 1 already passed)
 * and the resolved validation options. Each rule returns an array of
 * ValidationIssue objects — empty if the rule passes.
 */
type BusinessRule = (
  frame: DecisionFrame,
  opts: Required<ValidationOptions>
) => ValidationIssue[];

const BUSINESS_RULES: BusinessRule[] = [
  (f) => ruleNonBlankIntent(f),
  (f) => ruleTemporalOrder(f),
  (f, o) => (o.allowExpired ? [] : ruleFrameNotExpired(f, o.now)),
  (f) => ruleTelemetryNotFromFuture(f),
  (f) => ruleCapabilitySubset(f),
  (f) => ruleNonEmptyCapabilityBoundary(f),
  (f) => ruleNoDuplicateConstraintIds(f),
  (f) => ruleNoDuplicateApprovalIds(f),
  (f) => ruleNoDuplicateCapabilityIds(f),
  (f) => ruleNoDuplicateMemoryRefs(f),
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate an unknown input as a DecisionFrame.
 *
 * Runs both schema validation (Phase 1) and business rules (Phase 2).
 * Always collects all errors before returning — callers receive a complete
 * picture rather than stopping at the first failure.
 *
 * @param input   - Any value (typically untrusted external data).
 * @param options - Validation behaviour overrides.
 * @returns       ValidationSuccess with the parsed frame, or ValidationFailure
 *                with a non-empty list of issues.
 *
 * @example
 * const result = validateDecisionFrame(body);
 * if (!result.ok) {
 *   logger.warn({ errors: result.errors }, "Invalid Decision Frame");
 *   return res.status(400).json(result.errors);
 * }
 * await processFrame(result.data);
 */
export function validateDecisionFrame(
  input: unknown,
  options: ValidationOptions = {}
): ValidationResult<DecisionFrame> {
  const opts: Required<ValidationOptions> = {
    allowExpired: options.allowExpired ?? false,
    now: options.now ?? new Date(),
  };

  const issues: ValidationIssue[] = [];

  // Phase 1 — schema validation
  const parsed = DecisionFrameSchema.safeParse(input);
  if (!parsed.success) {
    issues.push(...zodErrorToIssues(parsed.error));
  }

  // Phase 2 — business rules (only if schema passed; rules assume a valid shape)
  if (parsed.success) {
    for (const rule of BUSINESS_RULES) {
      issues.push(...rule(parsed.data, opts));
    }
  }

  if (issues.length > 0) {
    return { ok: false, errors: issues };
  }

  return { ok: true, data: parsed.data! };
}

/**
 * Validate a Decision Frame and throw on failure.
 *
 * Prefer `validateDecisionFrame` at system boundaries where you control the
 * error response. Use this variant deep in the runtime where an invalid frame
 * at that point represents an internal invariant violation.
 *
 * @throws {DecisionFrameValidationError}
 */
export function assertDecisionFrame(
  input: unknown,
  options: ValidationOptions = {}
): DecisionFrame {
  const result = validateDecisionFrame(input, options);
  if (!result.ok) {
    throw new DecisionFrameValidationError(result.errors);
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

/**
 * Thrown by `assertDecisionFrame` when validation fails.
 * Carries the full list of ValidationIssues for structured error handling.
 */
export class DecisionFrameValidationError extends Error {
  readonly errors: ValidationIssue[];

  constructor(errors: ValidationIssue[]) {
    const summary = errors
      .slice(0, 3)
      .map((e) => `[${e.code}] ${e.path.join(".") || "<root>"}: ${e.message}`)
      .join("; ");
    const tail = errors.length > 3 ? ` … and ${errors.length - 3} more` : "";
    super(`Decision Frame validation failed: ${summary}${tail}`);
    this.name = "DecisionFrameValidationError";
    this.errors = errors;
  }
}
