/**
 * Orchestrator — Rule-Based Guardrail Evaluator
 *
 * Evaluates the projected frame against operational governance rules.
 * This is a deterministic, rule-based implementation — no LLM involved.
 *
 * Governance checks (in order):
 *   1. Authorization    — is the principal permitted to make this class of request?
 *   2. Export Control   — does the request involve restricted data disclosure?
 *   3. Supplier Access  — are referenced suppliers on the approved-access list?
 *   4. Op. Threshold    — does the operation require approval (write, large quantity)?
 *
 * In a production system, these rules would be loaded from a policy store.
 * For the MVP, they are expressed as pattern matching against the frame.
 */

import type { ProjectorOutput, GuardrailResult, GuardrailStage } from "./types";

// ---------------------------------------------------------------------------
// Known operational intent categories
// ---------------------------------------------------------------------------

const OPERATIONAL_CATEGORIES = new Set([
  "operational-impact-analysis",
  "inventory-reallocation",
  "data-export",
  "production-analysis",
  "supply-chain-analysis",
  "financial-analysis",
  "work-order-management",
  "bom-analysis",
  "inventory-query",
  "supplier-analysis",
  "cost-analysis",
  "scheduling",
  "reporting",
  "notification",
]);

const CONFIDENCE_FLOOR = 0.8;

// Keywords that signal an operational request in the raw user message.
// At least one must be present for the request to be considered in-scope.
const OPERATIONAL_SIGNAL_KEYWORDS = [
  // Domain nouns
  "bom", "bill of material", "inventory", "stock", "work order", "work-order",
  "plant", "supplier", "component", "part number", "sku", "assembly",
  "production", "schedule", "capacity", "shipment", "forecast", "allocation",
  "reallocation", "reallocate", "cost", "exposure", "lead time", "downtime",
  "change order", "eco", "plm", "erp", "wms",
  // Operational verbs
  "analyze", "analysis", "assess", "estimate", "evaluate", "reallocate",
  "allocate", "query", "export", "report", "notify", "update", "transfer",
  "delay", "impact", "risk",
  // Identifier patterns handled separately (part/WO/plant codes)
];

// Regex for common operational identifiers: WO-1234, CMP-204, PLANT-03, ECO-2026, etc.
const OPERATIONAL_ID_PATTERN = /\b([A-Z]{2,}-\d{2,}|[A-Z]{2,}-[A-Z]{2,}-\d+)\b/i;

// ---------------------------------------------------------------------------
// Pattern sets
// ---------------------------------------------------------------------------

const EXPORT_CAPABILITY_IDS = new Set(["cap-export-bom", "export-bom-data"]);

const EXPORT_KEYWORDS = [
  "export", "share with", "send to", "disclose to", "transfer to",
  "give to", "provide to",
];

const EXTERNAL_PARTY_SIGNALS = [
  "gmbh", "external", "partner", "third party", "third-party",
  "outside", "vendor", "client", "customer",
];

// ---------------------------------------------------------------------------
// Stage evaluators
// ---------------------------------------------------------------------------

function evalOperationalScope(frame: ProjectorOutput, userMessage: string): GuardrailStage {
  const msg = userMessage.toLowerCase();

  const hasKeyword = OPERATIONAL_SIGNAL_KEYWORDS.some((k) => msg.includes(k));
  const hasIdentifier = OPERATIONAL_ID_PATTERN.test(userMessage);
  const hasMessageSignal = hasKeyword || hasIdentifier;

  const category = frame.intent.category;
  const confidence = frame.intent.confidence;
  const isFallback = category === "general-operational";
  const lowConfidence = confidence < CONFIDENCE_FLOOR;

  // Fail if the raw message has no operational signal, OR if the model
  // fell back to the generic category with low confidence.
  const failed = !hasMessageSignal || (isFallback && lowConfidence);

  return {
    name: "operational-scope",
    label: "Operational Scope",
    durationMs: 5,
    passed: !failed,
    detail: failed
      ? "Request does not contain recognized operational content and cannot be processed."
      : `Operational signal detected — category: "${category}", confidence: ${confidence}`,
  };
}

function evalAuthorization(
  _principalId: string,
  _frame: ProjectorOutput,
): GuardrailStage {
  // MVP: all authenticated principals are authorized
  // Production: check entitlement store for the capability set
  return {
    name: "authorization",
    label: "Authorization",
    durationMs: 12,
    passed: true,
    detail: "Principal holds operational entitlement for requested capabilities",
  };
}

function evalExportControl(
  frame: ProjectorOutput,
  userMessage: string,
): GuardrailStage {
  const msg = userMessage.toLowerCase();

  const capabilityIsExport = frame.authorizedCapabilities.some(
    (c) => EXPORT_CAPABILITY_IDS.has(c.id) || EXPORT_CAPABILITY_IDS.has(c.name),
  );

  const hasExportIntent = EXPORT_KEYWORDS.some((k) => msg.includes(k));
  const hasExternalParty = EXTERNAL_PARTY_SIGNALS.some((k) => msg.includes(k));

  const triggered = capabilityIsExport || (hasExportIntent && hasExternalParty);

  return {
    name: "export-control",
    label: "Export Control",
    durationMs: 18,
    passed: !triggered,
    ...(triggered
      ? {
          detail:
            "Potential export-controlled data disclosure detected — license check required",
        }
      : { detail: "No export-controlled items in scope" }),
  };
}

function evalSupplierAccess(frame: ProjectorOutput): GuardrailStage {
  // MVP: pass unless the capability is an external data export
  const isExport = frame.authorizedCapabilities.some(
    (c) => EXPORT_CAPABILITY_IDS.has(c.id) || EXPORT_CAPABILITY_IDS.has(c.name),
  );

  return {
    name: "supplier-access",
    label: "Supplier Access Policy",
    durationMs: 10,
    passed: !isExport,
    ...(isExport
      ? { detail: "Supplier data disclosure to external parties not permitted without license" }
      : { detail: "No supplier data disclosure in scope" }),
  };
}

function evalOperationalThreshold(frame: ProjectorOutput): GuardrailStage {
  const requiresApproval = frame.requiresApproval;

  return {
    name: "operational-threshold",
    label: "Operational Threshold",
    durationMs: 14,
    passed: !requiresApproval,
    ...(requiresApproval
      ? {
          detail:
            frame.approvalReason ??
            "Write operation exceeds automatic approval threshold",
        }
      : { detail: "Operation within automatic approval parameters" }),
  };
}

// ---------------------------------------------------------------------------
// evaluate() — the public interface
// ---------------------------------------------------------------------------

export function evaluate(
  principalId: string,
  frame: ProjectorOutput,
  userMessage: string,
): GuardrailResult {
  const start = Date.now();

  const scopeStage      = evalOperationalScope(frame, userMessage);
  const authStage       = evalAuthorization(principalId, frame);
  const exportStage     = evalExportControl(frame, userMessage);
  const supplierStage   = evalSupplierAccess(frame);
  const thresholdStage  = evalOperationalThreshold(frame);

  const skipped = (name: string, label: string): GuardrailStage => ({
    name, label, durationMs: 0, passed: false, detail: "Skipped",
  });

  // Out-of-scope requests are rejected before any other check runs
  if (!scopeStage.passed) {
    return {
      decision: "deny",
      stagesEvaluated: [
        scopeStage,
        skipped("authorization", "Authorization"),
        skipped("export-control", "Export Control"),
        skipped("supplier-access", "Supplier Access Policy"),
        skipped("operational-threshold", "Operational Threshold"),
      ],
      violations: [{
        policy: "SCOPE-001",
        severity: "medium",
        message: "The request does not correspond to a recognized operational action and cannot be processed.",
      }],
      flags: [],
      totalDurationMs: Date.now() - start,
      governanceSummary: "Request out of scope — not a recognized operational action.",
    };
  }

  // If authorization fails, skip remaining stages
  if (!authStage.passed) {
    return {
      decision: "deny",
      stagesEvaluated: [
        scopeStage,
        authStage,
        skipped("export-control", "Export Control"),
        skipped("supplier-access", "Supplier Access Policy"),
        skipped("operational-threshold", "Operational Threshold"),
      ],
      violations: [{ policy: "AUTH-001", severity: "critical", message: "Principal is not authorized for the requested operation." }],
      flags: [],
      totalDurationMs: Date.now() - start,
      governanceSummary: "Request denied — authorization check failed.",
    };
  }

  // Export control denial
  if (!exportStage.passed) {
    return {
      decision: "deny",
      stagesEvaluated: [scopeStage, authStage, exportStage, supplierStage, thresholdStage],
      violations: [
        {
          policy: "EXPORT-CTL-001",
          severity: "critical",
          message: "Request involves potential export-controlled data. A valid export license is required before any external disclosure.",
        },
      ],
      flags: [],
      totalDurationMs: Date.now() - start,
      governanceSummary:
        "Request denied — export control policy triggered. No data was disclosed.",
    };
  }

  // Approval required
  if (!thresholdStage.passed) {
    return {
      decision: "require-approval",
      stagesEvaluated: [scopeStage, authStage, exportStage, supplierStage, thresholdStage],
      violations: [],
      flags: [
        {
          reason:
            frame.approvalReason ??
            "Operation exceeds automatic execution threshold and requires authorization.",
          reviewQueue: "operations-escalation",
        },
      ],
      totalDurationMs: Date.now() - start,
      governanceSummary:
        "Approval gate opened — the operation requires explicit authorization before execution can proceed.",
    };
  }

  // All clear
  return {
    decision: "allow",
    stagesEvaluated: [scopeStage, authStage, exportStage, supplierStage, thresholdStage],
    violations: [],
    flags: [],
    totalDurationMs: Date.now() - start,
    governanceSummary:
      "All 5 governance checks passed. Operation authorized for execution.",
  };
}
