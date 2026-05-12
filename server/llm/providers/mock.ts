import type { LLMProvider, LLMMessage, LLMChatOptions } from "../types";

/**
 * Mock LLM provider — no external service required.
 *
 * Uses keyword matching to produce deterministic projection frames and
 * canned synthesis responses. Suitable for demos, CI, and hosted deployments
 * that don't have an LLM API key.
 *
 * Enable with: LLM_PROVIDER=mock
 */
export class MockProvider implements LLMProvider {
  async chat(messages: LLMMessage[], options: LLMChatOptions = {}): Promise<string> {
    const userMsg = messages.find((m) => m.role === "user")?.content ?? "";
    return options.json ? buildMockFrame(userMsg) : buildMockResponse(userMsg);
  }
}

// ---------------------------------------------------------------------------
// Projection frame builder
// ---------------------------------------------------------------------------

interface FrameTemplate {
  category: string;
  summary: string;
  rawIntent: string;
  capability: { id: string; name: string; category: string };
  constraints: Array<{ field: string; operator: string; value: string }>;
  requiresApproval: boolean;
  approvalReason: string | null;
}

function detectTemplate(msg: string): FrameTemplate {
  const m = msg.toLowerCase();

  if (m.includes("reallocate") || m.includes("realloc") || m.includes("transfer") && m.includes("stock")) {
    return {
      category: "inventory-reallocation",
      summary: "Reallocate inventory between plants for the requested work order.",
      rawIntent: "cross-plant inventory reallocation",
      capability: { id: "cap-reallocate-inv", name: "reallocate-inventory", category: "inventory" },
      constraints: [{ field: "operation.mode", operator: "eq", value: "write" }],
      requiresApproval: true,
      approvalReason: "Write operation requires explicit authorization.",
    };
  }

  if (m.includes("export") || m.includes("share with") || m.includes("disclose")) {
    return {
      category: "data-export",
      summary: "Export operational data to the specified external party.",
      rawIntent: "export data to external partner",
      capability: { id: "cap-export-bom", name: "export-bom-data", category: "data-export" },
      constraints: [{ field: "data.classification", operator: "lte", value: "restricted" }],
      requiresApproval: false,
      approvalReason: null,
    };
  }

  if (m.includes("bom") || m.includes("bill of material") || m.includes("component") || m.includes("engineering change") || m.includes("eco-")) {
    return {
      category: "operational-impact-analysis",
      summary: "Assess downstream BOM and production impact for the requested engineering change.",
      rawIntent: "BOM impact analysis",
      capability: { id: "cap-bom-impact", name: "analyze-bom-impact", category: "bom-analysis" },
      constraints: [{ field: "operation.mode", operator: "eq", value: "read-only" }],
      requiresApproval: false,
      approvalReason: null,
    };
  }

  if (m.includes("supplier") || m.includes("supply chain") || m.includes("vendor")) {
    return {
      category: "supply-chain-analysis",
      summary: "Analyze supplier dependencies and supply chain exposure for the requested scope.",
      rawIntent: "supplier dependency analysis",
      capability: { id: "cap-supplier-deps", name: "analyze-supplier-dependencies", category: "supply-chain" },
      constraints: [{ field: "operation.mode", operator: "eq", value: "read-only" }],
      requiresApproval: false,
      approvalReason: null,
    };
  }

  if (m.includes("inventory") || m.includes("stock") || m.includes("warehouse")) {
    return {
      category: "inventory-query",
      summary: "Query current inventory levels and exposure for the requested scope.",
      rawIntent: "inventory exposure query",
      capability: { id: "cap-inventory-exposure", name: "query-inventory-exposure", category: "inventory" },
      constraints: [{ field: "operation.mode", operator: "eq", value: "read-only" }],
      requiresApproval: false,
      approvalReason: null,
    };
  }

  if (m.includes("cost") || m.includes("financial") || m.includes("exposure") || m.includes("budget")) {
    return {
      category: "financial-analysis",
      summary: "Evaluate cost impact and financial exposure for the requested operational change.",
      rawIntent: "cost impact evaluation",
      capability: { id: "cap-cost-impact", name: "evaluate-cost-impact", category: "financial-analysis" },
      constraints: [{ field: "operation.mode", operator: "eq", value: "read-only" }],
      requiresApproval: false,
      approvalReason: null,
    };
  }

  if (m.includes("production") || m.includes("schedule") || m.includes("work order") || m.includes("delay")) {
    return {
      category: "production-analysis",
      summary: "Estimate production schedule impact and delay risk for the requested scope.",
      rawIntent: "production delay estimation",
      capability: { id: "cap-production-delay", name: "estimate-production-delay", category: "production-scheduling" },
      constraints: [{ field: "operation.mode", operator: "eq", value: "read-only" }],
      requiresApproval: false,
      approvalReason: null,
    };
  }

  // Fallback — generic report
  return {
    category: "reporting",
    summary: "Generate an operational summary report for the submitted request.",
    rawIntent: "operational report",
    capability: { id: "cap-generate-report", name: "generate-report", category: "reporting" },
    constraints: [{ field: "operation.mode", operator: "eq", value: "read-only" }],
    requiresApproval: false,
    approvalReason: null,
  };
}

function extractContext(msg: string): Array<{ label: string; value: string }> {
  const context: Array<{ label: string; value: string }> = [];

  // Work order IDs: WO-1234
  const wo = msg.match(/\bWO-\d+\b/i);
  if (wo) context.push({ label: "Work Order", value: wo[0].toUpperCase() });

  // Component / part IDs: CMP-204, PART-XYZ
  const cmp = msg.match(/\b(CMP|PART|SKU|ASM|PCBA)-[\w-]+\b/i);
  if (cmp) context.push({ label: "Component", value: cmp[0].toUpperCase() });

  // Plant codes: PLANT-03
  const plant = msg.match(/\bPLANT-\w+\b/i);
  if (plant) context.push({ label: "Plant", value: plant[0].toUpperCase() });

  // ECO / change order
  const eco = msg.match(/\bECO-[\w-]+\b/i);
  if (eco) context.push({ label: "Change Order", value: eco[0].toUpperCase() });

  // Quantities: "4,000 units", "500 units"
  const qty = msg.match(/\b(\d[\d,]*)\s*units?\b/i);
  if (qty) context.push({ label: "Quantity", value: qty[0] });

  if (context.length === 0) {
    context.push({ label: "Request", value: msg.slice(0, 120) });
  }

  return context;
}

function buildMockFrame(userMessage: string): string {
  const t = detectTemplate(userMessage);
  const frame = {
    intent: {
      category: t.category,
      summary: t.summary,
      confidence: 0.92,
      rawIntent: t.rawIntent,
    },
    authorizedCapabilities: [t.capability],
    constraints: t.constraints,
    operationalContext: extractContext(userMessage),
    requiresApproval: t.requiresApproval,
    approvalReason: t.approvalReason,
  };
  return JSON.stringify(frame);
}

// ---------------------------------------------------------------------------
// Synthesis response builder
// ---------------------------------------------------------------------------

function buildMockResponse(userMessage: string): string {
  const t = detectTemplate(userMessage);

  if (t.requiresApproval) {
    return (
      `The ${t.rawIntent} request has been submitted for authorization review. ` +
      `Execution of ${t.capability.name} is pending approval before it can proceed. ` +
      `You will be notified when a decision is made by the Plant Operations Director.`
    );
  }

  const ctx = extractContext(userMessage);
  const scope = ctx.map((c) => `${c.label}: ${c.value}`).join(", ");

  return (
    `The ${t.rawIntent} has been completed successfully. ` +
    `Scope: ${scope}. ` +
    `The ${t.capability.name} capability executed within the authorized Decision Frame. ` +
    `Results are available in the execution trace below.`
  );
}
