/**
 * Audit Layer — Public API
 *
 * Entry point for all audit framework exports.
 *
 * Three modules make up the audit layer:
 *
 *   types.ts  — core types (events, records, trails, traces)
 *   schema.ts — Zod validation for all serializable audit types
 *
 * Architecture:
 *
 *   AuditEvent      — discriminated union (16 variants) of typed event payloads
 *   AuditRecord     — immutable governance event record with hash chain
 *   AuditTrail      — scoped, ordered collection with cryptographic sealing
 *   ExecutionTrace  — end-to-end synthesis of all phases of one execution
 *
 * Deprecation:
 *   The draft `AuditRecord`, `AuditEventType`, and `AuditOutcome` in
 *   `src/types.ts` are superseded by this module. Migrate to:
 *
 *     import type { AuditRecord, AuditEventType, AuditOutcome }
 *       from "projection-control-plane/audit";
 *
 * Typical usage — recording a guardrail decision:
 *
 *   import type { AuditRecord } from "projection-control-plane/audit";
 *   import { createAuditRecord } from "projection-control-plane/audit";
 *
 *   const record = createAuditRecord({
 *     recordId:        crypto.randomUUID(),
 *     traceId:         ctx.traceId,
 *     spanId:          crypto.randomUUID(),
 *     parentSpanId:    ctx.frameSpanId,
 *     sequenceNumber:  ctx.nextSequence(),
 *     timestamp:       new Date().toISOString(),
 *     outcome:         result.decision === "allow" ? "approved" : "denied",
 *     actor: {
 *       principalId: ctx.principalId,
 *       sessionId:   ctx.sessionId,
 *     },
 *     frameId:            ctx.frameId,
 *     executionRequestId: ctx.executionRequestId,
 *     event: {
 *       type:                 "guardrail-evaluated",
 *       executionRequestId:   ctx.executionRequestId,
 *       frameId:              ctx.frameId,
 *       decision:             result.decision,
 *       stagesRan:            result.stageResults.map(s => s.stage),
 *       denyCode:             result.denyCode,
 *       denyReason:           result.denyReason,
 *       flags:                result.flags,
 *       evaluationDurationMs: result.totalDurationMs,
 *     },
 *   });
 *
 * Typical usage — validating a record from an untrusted source:
 *
 *   import { AuditRecordSchema } from "projection-control-plane/audit";
 *
 *   const parsed = AuditRecordSchema.safeParse(raw);
 *   if (!parsed.success) {
 *     throw new Error(`Invalid audit record: ${parsed.error.message}`);
 *   }
 *   const record: AuditRecordOutput = parsed.data;
 *
 * Typical usage — narrowing an AuditEvent:
 *
 *   switch (record.event.type) {
 *     case "guardrail-evaluated":
 *       // record.event is GuardrailEvaluatedEvent — fully typed
 *       console.log(record.event.decision, record.event.denyCode);
 *       break;
 *     case "capability-executed":
 *       // record.event is CapabilityExecutedEvent — fully typed
 *       console.log(record.event.status, record.event.durationMs);
 *       break;
 *   }
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type {
  // Primitive aliases
  AuditRecordId,
  TraceId,
  SpanId,

  // Vocabulary unions
  AuditEventType,
  AuditOutcome,
  AuditTrailScope,
  AuditTrailStatus,
  ApprovalResolution,
  RollbackOutcome,
  ExecutionOutcome,

  // Actor
  AuditActor,

  // Event variants — frame lifecycle
  FrameCreatedEvent,
  FrameExpiredEvent,

  // Event variants — execution request
  ExecutionRequestedEvent,

  // Event variants — guardrail pipeline
  GuardrailEvaluatedEvent,
  PolicyEvaluatedEvent,

  // Event variants — authorization
  EntitlementDeniedEvent,
  PolicyViolationEvent,

  // Event variants — approval workflow
  ApprovalRequestedEvent,
  ApprovalGrantedEvent,
  ApprovalDeniedEvent,

  // Event variants — capability execution
  CapabilityExecutedEvent,
  ExecutionFailedEvent,
  ExecutionTimedOutEvent,

  // Event variants — rollback
  RollbackInitiatedEvent,
  RollbackCompletedEvent,

  // Event variants — hook lifecycle
  HookTriggeredEvent,

  // Discriminated union
  AuditEvent,

  // Core record
  AuditRecord,

  // Trail
  AuditTrailSummary,
  AuditTrail,

  // ExecutionTrace phase types
  ProjectionPhaseTrace,
  GuardrailPhaseTrace,
  ApprovalPhaseTrace,
  CapabilityPhaseTrace,
  RollbackPhaseTrace,
  HookExecutionSummary,

  // ExecutionTrace
  ExecutionTrace,
} from "./types.js";

// ---------------------------------------------------------------------------
// Zod validation schemas (runtime values)
// ---------------------------------------------------------------------------

export {
  // Re-exported canonical schemas
  ISOTimestampSchema,
  MetadataSchema,
  ConfidenceScoreSchema,
  FrameTriggerSourceSchema,

  // Local primitive schemas
  AuditRecordIdSchema,
  TraceIdSchema,
  SpanIdSchema,
  CapabilityIdSchema,
  FrameIdSchema,
  PositiveIntSchema,

  // Vocabulary enum schemas
  AuditEventTypeSchema,
  AuditOutcomeSchema,
  AuditTrailScopeSchema,
  AuditTrailStatusSchema,
  ApprovalResolutionSchema,
  RollbackOutcomeSchema,
  ExecutionOutcomeSchema,

  // Local guardrail pipeline schemas (no schema in guardrail module yet)
  GuardrailPipelineDecisionSchema,
  GuardrailDenyCodeSchema,
  StageNameSchema,
  GuardrailFlagSchema,

  // Actor
  AuditActorSchema,

  // Event variant schemas (raw ZodObject — for discriminatedUnion composition)
  FrameCreatedEventSchema,
  FrameExpiredEventSchema,
  ExecutionRequestedEventSchema,
  GuardrailEvaluatedEventSchema,
  PolicyEvaluatedEventSchema,
  EntitlementDeniedEventSchema,
  PolicyViolationEventSchema,
  ApprovalRequestedEventSchema,
  ApprovalGrantedEventSchema,
  ApprovalDeniedEventSchema,
  CapabilityExecutedEventSchema,
  ExecutionFailedEventSchema,
  ExecutionTimedOutEventSchema,
  RollbackInitiatedEventSchema,
  RollbackCompletedEventSchema,
  HookTriggeredEventSchema,

  // Discriminated union
  AuditEventSchema,

  // Core record
  AuditRecordSchema,

  // Trail
  AuditTrailSummarySchema,
  AuditTrailSchema,

  // Phase trace schemas
  ProjectionPhaseTraceSchema,
  GuardrailPhaseTraceSchema,
  ApprovalPhaseTraceSchema,
  CapabilityPhaseTraceSchema,
  RollbackPhaseTraceSchema,
  HookExecutionSummarySchema,

  // ExecutionTrace
  ExecutionTraceSchema,
} from "./schema.js";

export type {
  AuditActorOutput,
  AuditEventOutput,
  AuditRecordOutput,
  AuditRecordInput,
  AuditTrailSummaryOutput,
  AuditTrailOutput,
  AuditTrailInput,
  ProjectionPhaseTraceOutput,
  GuardrailPhaseTraceOutput,
  ApprovalPhaseTraceOutput,
  CapabilityPhaseTraceOutput,
  RollbackPhaseTraceOutput,
  HookExecutionSummaryOutput,
  ExecutionTraceOutput,
  ExecutionTraceInput,
} from "./schema.js";

// ---------------------------------------------------------------------------
// Factory helper — type-safe AuditRecord construction
// ---------------------------------------------------------------------------

import type { AuditRecord } from "./types.js";

/**
 * Construct a type-safe AuditRecord.
 *
 * This is a pure identity function — zero runtime cost. Its value is that
 * TypeScript will validate the full AuditRecord shape at the call site,
 * including narrowing the `event` field to the correct AuditEvent variant.
 *
 * Callers are responsible for:
 *   - Generating unique `recordId` and `spanId` values (crypto.randomUUID())
 *   - Maintaining the `sequenceNumber` counter per trace
 *   - Computing and linking `checksum` and `previousChecksum` for tamper evidence
 *   - Setting `parentSpanId` to the spanId of the causally preceding record
 *
 * @example
 *   const record = createAuditRecord({
 *     recordId:       crypto.randomUUID(),
 *     traceId:        traceId,
 *     spanId:         crypto.randomUUID(),
 *     parentSpanId:   frameSpanId,
 *     sequenceNumber: 3,
 *     timestamp:      new Date().toISOString(),
 *     outcome:        "denied",
 *     actor:          { principalId, sessionId },
 *     frameId:        frameId,
 *     executionRequestId: requestId,
 *     event: {
 *       type:                 "guardrail-evaluated",
 *       executionRequestId:   requestId,
 *       frameId:              frameId,
 *       decision:             "deny",
 *       stagesRan:            ["authorization", "policy"],
 *       denyCode:             "POLICY_DENY",
 *       denyReason:           "Matched policy: restrict-financial-ops",
 *       flags:                [],
 *       evaluationDurationMs: 12,
 *       policyId:             "pol:restrict-financial-ops",
 *     },
 *   });
 */
export function createAuditRecord(record: AuditRecord): AuditRecord {
  return record;
}
