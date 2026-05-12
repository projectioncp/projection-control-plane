/**
 * Orchestrator — Mock Capability Dispatcher
 *
 * Executes authorized capabilities and returns structured results.
 * This is a mock implementation — capabilities return deterministic,
 * realistic output based on the capability category and operational context.
 *
 * In production, each capability would invoke a real enterprise system:
 *   - analyze-bom-impact     → PLM / ERP query
 *   - query-inventory-exposure → WMS / ERP query
 *   - reallocate-inventory   → WMS write + approval workflow
 *   - export-bom-data        → DMS export pipeline
 *   etc.
 */

import type { ProjectorOutput, CapabilityResult } from "./types";

// ---------------------------------------------------------------------------
// Deterministic result generators per capability
// ---------------------------------------------------------------------------

function dispatchBomImpact(ctx: ProjectorOutput): CapabilityResult["output"] {
  const component = ctx.operationalContext.find(
    (c) => c.label === "Component" || c.label === "Part",
  )?.value ?? "CMP-XXX";

  return {
    affected_assemblies: 3,
    impacted_work_orders: 7,
    production_delay_days: 14,
    total_cost_exposure: "$2,400,000",
    highest_risk_assembly: `ASM-${component.replace(/[^0-9]/g, "")}-001`,
    analysis_scope: "downstream-full",
  };
}

function dispatchInventoryQuery(ctx: ProjectorOutput): CapabilityResult["output"] {
  const plant = ctx.operationalContext.find(
    (c) => c.label === "Plant" || c.label === "Source Plant",
  )?.value ?? "PLANT-01";

  return {
    current_stock_units: 4200,
    safety_stock_floor: 200,
    available_to_allocate: 4000,
    stock_location: plant,
    coverage_days: 9,
    reorder_point_days: 7,
  };
}

function dispatchProductionDelay(ctx: ProjectorOutput): CapabilityResult["output"] {
  const workOrder = ctx.operationalContext.find(
    (c) => c.label === "Work Order" || c.label === "Work Orders",
  )?.value ?? "WO-XXXX";

  return {
    estimated_delay_days: 14,
    affected_work_order: workOrder,
    downstream_risk: "high",
    mitigation_available: true,
    mitigation_lead_time_days: 5,
  };
}

function dispatchSupplierDependency(ctx: ProjectorOutput): CapabilityResult["output"] {
  const component = ctx.operationalContext.find(
    (c) => c.label === "Component" || c.label === "Part",
  )?.value ?? "CMP-XXX";

  return {
    tier1_suppliers: 2,
    tier2_suppliers: 5,
    single_source_risk: true,
    component_id: component,
    alternate_qualified: false,
    lead_time_weeks: 16,
  };
}

function dispatchCostImpact(ctx: ProjectorOutput): CapabilityResult["output"] {
  return {
    direct_material_delta: "$340,000",
    rework_labor_estimate: "$85,000",
    expedite_premium: "$42,000",
    total_cost_exposure: "$467,000",
    currency: "USD",
    confidence_interval: "±12%",
  };
}

function dispatchInventoryReallocation(ctx: ProjectorOutput): CapabilityResult {
  // Write operations return awaiting-approval
  const gateId = `gate-${Math.random().toString(16).slice(2, 10)}`;
  const qty = ctx.operationalContext.find(
    (c) => c.label === "Quantity" || c.label === "Units",
  )?.value ?? "N/A";

  return {
    capabilityId: "cap-reallocate-inventory",
    capabilityName: "reallocate-inventory",
    category: "inventory",
    status: "awaiting-approval",
    durationMs: 22,
    approvalGateId: gateId,
    approvalStatus: "pending",
    output: {
      requested_quantity: qty,
      approval_gate: gateId,
      review_queue: "operations-escalation",
    },
  };
}

function dispatchWorkOrderUpdate(): CapabilityResult {
  const gateId = `gate-${Math.random().toString(16).slice(2, 10)}`;
  return {
    capabilityId: "cap-update-work-order",
    capabilityName: "update-work-order-allocation",
    category: "production-scheduling",
    status: "awaiting-approval",
    durationMs: 18,
    approvalGateId: gateId,
    approvalStatus: "pending",
    output: { approval_gate: gateId, review_queue: "production-planning" },
  };
}

function dispatchReport(ctx: ProjectorOutput): CapabilityResult["output"] {
  return {
    report_type: "operational-summary",
    sections: 4,
    pages: 3,
    format: "structured-json",
    summary: ctx.intent.summary,
  };
}

function dispatchNotification(): CapabilityResult["output"] {
  return {
    notification_sent: true,
    channel: "operations-escalation",
    recipients: 3,
    priority: "high",
  };
}

// ---------------------------------------------------------------------------
// dispatch() — the public interface
// ---------------------------------------------------------------------------

export function dispatch(frame: ProjectorOutput): CapabilityResult {
  const start = Date.now();

  // Use the first authorized capability to determine dispatch path
  const primary = frame.authorizedCapabilities[0];

  if (!primary) {
    return {
      capabilityId: "cap-none",
      capabilityName: "no-capability",
      category: "unknown",
      status: "failed",
      durationMs: 0,
      output: { error: "No authorized capabilities in frame" },
    };
  }

  const name = primary.name.toLowerCase();

  // Write operations — return awaiting-approval immediately
  if (name.includes("reallocate") || name.includes("realloc")) {
    return dispatchInventoryReallocation(frame);
  }

  if (name.includes("update-work-order") || name.includes("work-order")) {
    return dispatchWorkOrderUpdate();
  }

  // Restricted operations — should have been caught by guardrail
  if (name.includes("export")) {
    return {
      capabilityId: primary.id,
      capabilityName: primary.name,
      category: primary.category,
      status: "denied",
      durationMs: Date.now() - start,
      output: { reason: "Export-controlled operation — blocked by guardrail" },
    };
  }

  // Read-only operations
  let output: CapabilityResult["output"];

  if (name.includes("bom") || name.includes("bom-impact")) {
    output = dispatchBomImpact(frame);
  } else if (name.includes("inventory") || name.includes("stock")) {
    output = dispatchInventoryQuery(frame);
  } else if (name.includes("production") || name.includes("delay")) {
    output = dispatchProductionDelay(frame);
  } else if (name.includes("supplier") || name.includes("supply-chain")) {
    output = dispatchSupplierDependency(frame);
  } else if (name.includes("cost") || name.includes("financial")) {
    output = dispatchCostImpact(frame);
  } else if (name.includes("report")) {
    output = dispatchReport(frame);
  } else if (name.includes("notification") || name.includes("send")) {
    output = dispatchNotification();
  } else {
    output = { result: "processed", summary: frame.intent.summary };
  }

  return {
    capabilityId: primary.id,
    capabilityName: primary.name,
    category: primary.category,
    status: "success",
    durationMs: Date.now() - start + 60, // simulate system latency
    ...(output !== undefined ? { output } : {}),
  };
}
