"use client";

import { useState } from "react";
import type { ExecutionScenario } from "@/lib/mock/execution";
import { MOCK_SCENARIOS } from "@/lib/mock/execution";
import { Badge } from "@/components/ui/Badge";
import { RequestPanel } from "./RequestPanel";
import { ProjectionFramePanel } from "./ProjectionFramePanel";
import { GuardrailPanel } from "./GuardrailPanel";
import { CapabilityPanel } from "./CapabilityPanel";
import { AuditTimeline } from "./AuditTimeline";

// ---------------------------------------------------------------------------
// Pipeline arrow — thin, unobtrusive
// ---------------------------------------------------------------------------

function Arrow() {
  return (
    <div className="flex shrink-0 items-center justify-center self-stretch px-1">
      <div className="flex flex-col items-center gap-0">
        <div className="h-12 w-px bg-slate-800" />
        <svg
          width="8"
          height="6"
          viewBox="0 0 8 6"
          fill="none"
          className="text-slate-700"
        >
          <path d="M4 6L0 0h8L4 6z" fill="currentColor" />
        </svg>
        <div className="flex-1" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scenario selector
// ---------------------------------------------------------------------------

function ScenarioTabs({
  scenarios,
  activeId,
  onSelect,
}: {
  scenarios: ExecutionScenario[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex gap-1.5">
      {scenarios.map((s) => (
        <button
          key={s.id}
          onClick={() => onSelect(s.id)}
          className={`rounded-md border px-4 py-1.5 text-xs transition-colors ${
            s.id === activeId
              ? "border-slate-600 bg-slate-800 text-slate-200"
              : "border-transparent text-slate-500 hover:text-slate-300"
          }`}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main dashboard
// ---------------------------------------------------------------------------

export function DashboardClient() {
  const [activeId, setActiveId] = useState<string>(MOCK_SCENARIOS[0]?.id ?? "");

  const scenario = MOCK_SCENARIOS.find((s) => s.id === activeId);

  if (!scenario) {
    return (
      <div className="flex h-full items-center justify-center text-slate-600">
        No scenario data.
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-950">

      {/* ------------------------------------------------------------------ */}
      {/* Header                                                              */}
      {/* ------------------------------------------------------------------ */}
      <header className="sticky top-0 z-10 border-b border-slate-800/80 bg-slate-950/95 backdrop-blur">
        <div className="mx-auto max-w-screen-xl px-6 py-3">
          <div className="flex items-center justify-between">

            {/* Brand */}
            <div className="flex items-center gap-3">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-violet-600">
                <span className="text-xs font-bold text-white">P</span>
              </div>
              <span className="text-sm font-semibold text-slate-200">
                Projection Control Plane
              </span>
            </div>

            {/* Right — scenario tabs + status */}
            <div className="flex items-center gap-5">
              <ScenarioTabs
                scenarios={MOCK_SCENARIOS}
                activeId={activeId}
                onSelect={setActiveId}
              />
              <Badge variant={scenario.overallStatus} dot label={scenario.overallStatus} />
            </div>

          </div>
        </div>
      </header>

      {/* ------------------------------------------------------------------ */}
      {/* Main content                                                        */}
      {/* ------------------------------------------------------------------ */}
      <main className="mx-auto w-full max-w-screen-xl flex-1 px-6 py-8">

        {/* ── Pipeline row ── */}
        {/*
          Layout intent:
            - Request    : narrow — the input; secondary
            - Projection : wide (flex-[2]) — the centerpiece; dominant
            - Guardrail  : standard — the gate
            - Capability : standard — the outcome
        */}
        <div className="flex items-stretch gap-0">

          {/* Request — narrow */}
          <div className="w-52 shrink-0">
            <RequestPanel request={scenario.request} />
          </div>

          <Arrow />

          {/* Projection Frame — double width, visually dominant */}
          <div className="min-w-0 flex-[2]">
            <ProjectionFramePanel frame={scenario.projectionFrame} />
          </div>

          <Arrow />

          {/* Guardrail */}
          <div className="min-w-0 flex-1">
            <GuardrailPanel result={scenario.guardrailResult} />
          </div>

          <Arrow />

          {/* Capability */}
          <div className="min-w-0 flex-1">
            <CapabilityPanel result={scenario.capabilityResult} />
          </div>

        </div>

        {/* ── Audit trail — collapsed by default ── */}
        <div className="mt-5">
          <AuditTimeline events={scenario.auditEvents} />
        </div>

      </main>

      {/* ------------------------------------------------------------------ */}
      {/* Footer                                                              */}
      {/* ------------------------------------------------------------------ */}
      <footer className="border-t border-slate-800/60 px-6 py-4">
        <div className="mx-auto flex max-w-screen-xl items-center justify-between text-xs text-slate-700">
          <span>Projection Control Plane · feature/control-plane-ui</span>
          <span>Mock runtime — wire <code className="font-mono">src/lib/runtime/client.ts</code> for live data</span>
        </div>
      </footer>

    </div>
  );
}
