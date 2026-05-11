/**
 * Mock Execution Data — Projection Control Plane UI Demo
 *
 * Three manufacturing / supply-chain scenarios that demonstrate why
 * Projection exists: cross-domain operational reasoning under governance.
 *
 * Scenario A — Engineering Change Impact Analysis  (allow → success)
 * Scenario B — Safety Stock Reallocation           (require-approval → pending)
 * Scenario C — BOM Export Control Violation        (deny → blocked)
 */

export type PipelineStatus =
  | "completed"
  | "denied"
  | "awaiting-approval"
  | "failed"
  | "pending";

export type GuardrailDecision =
  | "allow"
  | "deny"
  | "require-approval"
  | "flag";

export type CapabilityStatus =
  | "success"
  | "failed"
  | "pending"
  | "denied"
  | "awaiting-approval";

export interface MockRequest {
  id: string;
  principalId: string;
  sessionId: string;
  conversationId: string;
  userMessage: string;
  timestamp: string;
  model: string;
}

/** Key operational facts surfaced into the bounded frame. */
export interface FrameContextItem {
  label: string;
  value: string;
}

export interface MockProjectionFrame {
  frameId: string;
  intent: {
    category: string;
    summary: string;
    confidence: number;
    rawIntent: string;
  };
  /** Bounded operational context — what the AI is permitted to see. */
  operationalContext: FrameContextItem[];
  authorizedCapabilities: Array<{
    id: string;
    name: string;
    category: string;
  }>;
  constraints: Array<{
    field: string;
    operator: string;
    value: string | number | boolean;
  }>;
  approvalRequirements: Array<{
    id: string;
    trigger: string;
    approverRole: string;
    reason: string;
  }>;
  durationMs: number;
}

export interface MockGuardrailStage {
  name: string;
  label: string;
  durationMs: number;
  passed: boolean;
  detail?: string;
}

export interface MockGuardrailResult {
  decision: GuardrailDecision;
  stagesEvaluated: MockGuardrailStage[];
  violations: Array<{ policy: string; severity: string; message: string }>;
  flags: Array<{ reason: string; reviewQueue: string }>;
  totalDurationMs: number;
  governanceSummary: string;
}

export interface MockCapabilityResult {
  capabilityId: string;
  capabilityName: string;
  category: string;
  status: CapabilityStatus;
  durationMs: number;
  output?: Record<string, string | number | boolean>;
  approvalGateId?: string;
  approvalStatus?: string;
}

export interface MockAuditEvent {
  eventId: string;
  type: string;
  outcome: string;
  timestamp: string;
  durationMs?: number;
  actor: string;
  detail: string;
  spanId: string;
}

export interface ExecutionScenario {
  id: string;
  label: string;
  description: string;
  overallStatus: PipelineStatus;
  totalDurationMs: number;
  request: MockRequest;
  projectionFrame: MockProjectionFrame;
  guardrailResult: MockGuardrailResult;
  capabilityResult: MockCapabilityResult;
  auditEvents: MockAuditEvent[];
}

// ---------------------------------------------------------------------------
// Scenario A — Engineering Change Impact Analysis
// Guardrail: allow   →   Capability: success
//
// An engineer triggers a cross-domain impact assessment for a component
// replacement. The Projection Frame bounds the AI to the change order scope,
// authorized plants, and read-only analytical capabilities. Guardrail clears
// all four operational governance checks. The BOM analysis capability runs
// deterministically and surfaces cross-domain impact data.
// ---------------------------------------------------------------------------

const SCENARIO_A: ExecutionScenario = {
  id: "exec-ec0441a1",
  label: "Change Impact",
  description: "ECO-2026-0441 — CMP-204 replacement analysis",
  overallStatus: "completed",
  totalDurationMs: 1240,

  request: {
    id: "req-7c3f9a01",
    principalId: "principal-diaz@mfg.corp",
    sessionId: "sess-a1b2c3d4",
    conversationId: "conv-e5f6a7b8",
    userMessage:
      "Engineering change replaces component CMP-204 with CMP-204R under ECO-2026-0441. Show downstream production, supplier, inventory, and cost impact.",
    timestamp: "2026-05-11T09:14:00.000Z",
    model: "claude-opus-4-5",
  },

  projectionFrame: {
    frameId: "frame-4d8b2e1a",
    intent: {
      category: "operational-impact-analysis",
      summary:
        "Assess downstream impact of engineering change ECO-2026-0441 across BOM, production, supply chain, inventory, and cost domains.",
      confidence: 0.96,
      rawIntent: "engineering change CMP-204 replacement downstream impact",
    },
    operationalContext: [
      { label: "Change Order",      value: "ECO-2026-0441" },
      { label: "Component",         value: "CMP-204 → CMP-204R" },
      { label: "Affected BOMs",     value: "FIN-ASSY-001 · SUB-ASSY-412 · PCBA-7710" },
      { label: "Impacted Products", value: "3 product lines" },
      { label: "Plants in Scope",   value: "PLANT-03 (Detroit) · PLANT-07 (Stuttgart)" },
      { label: "Work Orders",       value: "7 in-flight" },
      { label: "Suppliers",         value: "SUP-Kenosha · SUP-Munich · SUP-Taipei" },
      { label: "Cost Exposure",     value: "$2.4M" },
    ],
    authorizedCapabilities: [
      { id: "cap-bom-impact",         name: "analyze-bom-impact",            category: "bom-analysis" },
      { id: "cap-inventory-exposure", name: "query-inventory-exposure",       category: "inventory" },
      { id: "cap-production-delay",   name: "estimate-production-delay",      category: "production-scheduling" },
      { id: "cap-supplier-deps",      name: "analyze-supplier-dependencies",  category: "supply-chain" },
      { id: "cap-cost-impact",        name: "evaluate-cost-impact",           category: "financial-analysis" },
    ],
    constraints: [
      { field: "scope.changeOrderId",    operator: "eq",  value: "ECO-2026-0441" },
      { field: "access.plantRegion",     operator: "in",  value: "NA, EU" },
      { field: "data.classification",    operator: "lte", value: "confidential" },
      { field: "operation.mode",         operator: "eq",  value: "read-only" },
    ],
    approvalRequirements: [],
    durationMs: 487,
  },

  guardrailResult: {
    decision: "allow",
    stagesEvaluated: [
      { name: "authorization",        label: "Authorization",         durationMs: 22, passed: true,  detail: "Principal holds change-impact-analyst entitlement" },
      { name: "supplier-access",      label: "Supplier Access Policy", durationMs: 31, passed: true,  detail: "Suppliers in scope are on approved-access list" },
      { name: "export-control",       label: "Export Control",        durationMs: 18, passed: true,  detail: "No EAR/ITAR restricted items in change order scope" },
      { name: "operational-threshold",label: "Operational Threshold", durationMs: 14, passed: true,  detail: "Read-only analysis — no write or commit operations" },
    ],
    violations: [],
    flags: [],
    totalDurationMs: 85,
    governanceSummary:
      "All 4 operational governance checks passed. Read-only cross-domain impact analysis authorized for ECO-2026-0441.",
  },

  capabilityResult: {
    capabilityId: "cap-bom-impact",
    capabilityName: "analyze-bom-impact",
    category: "bom-analysis",
    status: "success",
    durationMs: 668,
    output: {
      affected_assemblies:        3,
      impacted_work_orders:       7,
      critical_path_item:         "PCBA-7710",
      production_delay_days:      14,
      supplier_lead_time_gap:     "21 days (SUP-Taipei)",
      total_cost_exposure:        "$2,400,000",
    },
  },

  auditEvents: [
    {
      eventId: "evt-a01",
      type: "frame-created",
      outcome: "success",
      timestamp: "2026-05-11T09:14:00.000Z",
      durationMs: 487,
      actor: "principal-diaz@mfg.corp",
      detail: "Projection Frame built for ECO-2026-0441 scope — 8 context items, 5 capabilities authorized",
      spanId: "span-a1",
    },
    {
      eventId: "evt-a02",
      type: "guardrail-evaluated",
      outcome: "success",
      timestamp: "2026-05-11T09:14:00.487Z",
      durationMs: 85,
      actor: "system",
      detail: "All 4 operational governance checks passed — decision: allow",
      spanId: "span-a2",
    },
    {
      eventId: "evt-a03",
      type: "capability-executed",
      outcome: "success",
      timestamp: "2026-05-11T09:14:00.572Z",
      durationMs: 668,
      actor: "system",
      detail: "analyze-bom-impact completed — 3 assemblies, 7 work orders, $2.4M cost exposure identified",
      spanId: "span-a3",
    },
    {
      eventId: "evt-a04",
      type: "turn-completed",
      outcome: "success",
      timestamp: "2026-05-11T09:14:01.240Z",
      durationMs: 1240,
      actor: "system",
      detail: "Operational impact analysis delivered — turn outcome: completed",
      spanId: "span-a4",
    },
  ],
};

// ---------------------------------------------------------------------------
// Scenario B — Safety Stock Reallocation Request
// Guardrail: require-approval   →   Capability: awaiting-approval
//
// A planner requests a cross-plant safety stock reallocation to fulfil an
// urgent work order. The Projection Frame scopes the request to the specific
// work order, source and destination plants, and write-capable inventory
// capabilities. The Guardrail's operational threshold check fires because
// post-reallocation coverage falls below the 7-day minimum. Execution is
// suspended pending Plant Operations Director sign-off.
// ---------------------------------------------------------------------------

const SCENARIO_B: ExecutionScenario = {
  id: "exec-wo8871b2",
  label: "Stock Reallocation",
  description: "WO-8871 — cross-plant safety stock reallocation",
  overallStatus: "awaiting-approval",
  totalDurationMs: 831,

  request: {
    id: "req-8d4e2b10",
    principalId: "principal-okafor@mfg.corp",
    sessionId: "sess-b5c6d7e8",
    conversationId: "conv-f9a0b1c2",
    userMessage:
      "Reallocate 4,000 units of CMP-204 from PLANT-03 safety stock to fill urgent work order WO-8871 at PLANT-07.",
    timestamp: "2026-05-11T11:02:00.000Z",
    model: "claude-opus-4-5",
  },

  projectionFrame: {
    frameId: "frame-9c1f7d3b",
    intent: {
      category: "inventory-reallocation",
      summary:
        "Reallocate safety stock units from PLANT-03 to fulfil critical work order WO-8871 at PLANT-07.",
      confidence: 0.93,
      rawIntent: "cross-plant safety stock reallocation for urgent work order",
    },
    operationalContext: [
      { label: "Work Order",          value: "WO-8871 (CRITICAL)" },
      { label: "Source Plant",        value: "PLANT-03 · Detroit" },
      { label: "Destination Plant",   value: "PLANT-07 · Stuttgart" },
      { label: "Units Requested",     value: "4,000 of CMP-204" },
      { label: "Current Safety Stock","value": "4,200 units (PLANT-03)" },
      { label: "Post-Realloc Buffer", value: "200 units (2-day coverage)" },
      { label: "Min. Required Cover", value: "7 days (policy floor)" },
      { label: "WO Due Date",         value: "2026-05-18" },
    ],
    authorizedCapabilities: [
      { id: "cap-reallocate-inv",   name: "reallocate-inventory",       category: "inventory" },
      { id: "cap-update-wo-alloc",  name: "update-work-order-allocation", category: "production-scheduling" },
    ],
    constraints: [
      { field: "reallocation.maxUnits",          operator: "lte", value: 10000 },
      { field: "safety_stock.min_coverage_days", operator: "gte", value: 7 },
      { field: "plants.authorized",              operator: "in",  value: "PLANT-03, PLANT-07" },
    ],
    approvalRequirements: [
      {
        id: "apr-ops-director",
        trigger: "safety-stock-threshold",
        approverRole: "plant-operations-director",
        reason:
          "Reallocation reduces PLANT-03 safety stock below the 7-day coverage floor. Plant Operations Director sign-off required.",
      },
    ],
    durationMs: 412,
  },

  guardrailResult: {
    decision: "require-approval",
    stagesEvaluated: [
      { name: "authorization",         label: "Authorization",          durationMs: 19, passed: true,  detail: "Principal holds inventory-planner entitlement" },
      { name: "supplier-access",       label: "Supplier Access Policy", durationMs: 11, passed: true,  detail: "Internal reallocation — no external supplier access" },
      { name: "export-control",        label: "Export Control",         durationMs: 9,  passed: true,  detail: "Intra-company transfer — no export controls triggered" },
      { name: "operational-threshold", label: "Operational Threshold",  durationMs: 27, passed: false, detail: "Post-reallocation coverage: 2 days — below 7-day policy floor" },
    ],
    violations: [],
    flags: [
      {
        reason:
          "Reallocation leaves PLANT-03 with 200 units (2-day coverage), below the minimum 7-day safety stock floor.",
        reviewQueue: "plant-ops-escalation",
      },
    ],
    totalDurationMs: 66,
    governanceSummary:
      "Operational threshold check failed — PLANT-03 safety stock drops below policy floor. Approval gate opened for Plant Operations Director.",
  },

  capabilityResult: {
    capabilityId: "cap-reallocate-inv",
    capabilityName: "reallocate-inventory",
    category: "inventory",
    status: "awaiting-approval",
    durationMs: 0,
    approvalGateId: "gate-7b2a9c04",
    approvalStatus: "open",
  },

  auditEvents: [
    {
      eventId: "evt-b01",
      type: "frame-created",
      outcome: "success",
      timestamp: "2026-05-11T11:02:00.000Z",
      durationMs: 412,
      actor: "principal-okafor@mfg.corp",
      detail: "Projection Frame built for WO-8871 reallocation scope — approval requirement flagged",
      spanId: "span-b1",
    },
    {
      eventId: "evt-b02",
      type: "guardrail-evaluated",
      outcome: "success",
      timestamp: "2026-05-11T11:02:00.412Z",
      durationMs: 66,
      actor: "system",
      detail: "Operational threshold check failed — safety stock coverage falls to 2 days",
      spanId: "span-b2",
    },
    {
      eventId: "evt-b03",
      type: "approval-requested",
      outcome: "pending",
      timestamp: "2026-05-11T11:02:00.478Z",
      actor: "system",
      detail: "Approval gate gate-7b2a9c04 opened — Plant Operations Director required",
      spanId: "span-b3",
    },
    {
      eventId: "evt-b04",
      type: "turn-completed",
      outcome: "awaiting-approval",
      timestamp: "2026-05-11T11:02:00.831Z",
      durationMs: 831,
      actor: "system",
      detail: "Execution suspended — awaiting gate-7b2a9c04 resolution before reallocate-inventory proceeds",
      spanId: "span-b4",
    },
  ],
};

// ---------------------------------------------------------------------------
// Scenario C — BOM Export Control Violation
// Guardrail: deny   →   Capability: blocked
//
// A request to share full bill-of-materials and tier-2 supplier data for
// product line PL-7 with an external German partner is blocked at the
// export-control stage. PL-7 contains EAR-99 controlled items. The
// Guardrail denies at the authorization stage — no data is disclosed.
// ---------------------------------------------------------------------------

const SCENARIO_C: ExecutionScenario = {
  id: "exec-pl7ec3c",
  label: "Export Blocked",
  description: "PL-7 BOM — export control denial",
  overallStatus: "denied",
  totalDurationMs: 388,

  request: {
    id: "req-9e5f3c22",
    principalId: "principal-hartmann@mfg.corp",
    sessionId: "sess-c9d0e1f2",
    conversationId: "conv-a3b4c5d6",
    userMessage:
      "Export the full bill of materials and tier-2 supplier list for product line PL-7 to partner ACME Manufacturing GmbH for their supplier qualification process.",
    timestamp: "2026-05-11T14:45:00.000Z",
    model: "claude-opus-4-5",
  },

  projectionFrame: {
    frameId: "frame-2a7e4f9c",
    intent: {
      category: "data-export",
      summary:
        "Export complete BOM and tier-2 supplier data for PL-7 to external manufacturing partner ACME GmbH (DE).",
      confidence: 0.91,
      rawIntent: "export BOM and supplier list PL-7 to external partner",
    },
    operationalContext: [
      { label: "Target Partner",      value: "ACME Manufacturing GmbH (DE)" },
      { label: "Product Line",        value: "PL-7 (Defense Electronics)" },
      { label: "Data Scope",          value: "Full BOM + Tier-2 Suppliers" },
      { label: "Classification",      value: "EAR-99 Controlled" },
      { label: "Export Jurisdiction", value: "US → DE (EU)" },
      { label: "Items Affected",      value: "42 controlled components" },
    ],
    authorizedCapabilities: [
      { id: "cap-export-bom", name: "export-bom-data", category: "data-export" },
    ],
    constraints: [
      { field: "partner.vettingStatus", operator: "eq",  value: "approved" },
      { field: "data.classification",   operator: "lte", value: "restricted" },
      { field: "export.licenseRequired", operator: "eq", value: false },
    ],
    approvalRequirements: [],
    durationMs: 298,
  },

  guardrailResult: {
    decision: "deny",
    stagesEvaluated: [
      { name: "authorization",         label: "Authorization",          durationMs: 17, passed: false, detail: "Principal lacks export-controlled-data:disclose entitlement" },
      { name: "export-control",        label: "Export Control",         durationMs: 31, passed: false, detail: "PL-7 contains 42 EAR-99 items — export license required for DE disclosure" },
      { name: "supplier-access",       label: "Supplier Access Policy", durationMs: 0,  passed: false, detail: "Skipped — authorization denied" },
      { name: "operational-threshold", label: "Operational Threshold",  durationMs: 0,  passed: false, detail: "Skipped — authorization denied" },
    ],
    violations: [
      {
        policy: "EXPORT-CTL-002",
        severity: "critical",
        message:
          "PL-7 BOM contains EAR-99 controlled items. Disclosure to ACME GmbH (DE) requires a valid export license. No license on file.",
      },
    ],
    flags: [],
    totalDurationMs: 48,
    governanceSummary:
      "Request denied — export control violation. PL-7 contains EAR-99 controlled components. An export license is required before any disclosure to external partners.",
  },

  capabilityResult: {
    capabilityId: "cap-export-bom",
    capabilityName: "export-bom-data",
    category: "data-export",
    status: "denied",
    durationMs: 0,
  },

  auditEvents: [
    {
      eventId: "evt-c01",
      type: "frame-created",
      outcome: "success",
      timestamp: "2026-05-11T14:45:00.000Z",
      durationMs: 298,
      actor: "principal-hartmann@mfg.corp",
      detail: "Projection Frame built — EAR-99 classification detected in PL-7 scope",
      spanId: "span-c1",
    },
    {
      eventId: "evt-c02",
      type: "guardrail-evaluated",
      outcome: "denied",
      timestamp: "2026-05-11T14:45:00.298Z",
      durationMs: 48,
      actor: "system",
      detail: "Export control check failed — EXPORT-CTL-002: EAR-99 items in scope, no valid export license",
      spanId: "span-c2",
    },
    {
      eventId: "evt-c03",
      type: "entitlement-denied",
      outcome: "denied",
      timestamp: "2026-05-11T14:45:00.346Z",
      actor: "system",
      detail: "export-bom-data blocked — controlled data disclosure prevented",
      spanId: "span-c3",
    },
    {
      eventId: "evt-c04",
      type: "turn-completed",
      outcome: "denied",
      timestamp: "2026-05-11T14:45:00.388Z",
      durationMs: 388,
      actor: "system",
      detail: "Turn completed — outcome: denied. No data was exported.",
      spanId: "span-c4",
    },
  ],
};

export const MOCK_SCENARIOS: ExecutionScenario[] = [
  SCENARIO_A,
  SCENARIO_B,
  SCENARIO_C,
];
