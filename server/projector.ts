/**
 * Orchestrator — Frame Projector
 *
 * Uses the configured LLM provider to interpret the user's operational request
 * and produce a structured Decision Frame JSON.
 *
 * Provider / model are selected via LLM_PROVIDER and LLM_MODEL env vars.
 */

import { getLLMProvider } from "./llm/index";
import type { ProjectorOutput } from "./types";

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are the Projection Engine of an enterprise operational AI runtime.

Your job: read the user's operational request and produce a JSON Decision Frame.

A Decision Frame defines the bounded operational context — what the AI is authorized to reason about and execute. It must be specific, scoped, and governed.

AVAILABLE CAPABILITIES (use only relevant ones):
- analyze-bom-impact / bom-analysis: Bill-of-materials downstream impact analysis (read-only)
- query-inventory-exposure / inventory: Inventory levels and exposure query (read-only)
- estimate-production-delay / production-scheduling: Production schedule impact estimation (read-only)
- analyze-supplier-dependencies / supply-chain: Supplier chain dependency analysis (read-only)
- evaluate-cost-impact / financial-analysis: Cost exposure calculation (read-only)
- reallocate-inventory / inventory: Move inventory between locations (WRITE — flag requiresApproval if quantity mentioned or implied is large)
- update-work-order-allocation / production-scheduling: Update work order priorities (WRITE)
- export-bom-data / data-export: Export BOM to external parties (RESTRICTED)
- generate-report / reporting: Generate operational summary reports (read-only)
- send-notification / communication: Send operational notifications

RULES:
- Analysis and read requests: pick read-only capabilities, set requiresApproval false
- Write operations (reallocate, update, transfer): set requiresApproval true
- External data sharing (export, share with partner, disclose): use export-bom-data, note the restriction in constraints
- Extract all specific identifiers from the message (part numbers, work order IDs, plant codes, component IDs, company names) into operationalContext
- Set confidence 0.88–0.97 based on clarity of the request
- Keep summary to one clear sentence describing what will be done

RESPOND WITH VALID JSON ONLY. No markdown. No explanation. Just the JSON object.

{
  "intent": {
    "category": "operational-impact-analysis",
    "summary": "One sentence describing what will be done",
    "confidence": 0.95,
    "rawIntent": "3 to 5 word phrase"
  },
  "authorizedCapabilities": [
    { "id": "cap-bom-impact", "name": "analyze-bom-impact", "category": "bom-analysis" }
  ],
  "constraints": [
    { "field": "operation.mode", "operator": "eq", "value": "read-only" }
  ],
  "operationalContext": [
    { "label": "Component", "value": "CMP-204" },
    { "label": "Scope", "value": "Downstream production" }
  ],
  "requiresApproval": false,
  "approvalReason": null
}`;

// ---------------------------------------------------------------------------
// Fallback frame when the model returns malformed JSON
// ---------------------------------------------------------------------------

function fallbackOutput(userMessage: string): ProjectorOutput {
  return {
    intent: {
      category: "general-operational",
      summary: "Process the submitted operational request.",
      confidence: 0.75,
      rawIntent: userMessage.slice(0, 40),
    },
    authorizedCapabilities: [
      { id: "cap-generate-report", name: "generate-report", category: "reporting" },
    ],
    constraints: [
      { field: "operation.mode", operator: "eq", value: "read-only" },
    ],
    operationalContext: [
      { label: "Request", value: userMessage.slice(0, 120) },
    ],
    requiresApproval: false,
    approvalReason: null,
  };
}

// ---------------------------------------------------------------------------
// project() — public interface
// ---------------------------------------------------------------------------

export async function project(
  userMessage: string,
  history: Array<{ role: "user" | "assistant"; content: string }> = [],
): Promise<ProjectorOutput> {
  const llm = getLLMProvider();

  const historyMessages = history.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  const raw = await llm.chat(
    [
      { role: "system", content: SYSTEM_PROMPT },
      ...historyMessages,
      { role: "user",   content: userMessage },
    ],
    { temperature: 0.1, maxTokens: 1024, json: true },
  );

  try {
    const parsed = JSON.parse(raw) as ProjectorOutput;

    if (!parsed.intent?.summary || !Array.isArray(parsed.authorizedCapabilities)) {
      console.warn("[projector] Incomplete JSON from model — using fallback");
      return fallbackOutput(userMessage);
    }

    return parsed;
  } catch (err) {
    console.warn("[projector] Failed to parse model JSON output:", err);
    return fallbackOutput(userMessage);
  }
}
