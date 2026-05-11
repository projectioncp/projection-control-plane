/**
 * Guardrail Policy Engine — Zod Validation Schemas
 *
 * Runtime validation schemas for every interface defined in types.ts.
 *
 * The interfaces in types.ts are the authoritative static types.
 * These schemas enforce them at runtime: API ingress, registry registration,
 * policy store deserialization, and remote policy service round-trips.
 *
 * Composition order (bottom-up):
 *   primitives
 *   → vocabulary enum schemas
 *   → scope / condition / threshold / rule schemas
 *   → action config schemas
 *   → GuardrailPolicySchema (root policy definition)
 *   → PolicyViolationSchema, PolicyFlagSchema, PolicyMatchDetailSchema
 *   → decision variant schemas → GuardrailDecisionSchema (discriminated union)
 *   → context schemas (PolicyFrameContextSchema, PolicyCapabilityContextSchema)
 *   → PolicyEvaluationRequestSchema
 *   → PolicyEvaluationResultSchema
 *
 * Note on z.ZodType<T> annotations:
 *   Under exactOptionalPropertyTypes, Zod's internal _type for optional
 *   object fields is `T | undefined` (required key form), while TypeScript
 *   interfaces use `{ key?: T }` (optional key form). These are incompatible
 *   under z.ZodType<T> annotations on object schemas. Therefore:
 *     - z.ZodType<T> is used ONLY on vocabulary enum schemas.
 *     - Object schemas are left as inferred types.
 *     - z.discriminatedUnion requires raw ZodObject members, not ZodType<T> wrappers.
 *
 * Cross-field business rules (e.g. minimumApprovers ≤ approverRoles.length,
 * requiresApproval → approvalConfig present) are NOT enforced here — they
 * belong in a separate validate.ts for the policy layer.
 */

import { z } from "zod";
import {
  ApprovalRequirementSchema,
  CapabilityCategorySchema,
  ConfidenceScoreSchema,
  ConstraintOperatorSchema,
  FramePolicyConstraintSchema,
  ISOTimestampSchema,
  MetadataSchema,
} from "../../projection/frame.schema.js";
import type {
  GuardrailAction,
  PolicyDenyCode,
  PolicyViolationKind,
  PolicyViolationSeverity,
} from "./types.js";

// ---------------------------------------------------------------------------
// Local primitive schemas
// ---------------------------------------------------------------------------

export const PolicyIdSchema = z
  .string()
  .min(1, "policyId must not be empty")
  .describe("Stable policy identifier");

export const SemverSchema = z
  .string()
  .min(1, "version must not be empty")
  .describe("Semantic version string (e.g. '1.0.0')");

export const CapabilityIdSchema = z
  .string()
  .min(1, "capabilityId must not be empty")
  .describe("Stable capability identifier");

export const NonNegativeIntSchema = z.number().int().nonnegative();
export const PositiveIntSchema = z.number().int().positive();

// Re-export imported schemas under consistent local names.
export {
  ISOTimestampSchema,
  ConfidenceScoreSchema,
  MetadataSchema,
  ConstraintOperatorSchema,
  CapabilityCategorySchema,
  FramePolicyConstraintSchema,
  ApprovalRequirementSchema,
};

// ---------------------------------------------------------------------------
// Vocabulary enum schemas
// Note: z.ZodType<T> annotations are used ONLY for enum/union types.
// ---------------------------------------------------------------------------

export const GuardrailActionSchema: z.ZodType<GuardrailAction> = z.enum([
  "allow",
  "deny",
  "require-approval",
  "flag",
  "rate-limit",
]);

export const PolicyDenyCodeSchema: z.ZodType<PolicyDenyCode> = z.enum([
  "EXPLICIT_DENY",
  "NO_MATCHING_POLICY",
  "CONFIDENCE_BELOW_THRESHOLD",
  "ENTITLEMENT_MISSING",
  "SCOPE_EXCLUDED",
  "FRAME_CONSTRAINT_VIOLATED",
  "CONDITION_FAILED",
]);

export const PolicyViolationKindSchema: z.ZodType<PolicyViolationKind> = z.enum([
  "condition-failed",
  "threshold-breached",
  "entitlement-missing",
  "scope-excluded",
  "frame-constraint",
]);

export const PolicyViolationSeveritySchema: z.ZodType<PolicyViolationSeverity> = z.enum([
  "low",
  "medium",
  "high",
  "critical",
]);

// ---------------------------------------------------------------------------
// PolicyScope
// ---------------------------------------------------------------------------

export const PolicyScopeSchema = z
  .object({
    capabilityIds: z
      .array(CapabilityIdSchema)
      .optional()
      .describe("Specific capability IDs this policy targets"),
    capabilityCategories: z
      .array(CapabilityCategorySchema)
      .optional()
      .describe("Capability categories this policy targets"),
    capabilityTags: z
      .array(z.string().min(1))
      .optional()
      .describe("Capability tags that must ALL be present"),
    environments: z
      .array(z.string().min(1))
      .optional()
      .describe("Environment tags where this policy is active"),
    principalPatterns: z
      .array(z.string().min(1))
      .optional()
      .describe("Principal ID regex patterns (at least one must match)"),
    requiredEntitlements: z
      .array(z.string().min(1))
      .optional()
      .describe("Entitlements that must ALL be present on the principal"),
  })
  .describe("Scope filters controlling which requests this policy evaluates");

// ---------------------------------------------------------------------------
// PolicyCondition and PolicyThreshold
// ---------------------------------------------------------------------------

export const PolicyConditionSchema = z
  .object({
    field: z
      .string()
      .min(1, "condition.field must not be empty")
      .describe("Dot-notation path to the field on PolicyEvaluationRequest"),
    operator: ConstraintOperatorSchema,
    value: z.unknown().optional().describe("Expected value for the comparison"),
    description: z.string().optional().describe("Human-readable condition description"),
  })
  .describe("Single evaluable predicate in a policy rule");

export const PolicyThresholdSchema = z
  .object({
    field: z
      .string()
      .min(1, "threshold.field must not be empty")
      .describe("Dot-notation path to the scalar field being guarded"),
    operator: ConstraintOperatorSchema.describe(
      "Threshold direction (gte = must be at least; lte = must be at most)"
    ),
    value: z.number().describe("The threshold value"),
    description: z.string().optional().describe("Human-readable threshold description"),
  })
  .describe("Scalar guard on an ordered numeric or confidence value");

// ---------------------------------------------------------------------------
// PolicyRule
// ---------------------------------------------------------------------------

export const PolicyRuleSchema = z
  .object({
    conditions: z
      .array(PolicyConditionSchema)
      .describe("Conditions that must ALL be true for the rule to fire (AND; empty = always fires)"),
    thresholds: z
      .array(PolicyThresholdSchema)
      .optional()
      .describe("Threshold guards evaluated after conditions"),
  })
  .describe("Composed evaluable rule body of a GuardrailPolicy");

// ---------------------------------------------------------------------------
// Action configuration schemas
// ---------------------------------------------------------------------------

export const PolicyApprovalConfigSchema = z
  .object({
    approverRoles: z
      .array(z.string().min(1))
      .min(1, "At least one approver role is required")
      .describe("Roles that may approve requests gated by this policy"),
    minimumApprovers: PositiveIntSchema.describe(
      "Minimum distinct approvers required (≥ 1 and ≤ approverRoles.length)"
    ),
    timeoutMs: PositiveIntSchema.describe("Maximum wait time for approval in milliseconds"),
    denyOnTimeout: z
      .boolean()
      .describe("When true, automatically deny the request if approval is not received in time"),
    escalationPolicyId: z
      .string()
      .min(1)
      .optional()
      .describe("ID of the escalation policy to invoke on denial or timeout"),
  })
  .describe("Approval routing configuration for require-approval policy actions");

export const PolicyRateLimitConfigSchema = z
  .object({
    maxRequests: PositiveIntSchema.describe("Maximum invocations allowed per window"),
    windowMs: PositiveIntSchema.describe("Window duration in milliseconds"),
    strategy: z
      .enum(["fixed-window", "sliding-window", "token-bucket"])
      .describe("Rate limiting algorithm"),
    keyBy: z
      .enum(["global", "principalId", "capabilityId", "sessionId"])
      .optional()
      .describe("Counter partitioning key (absent = global)"),
  })
  .describe("Rate limit configuration for rate-limit policy actions");

// ---------------------------------------------------------------------------
// GuardrailPolicy (root policy definition)
// ---------------------------------------------------------------------------

export const GuardrailPolicySchema = z
  .object({
    // -- Identity --
    policyId: PolicyIdSchema,
    name: z.string().min(1, "policy.name must not be empty"),
    description: z.string().optional(),
    version: SemverSchema,

    // -- Evaluation order --
    priority: z.number().int().describe("Evaluation priority (lower = evaluated first)"),

    // -- Lifecycle --
    enabled: z.boolean().describe("Whether this policy participates in evaluation"),
    deprecatedAt: ISOTimestampSchema.optional(),

    // -- Scope --
    scope: PolicyScopeSchema,

    // -- Rule --
    rule: PolicyRuleSchema,

    // -- Action --
    action: GuardrailActionSchema,
    actionReason: z.string().optional(),

    // -- Action configuration --
    approvalConfig: PolicyApprovalConfigSchema.optional().describe(
      "Required when action === 'require-approval'"
    ),
    rateLimitConfig: PolicyRateLimitConfigSchema.optional().describe(
      "Required when action === 'rate-limit'"
    ),

    // -- Violation classification --
    violationSeverity: PolicyViolationSeveritySchema.optional().describe(
      "Severity assigned to violations from this policy (default: 'medium')"
    ),

    // -- Ownership --
    owner: z.string().min(1, "policy.owner must not be empty"),
    createdAt: ISOTimestampSchema,
    updatedAt: ISOTimestampSchema,
    tags: z.array(z.string().min(1)).optional(),
    metadata: MetadataSchema.optional(),
  })
  .describe("A governance rule governing whether an execution request may proceed");

export type GuardrailPolicyOutput = z.output<typeof GuardrailPolicySchema>;
export type GuardrailPolicyInput = z.input<typeof GuardrailPolicySchema>;

// ---------------------------------------------------------------------------
// PolicyViolation
// ---------------------------------------------------------------------------

export const PolicyViolationSchema = z
  .object({
    violationId: z.string().min(1, "violation.violationId must not be empty"),
    policyId: PolicyIdSchema,
    policyName: z.string().min(1),
    kind: PolicyViolationKindSchema,
    field: z.string().min(1).optional(),
    // Must NOT contain credentials or PII.
    actualValue: z.unknown().optional(),
    expectedValue: z.unknown().optional(),
    message: z.string().min(1, "violation.message must not be empty"),
    remediationHint: z.string().optional(),
    severity: PolicyViolationSeveritySchema,
  })
  .describe("Structured record of a single policy rule breach");

// ---------------------------------------------------------------------------
// PolicyFlag
// ---------------------------------------------------------------------------

export const PolicyFlagSchema = z
  .object({
    policyId: PolicyIdSchema,
    policyName: z.string().min(1),
    reason: z.string().min(1),
    isRateLimitStub: z.boolean().optional(),
    metadata: MetadataSchema.optional(),
  })
  .describe("Non-halting annotation produced by a flag or rate-limit policy action");

// ---------------------------------------------------------------------------
// PolicyMatchDetail
// ---------------------------------------------------------------------------

export const PolicyMatchDetailSchema = z
  .object({
    policyId: PolicyIdSchema,
    policyName: z.string().min(1),
    action: GuardrailActionSchema,
    scopeMatched: z.boolean(),
    ruleMatched: z.boolean(),
    applied: z.boolean(),
    reason: z.string().optional(),
    violations: z.array(PolicyViolationSchema).optional(),
  })
  .describe("Trace record for a single policy inspected during an evaluation run");

// ---------------------------------------------------------------------------
// GuardrailDecision — discriminated union
//
// z.discriminatedUnion requires raw ZodObject members (not ZodType<T> wrappers).
// The variant schemas must remain as plain z.object() to satisfy this constraint.
// ---------------------------------------------------------------------------

export const DecisionAllowSchema = z
  .object({
    outcome: z.literal("allow"),
    policyId: PolicyIdSchema.optional(),
    reason: z.string().min(1),
  })
  .describe("The request was explicitly permitted by a matching policy");

export const DecisionDenySchema = z
  .object({
    outcome: z.literal("deny"),
    code: PolicyDenyCodeSchema,
    reason: z.string().min(1),
    violations: z.array(PolicyViolationSchema),
    policyId: PolicyIdSchema.optional(),
    remediationHint: z.string().optional(),
  })
  .describe("The request was rejected by a matching policy or by the fail-closed rule");

export const DecisionRequireApprovalSchema = z
  .object({
    outcome: z.literal("require-approval"),
    policyId: PolicyIdSchema,
    reason: z.string().min(1),
    approvalConfig: PolicyApprovalConfigSchema,
    approvalRequirementIds: z.array(z.string().min(1)),
  })
  .describe("The request is gated on human or system approval before it may proceed");

export const DecisionFlagSchema = z
  .object({
    outcome: z.literal("flag"),
    flags: z.array(PolicyFlagSchema).min(1, "A flag decision must carry at least one flag"),
    reason: z.string().min(1),
  })
  .describe("The request may proceed but has been annotated with review flags");

/**
 * Zod schema for the GuardrailDecision discriminated union.
 * Discriminant field: "outcome".
 *
 * Note: not annotated with z.ZodType<GuardrailDecision> — see file-level comment.
 */
export const GuardrailDecisionSchema = z
  .discriminatedUnion("outcome", [
    DecisionAllowSchema,
    DecisionDenySchema,
    DecisionRequireApprovalSchema,
    DecisionFlagSchema,
  ])
  .describe("The policy engine's conclusion after evaluating all applicable policies");

export type GuardrailDecisionOutput = z.output<typeof GuardrailDecisionSchema>;

// ---------------------------------------------------------------------------
// Context schemas
// ---------------------------------------------------------------------------

export const PolicyCapabilityContextSchema = z
  .object({
    capabilityId: CapabilityIdSchema,
    version: SemverSchema,
    category: CapabilityCategorySchema,
    tags: z.array(z.string().min(1)),
    requiredEntitlements: z.array(z.string().min(1)),
    requiresApproval: z.boolean(),
    idempotent: z.boolean(),
    rollbackSupported: z.boolean(),
  })
  .describe("Policy-relevant slice of a Capability definition");

export const PolicyFrameContextSchema = z
  .object({
    frameId: z.string().min(1, "frame.frameId must not be empty"),
    expiresAt: ISOTimestampSchema,
    principalId: z.string().min(1, "frame.principalId must not be empty"),
    entitlements: z.array(z.string().min(1)),
    sessionId: z.string().min(1, "frame.sessionId must not be empty"),
    authorizedCapabilityIds: z.array(CapabilityIdSchema),
    environment: z.string().min(1).optional(),
    policySetVersion: z.string().min(1).optional(),
    confidenceFloor: ConfidenceScoreSchema.optional(),
    policyConstraints: z.array(FramePolicyConstraintSchema),
    approvalRequirements: z.array(ApprovalRequirementSchema),
  })
  .describe("Governance-relevant slice of a Decision Frame for policy evaluation");

// ---------------------------------------------------------------------------
// PolicyEvaluationRequest
// ---------------------------------------------------------------------------

export const PolicyEvaluationRequestSchema = z
  .object({
    evaluationId: z.string().min(1, "evaluationId must not be empty"),
    executionRequestId: z.string().min(1, "executionRequestId must not be empty"),
    capability: PolicyCapabilityContextSchema,
    input: z.record(z.string().min(1), z.unknown()),
    frame: PolicyFrameContextSchema,
    confidence: ConfidenceScoreSchema,
    rationale: z.string().optional(),
    policies: z
      .array(GuardrailPolicySchema)
      .describe("Sorted enabled GuardrailPolicy definitions (ascending priority)"),
    evaluatedAt: ISOTimestampSchema,
    metadata: MetadataSchema.optional(),
  })
  .describe("Complete, serializable input to the policy engine for a single evaluation run");

export type PolicyEvaluationRequestOutput = z.output<typeof PolicyEvaluationRequestSchema>;
export type PolicyEvaluationRequestInput = z.input<typeof PolicyEvaluationRequestSchema>;

// ---------------------------------------------------------------------------
// PolicyEvaluationResult
// ---------------------------------------------------------------------------

const ConfidenceAssessmentSchema = z.object({
  requestedConfidence: ConfidenceScoreSchema,
  minimumRequired: ConfidenceScoreSchema.optional(),
  passed: z.boolean(),
});

export const PolicyEvaluationResultSchema = z
  .object({
    evaluationId: z.string().min(1),
    executionRequestId: z.string().min(1),
    decision: GuardrailDecisionSchema,
    evaluatedPolicies: z.array(PolicyMatchDetailSchema),
    terminatingPolicy: PolicyMatchDetailSchema.optional(),
    violations: z.array(PolicyViolationSchema),
    flags: z.array(PolicyFlagSchema),
    confidenceAssessment: ConfidenceAssessmentSchema.optional(),
    evaluatedAt: ISOTimestampSchema,
    evaluationDurationMs: NonNegativeIntSchema,
    metadata: MetadataSchema.optional(),
  })
  .describe("Complete output of a policy engine evaluation run");

export type PolicyEvaluationResultOutput = z.output<typeof PolicyEvaluationResultSchema>;
