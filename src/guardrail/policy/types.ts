/**
 * Guardrail Policy Engine — Core Type Definitions
 *
 * This module defines the authoritative contracts for the Guardrail policy engine:
 * the component that evaluates GuardrailPolicy definitions against execution
 * requests and produces structured, auditable decisions.
 *
 * Architecture position:
 *
 *   PolicyEvaluationRequest
 *       │  (constructed by the pipeline's policy stage from GuardrailContext)
 *       ▼
 *   Policy Engine  (implementation: engine.ts — not yet)
 *       │  (evaluates policies in priority order)
 *       ▼
 *   PolicyEvaluationResult
 *       │  { decision: GuardrailDecision, violations, flags, trace, timing }
 *       ▼
 *   Pipeline policy stage translates → StageResult
 *
 * Key design invariants:
 *
 *   1. FAIL CLOSED — if no halting policy matches, the engine produces a
 *      DecisionDeny with code NO_MATCHING_POLICY. An explicit "allow" or
 *      "flag" is required; silence is not permissive.
 *
 *   2. PORTABILITY — PolicyEvaluationRequest is a serializable value object.
 *      It embeds all context the engine needs. This makes it safe to send to
 *      a remote policy service without leaking runtime handles.
 *
 *   3. COMPLETE TRACE — PolicyEvaluationResult.evaluatedPolicies records
 *      every policy that was inspected, including skipped ones. This gives
 *      auditors and operators a complete, ordered explanation of the decision.
 *
 *   4. NO SIDE EFFECTS — these are pure data contracts. The engine
 *      implementation must not write to external systems; callers do that.
 *
 * Relationship to the pipeline layer:
 *   - guardrail/types.ts  — pipeline types (StageResult, GuardrailContext, etc.)
 *   - guardrail/policy/   — this module; the policy engine contract
 *
 * The pipeline's GuardrailDecision (string union in guardrail/types.ts) and
 * this module's GuardrailDecision (discriminated union) are intentionally
 * separate. The pipeline's version is re-exported from the guardrail barrel as
 * a string union; this module's version is re-exported as PolicyDecision to
 * prevent collision. They will converge when the pipeline migrates.
 */

import type {
  ApprovalRequirement,
  CapabilityCategory,
  CapabilityId,
  ConfidenceScore,
  ConstraintOperator,
  FramePolicyConstraint,
  ISOTimestamp,
  Metadata,
  PrincipalId,
} from "../../projection/frame.js";

// ---------------------------------------------------------------------------
// Re-exports for consumers of this module
// ---------------------------------------------------------------------------

// These canonical types are needed by consumers of the policy engine contracts.
export type { CapabilityCategory, CapabilityId, ConstraintOperator };

// ---------------------------------------------------------------------------
// Primitive type aliases
// ---------------------------------------------------------------------------

/**
 * Stable identifier for a GuardrailPolicy.
 * UUID v4 or namespaced slug (e.g. "financial:high-value-deny") recommended.
 * The `policyId` must be stable across policy version updates.
 */
export type PolicyId = string;

// ---------------------------------------------------------------------------
// Vocabulary unions
// ---------------------------------------------------------------------------

/**
 * The action the policy engine applies when a matching GuardrailPolicy fires.
 *
 *   allow            — Explicitly permit the request. Halts policy evaluation.
 *   deny             — Reject the request. Halts policy evaluation.
 *   require-approval — Gate on human or system approval. Halts policy evaluation.
 *   flag             — Annotate for review without blocking. Evaluation continues.
 *   rate-limit       — Apply rate limiting. Non-halting; stubbed as a flag
 *                      by the built-in engine. Requires an external state adapter.
 *
 * Halting vs non-halting:
 *   allow / deny / require-approval → halt: first match wins
 *   flag / rate-limit → non-halting: accumulate and continue
 */
export type GuardrailAction =
  | "allow"
  | "deny"
  | "require-approval"
  | "flag"
  | "rate-limit";

/**
 * Machine-readable denial codes for programmatic handling, metrics routing,
 * and audit classification. Each code maps to a distinct denial cause.
 *
 *   EXPLICIT_DENY             — a policy with action "deny" explicitly matched
 *   NO_MATCHING_POLICY        — no policy produced a halting decision; fail-closed
 *   CONFIDENCE_BELOW_THRESHOLD — request.confidence < policy-required minimum
 *   ENTITLEMENT_MISSING       — principal lacks an entitlement required by a policy
 *   SCOPE_EXCLUDED            — capability or principal is excluded by policy scope
 *   FRAME_CONSTRAINT_VIOLATED — a frame-level FramePolicyConstraint evaluated false
 *   CONDITION_FAILED          — a policy condition produced an explicit denial
 */
export type PolicyDenyCode =
  | "EXPLICIT_DENY"
  | "NO_MATCHING_POLICY"
  | "CONFIDENCE_BELOW_THRESHOLD"
  | "ENTITLEMENT_MISSING"
  | "SCOPE_EXCLUDED"
  | "FRAME_CONSTRAINT_VIOLATED"
  | "CONDITION_FAILED";

/**
 * Distinguishes the category of rule that was violated in a PolicyViolation.
 * Used for programmatic triage, metrics classification, and remediation routing.
 *
 *   condition-failed    — a policy condition evaluated to false
 *   threshold-breached  — a confidence or numeric threshold was not met
 *   entitlement-missing — the principal does not hold a required entitlement
 *   scope-excluded      — the capability or principal falls outside policy scope
 *   frame-constraint    — a frame-level FramePolicyConstraint evaluated to false
 */
export type PolicyViolationKind =
  | "condition-failed"
  | "threshold-breached"
  | "entitlement-missing"
  | "scope-excluded"
  | "frame-constraint";

/**
 * Severity of a policy violation, for alerting triage and audit classification.
 *
 *   low      — informational; no immediate action required
 *   medium   — warrants review; may indicate misconfiguration or anomaly
 *   high     — serious governance breach; requires prompt operator attention
 *   critical — imminent compliance or security risk; must be escalated immediately
 */
export type PolicyViolationSeverity = "low" | "medium" | "high" | "critical";

// ---------------------------------------------------------------------------
// PolicyScope — what requests a policy applies to
// ---------------------------------------------------------------------------

/**
 * Scope filters that determine which requests a GuardrailPolicy evaluates.
 *
 * All fields are optional. When a field is absent, that dimension is
 * unrestricted — the policy applies across all values in that dimension.
 * When multiple fields are set, ALL must match (AND semantics).
 *
 * Scope is evaluated before the rule body. Requests that fail the scope check
 * are silently skipped — this is not a violation.
 *
 * Examples:
 *   { capabilityCategories: ["deployment"] }    → financial/billing caps only
 *   { environments: ["production"] }             → prod-only policy
 *   { principalPatterns: ["^svc-.*"] }           → service-account policies
 *   { requiredEntitlements: ["admin:write"] }    → only highly-privileged principals
 */
export interface PolicyScope {
  /**
   * Specific capability IDs this policy targets.
   * When set, the policy only evaluates requests for these capability IDs.
   * Evaluated before capabilityCategories and capabilityTags.
   */
  capabilityIds?: CapabilityId[];

  /**
   * Capability categories this policy targets.
   * When set, the policy only evaluates capabilities in these categories.
   * Ignored when capabilityIds is set and the requested capability is not in it.
   */
  capabilityCategories?: CapabilityCategory[];

  /**
   * Capability tags that must ALL be present for this policy to apply.
   * When set, the policy only evaluates capabilities whose tags include every listed tag.
   */
  capabilityTags?: string[];

  /**
   * Environment tags where this policy is active.
   * Matched against PolicyFrameContext.environment.
   * When absent, the policy applies in all environments.
   * Example: ["production", "staging"] — applies in prod and staging only.
   */
  environments?: string[];

  /**
   * Principal ID regex patterns. The request's principalId must match
   * at least one pattern for the scope check to pass.
   * When absent, all principals are in scope.
   * Example: ["^user-.*", "^svc-finance-.*"]
   */
  principalPatterns?: string[];

  /**
   * Entitlement tokens that must ALL be present on the principal for
   * this policy to apply. Useful for policies targeting privileged principals.
   * When absent, entitlements do not affect scope matching.
   */
  requiredEntitlements?: string[];
}

// ---------------------------------------------------------------------------
// PolicyCondition — single evaluable predicate
// ---------------------------------------------------------------------------

/**
 * A single evaluable predicate in a PolicyRule.
 *
 * Conditions are evaluated against the PolicyEvaluationRequest using
 * dot-notation field paths resolved against the full request object.
 * All conditions in a rule are ANDed — every condition must hold.
 *
 * Field path examples:
 *   "confidence"                 → request.confidence
 *   "input.amount"               → request.input.amount
 *   "capability.category"        → request.capability.category
 *   "frame.environment"          → request.frame.environment
 *   "frame.entitlements"         → request.frame.entitlements (array)
 *
 * A missing field path resolves to `undefined`, which makes all operators
 * evaluate to false — a missing field never satisfies a condition.
 */
export interface PolicyCondition {
  /**
   * Dot-notation path to the field on PolicyEvaluationRequest to evaluate.
   * Supports nested paths. Array elements are not individually traversable
   * without an "in" or "contains" operator.
   */
  field: string;
  /** Comparison operator applied to the field's resolved value. */
  operator: ConstraintOperator;
  /**
   * Expected value for the comparison.
   * Absent for unary operators (e.g. checking existence).
   * Must NOT contain credentials or sensitive configuration.
   */
  value?: unknown;
  /** Human-readable description of what this condition enforces. */
  description?: string;
}

// ---------------------------------------------------------------------------
// PolicyThreshold — scalar guard on ordered values
// ---------------------------------------------------------------------------

/**
 * A threshold guard on a scalar (numeric or confidence) value.
 *
 * Unlike conditions — which are general-purpose predicates — thresholds
 * make the policy's intent explicit: "this field must be at least X",
 * "this field must not exceed Y". They are evaluated separately and produce
 * `threshold-breached` violations, which are distinct from `condition-failed`.
 *
 * When a threshold is defined and the request value does not satisfy it,
 * the policy fires as if the rule matched — the action is applied and the
 * violation records kind "threshold-breached".
 *
 * Common usage: `{ field: "confidence", operator: "gte", value: 0.85 }`
 * means "confidence must be at least 0.85; if below, fire the policy".
 */
export interface PolicyThreshold {
  /**
   * Dot-notation path to the scalar field being guarded.
   * Typically "confidence" but may be any numeric field on the request.
   */
  field: string;
  /**
   * Operator expressing the threshold direction.
   * "gte" → field must be at least value; below threshold fires the policy.
   * "lte" → field must be at most value; above threshold fires the policy.
   */
  operator: ConstraintOperator;
  /** The threshold value. Must be a number. */
  value: number;
  /** Human-readable description of the threshold requirement. */
  description?: string;
}

// ---------------------------------------------------------------------------
// PolicyRule — composed evaluable rule
// ---------------------------------------------------------------------------

/**
 * The evaluable rule body of a GuardrailPolicy.
 *
 * A rule fires when ALL of:
 *   - Every condition in `conditions` evaluates to true (AND; empty = always fires)
 *   - Every threshold in `thresholds` is violated (i.e. the threshold is NOT met)
 *
 * When the rule fires, the policy's `action` is applied.
 * When the rule does not fire, the policy is skipped and evaluation continues.
 *
 * Note on empty rules: a PolicyRule with no conditions and no thresholds matches
 * every request that passes the scope check. This is intentional for catch-all
 * policies (e.g. a final "deny everything not explicitly allowed" policy).
 */
export interface PolicyRule {
  /**
   * Conditions that must ALL be true for the rule to fire.
   * Empty array means the rule matches every request in scope.
   * Evaluated before thresholds for efficiency.
   */
  conditions: PolicyCondition[];
  /**
   * Threshold guards evaluated after conditions.
   * Each threshold describes a minimum/maximum requirement; violation fires the rule.
   * Multiple thresholds are ANDed — all must be violated for the rule to fire.
   * (In practice, thresholds are used as individual guards, not as a compound.)
   */
  thresholds?: PolicyThreshold[];
}

// ---------------------------------------------------------------------------
// Action configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for `require-approval` policy actions.
 *
 * Defines the approval routing contract: who can approve, how many are needed,
 * and how the system behaves when approval is not received in time.
 *
 * This configuration supplements (and may strengthen) any approval requirements
 * already declared in the Decision Frame or on the Capability itself.
 */
export interface PolicyApprovalConfig {
  /**
   * Roles that may approve requests gated by this policy.
   * At least one role is required. The approval routing service resolves
   * these to actual approver identities.
   */
  approverRoles: string[];
  /**
   * Minimum number of distinct approvers required before execution may proceed.
   * Must be ≥ 1 and ≤ approverRoles.length.
   */
  minimumApprovers: number;
  /**
   * Maximum wait time for approval in milliseconds.
   * When elapsed, `denyOnTimeout` controls the outcome.
   */
  timeoutMs: number;
  /**
   * When true, the request is automatically denied if approval is not received
   * within `timeoutMs`. When false, the approval service governs timeout behaviour.
   */
  denyOnTimeout: boolean;
  /**
   * Identifier of an escalation policy to invoke when approval is denied or
   * times out. Resolved by the runtime's approval and escalation subsystem.
   */
  escalationPolicyId?: string;
}

/**
 * Configuration for `rate-limit` policy actions.
 *
 * Describes the rate limit window and partitioning strategy.
 * Actual enforcement requires an external stateful adapter — the built-in
 * policy engine stubs this as a flag and records a "rate-limit stub" annotation.
 *
 * Callers that need true rate limiting must inject a custom policy stage
 * with an external counter store (Redis, DynamoDB, etc.).
 */
export interface PolicyRateLimitConfig {
  /** Maximum number of invocations allowed per window. */
  maxRequests: number;
  /** Window duration in milliseconds. */
  windowMs: number;
  /**
   * Rate limiting algorithm to apply.
   *   fixed-window  — simple counter reset at window boundary (cheapest)
   *   sliding-window — rolling window counter (accurate, more expensive)
   *   token-bucket  — smooth burst handling (recommended for APIs)
   */
  strategy: "fixed-window" | "sliding-window" | "token-bucket";
  /**
   * How to partition rate limit counters.
   *   global       — one shared counter for all traffic (strictest)
   *   principalId  — per-principal counter
   *   capabilityId — per-capability counter
   *   sessionId    — per-session counter
   * Absent = global.
   */
  keyBy?: "global" | "principalId" | "capabilityId" | "sessionId";
}

// ---------------------------------------------------------------------------
// GuardrailPolicy — canonical policy definition
// ---------------------------------------------------------------------------

/**
 * A GuardrailPolicy is a governance rule that determines whether an execution
 * request may proceed, must be approved, should be flagged, or must be denied.
 *
 * Policies are evaluated in ascending priority order (lower number = higher
 * priority). The engine applies this evaluation logic to each policy:
 *
 *   1. Scope check  — does `scope` match this request? If not, skip.
 *   2. Rule check   — does `rule` fire (conditions + thresholds)? If not, skip.
 *   3. Action       — apply `action`. Halting actions (allow, deny, require-approval)
 *                     stop evaluation. Non-halting actions (flag, rate-limit) accumulate.
 *
 * Fail-closed guarantee: if no halting action is reached, the engine produces
 * DecisionDeny with code NO_MATCHING_POLICY. An explicit policy must permit
 * execution; silence is not permissive.
 *
 * Cross-references:
 *   - PolicyEvaluationRequest.policies carries the sorted GuardrailPolicy[]
 *   - PolicyEvaluationResult.terminatingPolicy names the decisive policy
 *   - PolicyViolation.policyId links a violation to this policy
 *   - AuditRecord.policyId links audit events to this policy
 */
export interface GuardrailPolicy {
  // -- Identity --

  /** Stable policy identifier. Must be unique across the policy set. */
  policyId: PolicyId;
  /** Human-readable name shown in dashboards, alerts, and audit records. */
  name: string;
  /**
   * Precise description of what this policy enforces and the governance
   * rationale behind it. Written for operators and auditors.
   */
  description?: string;
  /**
   * Semantic version of this policy definition.
   * Breaking changes to scope or rule semantics require a major version bump.
   * The version is recorded in AuditRecords for policy-impact forensics.
   */
  version: string;

  // -- Evaluation order --

  /**
   * Evaluation priority. Lower number = evaluated first.
   * Policies at equal priority are evaluated in undefined order.
   *
   * Recommended convention:
   *   0–99    system safety policies (hard-coded platform limits)
   *   100–499 platform governance policies (shared across tenants)
   *   500–999 tenant/team custom policies
   */
  priority: number;

  // -- Lifecycle --

  /**
   * Whether this policy participates in evaluation.
   * Disabled policies are skipped entirely — they do not affect the decision
   * or appear in PolicyEvaluationResult.evaluatedPolicies.
   */
  enabled: boolean;
  /**
   * When set, this policy version is deprecated as of this timestamp.
   * Deprecated policies remain evaluable but the engine logs a deprecation warning.
   */
  deprecatedAt?: ISOTimestamp;

  // -- Scope --

  /**
   * Filters controlling which requests this policy evaluates.
   * Requests not in scope are silently skipped without producing violations.
   */
  scope: PolicyScope;

  // -- Rule --

  /**
   * The evaluable rule body. When the rule fires, `action` is applied.
   */
  rule: PolicyRule;

  // -- Action --

  /** What to do when the rule fires for a request in scope. */
  action: GuardrailAction;

  /**
   * Human-readable justification for the action.
   * Included verbatim in audit records, denial messages, and flag annotations.
   * Should explain the governance rationale, not just restate the policy name.
   */
  actionReason?: string;

  // -- Action configuration --

  /**
   * Required when action === "require-approval".
   * Defines who approves, how many are needed, and timeout behaviour.
   */
  approvalConfig?: PolicyApprovalConfig;

  /**
   * Required when action === "rate-limit".
   * Defines the window, strategy, and partitioning key.
   */
  rateLimitConfig?: PolicyRateLimitConfig;

  // -- Violation classification --

  /**
   * Severity assigned to violations produced by this policy.
   * Used for alerting priority and audit classification.
   * Default (when absent): "medium".
   */
  violationSeverity?: PolicyViolationSeverity;

  // -- Ownership and classification --

  /** Team, squad, or system that owns and maintains this policy. */
  owner: string;
  /** ISO-8601 timestamp when this policy was first created. */
  createdAt: ISOTimestamp;
  /** ISO-8601 timestamp of the most recent modification. */
  updatedAt: ISOTimestamp;
  /** Classification tags for policy-set filtering and compliance reporting. */
  tags?: string[];
  /** Domain-specific extension fields. */
  metadata?: Metadata;
}

// ---------------------------------------------------------------------------
// PolicyViolation — structured record of a rule breach
// ---------------------------------------------------------------------------

/**
 * A structured record of a single policy rule violation.
 *
 * PolicyViolations are produced by the engine when a matching policy fires
 * with a `deny` action, or when individual conditions/thresholds are breached.
 * They are collected in PolicyEvaluationResult.violations and embedded inside
 * the DecisionDeny discriminant variant of GuardrailDecision.
 *
 * Design contract:
 *   - `actualValue` and `expectedValue` must NOT contain credentials, PII,
 *     encryption keys, or sensitive system configuration.
 *   - Violations are immutable after creation.
 *   - `remediationHint` is operator-facing, not user-facing — it may contain
 *     technical detail appropriate for support engineers.
 *
 * Consumers:
 *   - The runtime uses violations to build structured denial error responses.
 *   - The audit layer captures violations verbatim in AuditRecords.
 *   - The alerting layer routes notifications based on `severity`.
 *   - Operators use `remediationHint` to diagnose and fix policy failures.
 */
export interface PolicyViolation {
  /** Unique identifier for this violation instance. UUID v4 recommended. */
  violationId: string;
  /** The policy that produced this violation. */
  policyId: PolicyId;
  /** Policy name at evaluation time (denormalized for readable audit records). */
  policyName: string;
  /** Category of rule that was violated. */
  kind: PolicyViolationKind;

  // -- Evidence --

  /**
   * Dot-notation path to the field that was evaluated.
   * Present for condition-failed and threshold-breached kinds.
   * Absent for scope-level violations where no field is applicable.
   */
  field?: string;

  /**
   * The actual value resolved on the request at evaluation time.
   * Present when a field comparison was performed.
   * MUST NOT contain credentials, PII, or sensitive payload data.
   */
  actualValue?: unknown;

  /**
   * The value the policy expected or required.
   * Present when a field comparison was performed.
   * MUST NOT contain credentials, PII, or sensitive payload data.
   */
  expectedValue?: unknown;

  // -- Human-readable detail --

  /** Complete human-readable explanation of the violation. */
  message: string;

  /**
   * Actionable guidance for the caller or operator to resolve the violation.
   * Examples:
   *   "Request with confidence ≥ 0.85 or obtain an explicit allow policy."
   *   "Obtain the 'payments:write' entitlement from the access management system."
   *   "Switch to a non-production environment for this operation."
   */
  remediationHint?: string;

  // -- Classification --

  /**
   * Severity for alerting and triage.
   * Set from the violating policy's `violationSeverity`, defaulting to "medium".
   */
  severity: PolicyViolationSeverity;
}

// ---------------------------------------------------------------------------
// PolicyMatchDetail — per-policy evaluation trace entry
// ---------------------------------------------------------------------------

/**
 * A trace record for a single policy that was inspected during an evaluation run.
 *
 * PolicyMatchDetail entries are collected in PolicyEvaluationResult.evaluatedPolicies
 * in evaluation order. Together they form a complete, ordered audit trail of:
 *   - Which policies were considered
 *   - Which were skipped (scope miss)
 *   - Which matched (rule fired)
 *   - Which produced the terminal decision
 *
 * This trace supports debugging, policy-impact analysis, and compliance reporting.
 */
export interface PolicyMatchDetail {
  /** The policy that was evaluated. */
  policyId: PolicyId;
  /** Policy name at evaluation time (denormalized for readable traces). */
  policyName: string;
  /** The action this policy would apply if both scope and rule match. */
  action: GuardrailAction;

  /**
   * Whether the policy's scope filter passed for this request.
   * When false, the policy was skipped entirely (ruleMatched is meaningless).
   */
  scopeMatched: boolean;

  /**
   * Whether the policy's rule (conditions + thresholds) fired.
   * Only meaningful when scopeMatched === true.
   * When false, the policy matched scope but conditions prevented it from firing.
   */
  ruleMatched: boolean;

  /**
   * Whether this policy produced the terminal decision (halting action).
   * At most one PolicyMatchDetail per evaluation result will have applied === true.
   * False for non-halting actions (flag/rate-limit) even when they accumulated output.
   */
  applied: boolean;

  /**
   * The reason string from the policy's actionReason, if the rule matched.
   * Absent when the policy was skipped (scopeMatched === false).
   */
  reason?: string;

  /**
   * Violations produced during this policy's evaluation.
   * Present when ruleMatched === true and the action was deny or condition-checked.
   */
  violations?: PolicyViolation[];
}

// ---------------------------------------------------------------------------
// PolicyFlag — non-halting annotation
// ---------------------------------------------------------------------------

/**
 * An annotation produced by a `flag` or `rate-limit` policy action.
 *
 * Flags do not block execution — they accumulate alongside the final decision
 * and are surfaced in PolicyEvaluationResult.flags. The runtime is responsible
 * for routing flag notifications to the appropriate review or alerting channel.
 *
 * Multiple policies may produce flags in a single evaluation run; all accumulate.
 */
export interface PolicyFlag {
  /** Policy that produced this flag. */
  policyId: PolicyId;
  /** Policy name at evaluation time (denormalized). */
  policyName: string;
  /** Human-readable description of why this request was flagged. */
  reason: string;
  /**
   * When true, this flag is a stub for a rate-limit action.
   * A real rate-limit requires an external state adapter; this flag signals
   * that the rate-limit check was not enforced and must be handled externally.
   */
  isRateLimitStub?: boolean;
  /** Domain-specific extension fields. */
  metadata?: Metadata;
}

// ---------------------------------------------------------------------------
// GuardrailDecision — discriminated union of policy engine outcomes
// ---------------------------------------------------------------------------

/**
 * The request was explicitly permitted by a matching GuardrailPolicy.
 *
 * Produced when a policy with action "allow" matches the request.
 * The engine halts evaluation immediately — subsequent policies are not checked.
 */
export interface DecisionAllow {
  /** Discriminant. */
  outcome: "allow";
  /**
   * The policy that produced the allow decision.
   * Absent only when allow is the synthesized default (which should not happen
   * in a correctly configured policy set — prefer explicit allow policies).
   */
  policyId?: PolicyId;
  /** Human-readable justification from the policy's actionReason. */
  reason: string;
}

/**
 * The request was rejected by a matching GuardrailPolicy or by the fail-closed rule.
 *
 * Produced when:
 *   - A policy with action "deny" matches (code: EXPLICIT_DENY or CONDITION_FAILED)
 *   - No halting policy matched (code: NO_MATCHING_POLICY)
 *   - Confidence is below a required threshold (code: CONFIDENCE_BELOW_THRESHOLD)
 *   - A frame constraint was violated (code: FRAME_CONSTRAINT_VIOLATED)
 *   - A required entitlement is missing (code: ENTITLEMENT_MISSING)
 */
export interface DecisionDeny {
  /** Discriminant. */
  outcome: "deny";
  /** Machine-readable denial code for programmatic handling and metrics. */
  code: PolicyDenyCode;
  /** Human-readable explanation of the denial. */
  reason: string;
  /** Every violation that contributed to this denial. */
  violations: PolicyViolation[];
  /**
   * The policy that produced the deny decision.
   * Absent for NO_MATCHING_POLICY (no policy was responsible).
   */
  policyId?: PolicyId;
  /**
   * Actionable guidance for the caller.
   * Aggregated from the most severe violation's remediationHint, if any.
   */
  remediationHint?: string;
}

/**
 * The request is gated on human or system approval before it may proceed.
 *
 * Produced when a policy with action "require-approval" matches the request.
 * The caller must route to the approval workflow using `approvalConfig` and
 * wait for all `approvalRequirementIds` to be satisfied before re-submitting.
 */
export interface DecisionRequireApproval {
  /** Discriminant. */
  outcome: "require-approval";
  /** The policy that triggered the approval gate. */
  policyId: PolicyId;
  /** Human-readable reason for the approval requirement. */
  reason: string;
  /**
   * Approval routing and timeout configuration from the triggering policy.
   * The caller uses this to configure the approval workflow.
   */
  approvalConfig: PolicyApprovalConfig;
  /**
   * IDs of the frame's ApprovalRequirements that must be satisfied.
   * Sourced from PolicyFrameContext.approvalRequirements.
   * May contain synthetic IDs (prefix "synthetic:") when no frame requirement
   * exists but the policy mandates approval.
   */
  approvalRequirementIds: string[];
}

/**
 * The request may proceed, but has been annotated with one or more review flags.
 *
 * Produced when at least one `flag` or `rate-limit` policy matched and no
 * halting policy fired. The engine allows the request but the caller must
 * surface the flags for post-execution review and alerting.
 */
export interface DecisionFlag {
  /** Discriminant. */
  outcome: "flag";
  /** All accumulated flags from non-halting policy actions. */
  flags: PolicyFlag[];
  /** Aggregated reason string from all flag policies, joined by "; ". */
  reason: string;
}

/**
 * The policy engine's conclusion after evaluating all applicable policies.
 *
 * Discriminated on the `outcome` field. Use a switch statement to handle
 * each variant safely:
 *
 * ```typescript
 * switch (result.decision.outcome) {
 *   case "allow":            // proceed; result.decision.policyId has the allowing policy
 *   case "deny":             // reject; result.decision.violations has the detail
 *   case "require-approval": // gate; result.decision.approvalConfig has routing info
 *   case "flag":             // proceed with caution; result.decision.flags need surfacing
 * }
 * ```
 *
 * Note: the pipeline layer uses a string union `GuardrailDecision` in guardrail/types.ts.
 * This discriminated union is re-exported from the guardrail barrel as `PolicyDecision`
 * to prevent naming collision during the migration period.
 */
export type GuardrailDecision =
  | DecisionAllow
  | DecisionDeny
  | DecisionRequireApproval
  | DecisionFlag;

// ---------------------------------------------------------------------------
// Context objects — governance-relevant slices of runtime objects
// ---------------------------------------------------------------------------

/**
 * The governance-relevant slice of a Decision Frame, extracted for policy evaluation.
 *
 * The policy engine receives this focused context rather than the full DecisionFrame
 * (which may contain megabytes of retrieval results and telemetry snapshots).
 * This keeps PolicyEvaluationRequest serializable and keeps the engine contract
 * clean — the engine evaluates governance rules, not operational data.
 *
 * Extracted by the pipeline's policy stage from the full frame before building
 * a PolicyEvaluationRequest.
 */
export interface PolicyFrameContext {
  /** Stable ID of the Decision Frame. Included in audit records. */
  frameId: string;
  /**
   * When this frame expires. The engine may reject requests against an
   * expired frame even when `requiresApproval` is false.
   */
  expiresAt: ISOTimestamp;
  /** Principal (user, service account, or agent) on whose behalf the frame was issued. */
  principalId: PrincipalId;
  /**
   * Entitlement tokens the principal holds, snapshotted at frame-creation time.
   * Snapshotting prevents mid-flight revocations from affecting this evaluation.
   */
  entitlements: string[];
  /** Session this frame belongs to. */
  sessionId: string;
  /**
   * Capability IDs the AI is authorized to invoke within this frame.
   * The engine may check that the requested capability is in this set.
   */
  authorizedCapabilityIds: CapabilityId[];
  /**
   * Environment tag at frame-creation time.
   * Matched against PolicyScope.environments.
   * Examples: "production", "staging", "development".
   */
  environment?: string;
  /**
   * Version of the policy set that was active when this frame was created.
   * Included in AuditRecords for policy-impact forensics and rollback analysis.
   */
  policySetVersion?: string;
  /**
   * Minimum confidence floor declared by the frame's ExecutionConstraints.
   * The engine enforces this as a pre-rule check before policy evaluation begins.
   * When absent, no global floor is enforced (individual policy thresholds still apply).
   */
  confidenceFloor?: ConfidenceScore;
  /**
   * Frame-level policy constraints baked in by the Projection layer.
   * The engine evaluates these as structural constraints that must hold
   * regardless of which policies match.
   */
  policyConstraints: FramePolicyConstraint[];
  /**
   * Approval requirements already declared in the frame.
   * The engine uses these to populate DecisionRequireApproval.approvalRequirementIds.
   * Sourced from DecisionFrame.approvalRequirements at request-build time.
   */
  approvalRequirements: ApprovalRequirement[];
}

/**
 * The policy-relevant slice of a Capability definition.
 *
 * Extracted at evaluation time so the engine can evaluate scope (category, tags,
 * entitlements) and produce policy-scoped violations without receiving the full
 * Capability object (handler code, access patterns, JSON schemas, etc.).
 */
export interface PolicyCapabilityContext {
  /** The capability being requested. */
  capabilityId: CapabilityId;
  /** Semantic version of the capability being invoked. */
  version: string;
  /** Broad operational category. Matched against PolicyScope.capabilityCategories. */
  category: CapabilityCategory;
  /** Classification tags. Matched against PolicyScope.capabilityTags. */
  tags: string[];
  /**
   * Entitlements the invoking principal must hold.
   * The engine may add ENTITLEMENT_MISSING violations when these are absent
   * from PolicyFrameContext.entitlements.
   */
  requiredEntitlements: string[];
  /**
   * Whether this capability unconditionally requires approval.
   * When true, the engine emits a require-approval decision even if no matching
   * policy requires it — the capability's own contract takes precedence.
   */
  requiresApproval: boolean;
  /** Whether this capability is idempotent. Available to policy conditions. */
  idempotent: boolean;
  /** Whether this capability supports rollback. Available to policy conditions. */
  rollbackSupported: boolean;
}

// ---------------------------------------------------------------------------
// PolicyEvaluationRequest — structured input to the policy engine
// ---------------------------------------------------------------------------

/**
 * The complete, serializable input to the policy engine for a single evaluation run.
 *
 * Constructed by the pipeline's policy stage from GuardrailContext. Every field
 * the engine needs to evaluate `policies` and produce a `PolicyEvaluationResult`
 * is embedded here — no external I/O or runtime lookups are required inside
 * the engine.
 *
 * Portability guarantee: PolicyEvaluationRequest can be serialized to JSON
 * and sent to a remote policy service. Context objects (frame, capability)
 * are value copies, not references.
 *
 * Security constraint: MUST NOT contain credentials, connection strings,
 * database handles, raw HTTP clients, or any other system access surface.
 * Only governance-relevant metadata and the input payload belong here.
 *
 * Consumed by:
 *   - The built-in PolicyEngine implementation (engine.ts — forthcoming)
 *   - Remote policy services (via serialization)
 *   - Unit tests (construct directly to test engine behaviour)
 */
export interface PolicyEvaluationRequest {
  // -- Correlation --

  /**
   * Unique identifier for this evaluation run.
   * Matched in PolicyEvaluationResult.evaluationId.
   * UUID v4 recommended.
   */
  evaluationId: string;

  /**
   * ID of the ExecutionRequest being evaluated.
   * Propagated into PolicyEvaluationResult and AuditRecords.
   */
  executionRequestId: string;

  // -- Subject --

  /**
   * Governance context for the capability being requested.
   * Extracted from the full Capability at request-build time.
   */
  capability: PolicyCapabilityContext;

  /**
   * The validated input payload for the requested execution.
   * Available to policy conditions via field paths like "input.amount".
   * MUST NOT contain credentials or sensitive system values.
   */
  input: Record<string, unknown>;

  // -- Frame context --

  /**
   * Governance-relevant slice of the Decision Frame authorizing this request.
   * Includes entitlements, constraints, and approval requirements.
   */
  frame: PolicyFrameContext;

  // -- AI reasoning quality --

  /**
   * The AI model's self-reported confidence that this action is correct.
   * In [0.0, 1.0]. Evaluated against policy thresholds and PolicyFrameContext.confidenceFloor.
   */
  confidence: ConfidenceScore;

  /**
   * The AI model's explanation for why it is requesting this execution.
   * Available to policy conditions. Surfaced in audit records.
   */
  rationale?: string;

  // -- Policies to evaluate --

  /**
   * The GuardrailPolicy definitions to evaluate, sorted ascending by priority.
   * Lower priority number = evaluated first. The caller must pre-sort.
   * Only enabled policies should be included (disabled ones filtered by caller).
   */
  policies: GuardrailPolicy[];

  // -- Reference clock --

  /**
   * ISO-8601 timestamp used as the reference clock for expiry checks and
   * time-sensitive policy conditions.
   *
   * Set at request-build time (not inside the engine) to ensure deterministic
   * evaluation and to make the request reproducible for audit replay.
   */
  evaluatedAt: ISOTimestamp;

  // -- Extension --

  /** Domain-specific extension fields. */
  metadata?: Metadata;
}

// ---------------------------------------------------------------------------
// PolicyEvaluationResult — structured output of the policy engine
// ---------------------------------------------------------------------------

/**
 * The complete output of a policy engine evaluation run.
 *
 * Produced by the engine after evaluating all applicable policies in
 * PolicyEvaluationRequest.policies against the request context.
 *
 * Consumed by:
 *   - The pipeline's policy stage, which translates this to a StageResult
 *   - The audit layer, which captures violations and flags in AuditRecords
 *   - The runtime caller, which acts on decision.outcome
 *   - Operators debugging policy behaviour via evaluatedPolicies trace
 *
 * Completeness guarantee:
 *   `evaluatedPolicies` records every enabled policy that was inspected
 *   (including those that failed the scope check), providing a full trace.
 *   The order matches the evaluation order (ascending priority).
 *
 * Decision invariants:
 *   - decision.outcome === "allow"  → violations is empty
 *   - decision.outcome === "deny"   → decision.violations is non-empty
 *   - decision.outcome === "flag"   → flags is non-empty
 *   - terminatingPolicy is set      → decision.outcome is allow, deny, or require-approval
 */
export interface PolicyEvaluationResult {
  // -- Correlation --

  /** Matches PolicyEvaluationRequest.evaluationId. */
  evaluationId: string;
  /** Matches PolicyEvaluationRequest.executionRequestId. */
  executionRequestId: string;

  // -- Decision --

  /**
   * The policy engine's final conclusion.
   *
   * Discriminate on `decision.outcome` to safely access decision-specific fields:
   *   "allow"            → proceed with execution
   *   "deny"             → reject; inspect decision.code and decision.violations
   *   "require-approval" → gate; use decision.approvalConfig to route
   *   "flag"             → proceed; surface decision.flags to the review system
   */
  decision: GuardrailDecision;

  // -- Evaluation trace --

  /**
   * Ordered record of every enabled policy inspected during this run.
   * Includes policies that failed the scope check (scopeMatched === false)
   * and those that matched scope but did not fire (ruleMatched === false).
   *
   * Order: ascending by policy priority (matches evaluation order).
   *
   * Use this for:
   *   - Audit records explaining why a decision was made
   *   - Debugging which policy prevented an allow
   *   - Policy-impact analysis (which policies are actually firing?)
   */
  evaluatedPolicies: PolicyMatchDetail[];

  /**
   * The policy that produced the terminal decision, if any.
   *
   * Absent when:
   *   - decision.outcome === "deny" with code NO_MATCHING_POLICY
   *     (no policy fired a halting action — fail-closed synthetic denial)
   *   - decision.outcome === "flag"
   *     (non-halting: no single policy terminated evaluation)
   */
  terminatingPolicy?: PolicyMatchDetail;

  // -- Violations --

  /**
   * All policy violations accumulated during this evaluation run.
   *
   * Always empty when decision.outcome === "allow".
   * Non-empty when decision.outcome === "deny" or when individual conditions
   * breached during evaluation (even if evaluation continued past them).
   */
  violations: PolicyViolation[];

  // -- Flags --

  /**
   * Non-halting flags accumulated from `flag` and `rate-limit` policy actions.
   *
   * May be non-empty alongside any decision outcome — a request can be allowed
   * AND flagged if a flag policy matched before an allow policy fired.
   */
  flags: PolicyFlag[];

  // -- Confidence assessment --

  /**
   * Summary of how the request's confidence compared to policy thresholds.
   * Present when at least one policy threshold or confidenceFloor was evaluated.
   */
  confidenceAssessment?: {
    /** The confidence value from the request. */
    requestedConfidence: ConfidenceScore;
    /**
     * The strictest (lowest) threshold evaluated across all policies and the frame floor.
     * Absent if no threshold was evaluated.
     */
    minimumRequired?: ConfidenceScore;
    /** Whether the request's confidence met all evaluated thresholds and the frame floor. */
    passed: boolean;
  };

  // -- Timing --

  /** ISO-8601 timestamp when the evaluation completed. */
  evaluatedAt: ISOTimestamp;
  /** Wall-clock duration of the evaluation in milliseconds. */
  evaluationDurationMs: number;

  // -- Extension --

  /** Domain-specific extension fields. */
  metadata?: Metadata;
}
