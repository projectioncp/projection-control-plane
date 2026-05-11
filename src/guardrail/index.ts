/**
 * Guardrail Layer — Public API
 *
 * Everything a caller needs to run an ExecutionRequest through the Guardrail
 * pipeline and act on the result.
 *
 * Typical usage:
 *
 *   import {
 *     GuardrailPipeline,
 *     type GuardrailResult,
 *   } from "projection-control-plane/guardrail";
 *
 *   const pipeline = new GuardrailPipeline();          // default 4 stages
 *
 *   const result = await pipeline.evaluate({
 *     request,    // ExecutionRequest from the AI reasoning layer
 *     frame,      // DecisionFrame (must be validated first)
 *     capability, // the Capability being requested
 *     policies,   // sorted GuardrailPolicy[] (ascending priority)
 *   });
 *
 *   switch (result.decision) {
 *     case "allow":
 *       await execute(request, capability);
 *       break;
 *     case "deny":
 *       throw new Error(result.denyReason);
 *     case "require-approval":
 *       await routeToApproval(result.approvalRequirementIds!);
 *       break;
 *     case "flag":
 *       await execute(request, capability);          // proceeds, but flagged
 *       await alertOnCall(result.flags);
 *       break;
 *   }
 *
 *   await persistAuditRecords(result.auditRecords);   // always
 */

// Pipeline
export { GuardrailPipeline, DEFAULT_STAGES } from "./pipeline.js";
export type { GuardrailEvaluateInput } from "./pipeline.js";

// Types
export type {
  GuardrailDenyCode,
  StageName,
  StageVerdict,
  VerdictPass,
  VerdictDeny,
  VerdictRequireApproval,
  VerdictFlag,
  StageResult,
  GuardrailContext,
  GuardrailDecision,
  GuardrailFlag,
  GuardrailResult,
  GuardrailStageFn,
  GuardrailPipelineOptions,
} from "./types.js";

// Condition evaluator — exported for custom stage authors
export {
  evaluateCondition,
  evaluateConditions,
  findFailingCondition,
  getFieldValue,
  evalOperator,
} from "./condition.js";
export type { EvaluableCondition, EvalOperator } from "./condition.js";

// Audit factories — exported for custom stage authors and audit consumers
export {
  createGuardrailEvaluatedRecord,
  createPolicyViolationRecord,
  createApprovalRequestedRecord,
  createAuthorizationDeniedRecord,
  createConstraintViolationRecord,
} from "./audit.js";

// Individual stages — exported for testing and composition
export { runAuthorizationStage } from "./stages/authorization.js";
export { runPolicyStage } from "./stages/policy.js";
export { runConstraintsStage } from "./stages/constraints.js";
export { runApprovalStage } from "./stages/approval.js";
