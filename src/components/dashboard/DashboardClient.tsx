"use client";

import { useState } from "react";
import type { ExecutionScenario } from "@/lib/mock/execution";
import { MOCK_SCENARIOS } from "@/lib/mock/execution";
import { submitRequest, getExecutionTrace } from "@/lib/runtime/client";
import { Badge } from "@/components/ui/Badge";
import { RequestPanel } from "./RequestPanel";
import { ProjectionFramePanel } from "./ProjectionFramePanel";
import { GuardrailPanel } from "./GuardrailPanel";
import { CapabilityPanel } from "./CapabilityPanel";
import { AuditTimeline } from "./AuditTimeline";
import { SubmitPanel } from "./SubmitPanel";
import { ChatPanel } from "./ChatPanel";

// ---------------------------------------------------------------------------
// Pipeline arrow
// ---------------------------------------------------------------------------

function Arrow() {
  return (
    <div className="flex shrink-0 items-center justify-center self-stretch px-1">
      <div className="flex flex-col items-center gap-0">
        <div className="h-12 w-px bg-slate-800" />
        <svg width="8" height="6" viewBox="0 0 8 6" fill="none" className="text-slate-700">
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

type TabEntry = { id: string; label: string; live?: boolean };

function ScenarioTabs({
  tabs,
  activeId,
  onSelect,
}: {
  tabs: TabEntry[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex gap-1.5">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onSelect(t.id)}
          className={`flex items-center gap-1.5 rounded-md border px-4 py-1.5 text-xs transition-colors ${
            t.id === activeId
              ? "border-slate-600 bg-slate-800 text-slate-200"
              : "border-transparent text-slate-500 hover:text-slate-300"
          }`}
        >
          {t.live && (
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-violet-400" />
          )}
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading overlay
// ---------------------------------------------------------------------------

function LoadingOverlay() {
  return (
    <div className="flex flex-1 items-center justify-center gap-3 rounded-lg border border-slate-800 bg-slate-900/60 py-16 text-slate-500">
      <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
      </svg>
      <span className="text-xs">Running pipeline…</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main dashboard
// ---------------------------------------------------------------------------

const LIVE_ID = "__live__";
const CHAT_ID = "__chat__";

export function DashboardClient() {
  const [activeId, setActiveId] = useState<string>(MOCK_SCENARIOS[0]?.id ?? "");
  const [liveTrace, setLiveTrace] = useState<ExecutionScenario | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [message, setMessage] = useState(MOCK_SCENARIOS[0]?.request.userMessage ?? "");
  const [principalId, setPrincipalId] = useState(MOCK_SCENARIOS[0]?.request.principalId ?? "principal-user@mfg.corp");

  async function handleSubmit(principalId: string, userMessage: string) {
    setIsSubmitting(true);
    setSubmitError(null);
    setActiveId(LIVE_ID);

    try {
      const execId = await submitRequest({
        principalId,
        sessionId: `sess-${Date.now()}`,
        userMessage,
      });
      const trace = await getExecutionTrace(execId);
      if (trace) {
        setLiveTrace(trace);
      } else {
        setSubmitError("Execution completed but trace was not found.");
        setActiveId(MOCK_SCENARIOS[0]?.id ?? "");
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Execution failed.");
      setActiveId(MOCK_SCENARIOS[0]?.id ?? "");
    } finally {
      setIsSubmitting(false);
    }
  }

  function selectTab(id: string) {
    setActiveId(id);
    const scenario = MOCK_SCENARIOS.find((s) => s.id === id);
    if (scenario) {
      setMessage(scenario.request.userMessage);
      setPrincipalId(scenario.request.principalId);
    }
  }

  const mockTabs: TabEntry[] = MOCK_SCENARIOS.map((s) => ({ id: s.id, label: s.label }));
  const liveTabs: TabEntry[] =
    liveTrace || isSubmitting ? [{ id: LIVE_ID, label: "Live", live: true }] : [];
  const chatTab: TabEntry[] = [{ id: CHAT_ID, label: "Chat" }];
  const tabs = [...mockTabs, ...liveTabs, ...chatTab];

  const scenario: ExecutionScenario | undefined =
    activeId === CHAT_ID
      ? undefined
      : activeId === LIVE_ID
        ? (liveTrace ?? undefined)
        : MOCK_SCENARIOS.find((s) => s.id === activeId);

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

            {/* Tabs + status */}
            <div className="flex items-center gap-5">
              <ScenarioTabs tabs={tabs} activeId={activeId} onSelect={selectTab} />
              {scenario && (
                <Badge variant={scenario.overallStatus} dot label={scenario.overallStatus} />
              )}
              {isSubmitting && !scenario && (
                <Badge variant="pending" dot label="running" />
              )}
            </div>

          </div>
        </div>
      </header>

      {/* ------------------------------------------------------------------ */}
      {/* Submit panel — hidden on Chat tab                                  */}
      {/* ------------------------------------------------------------------ */}
      {activeId !== CHAT_ID && (
        <div className="border-b border-slate-800/50 bg-slate-950">
          <div className="mx-auto max-w-screen-xl px-6 py-4">
            <SubmitPanel
              onSubmit={handleSubmit}
              isSubmitting={isSubmitting}
              error={submitError}
              message={message}
              onMessageChange={setMessage}
              principalId={principalId}
              onPrincipalChange={setPrincipalId}
            />
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Main content                                                        */}
      {/* ------------------------------------------------------------------ */}
      <main className="mx-auto w-full max-w-screen-xl flex-1 px-6 py-8">

        {/* Chat panel */}
        {activeId === CHAT_ID && (
          <ChatPanel principalId={principalId} />
        )}

        {/* Loading state */}
        {activeId !== CHAT_ID && isSubmitting && activeId === LIVE_ID && (
          <LoadingOverlay />
        )}

        {/* Pipeline */}
        {activeId !== CHAT_ID && !isSubmitting && scenario && (
          <>
            <div className="flex items-stretch gap-0">

              <div className="w-52 shrink-0">
                <RequestPanel request={scenario.request} />
              </div>

              <Arrow />

              <div className="min-w-0 flex-[2]">
                <ProjectionFramePanel frame={scenario.projectionFrame} />
              </div>

              <Arrow />

              <div className="min-w-0 flex-1">
                <GuardrailPanel result={scenario.guardrailResult} />
              </div>

              <Arrow />

              <div className="min-w-0 flex-1">
                <CapabilityPanel result={scenario.capabilityResult} />
              </div>

            </div>

            <div className="mt-5">
              <AuditTimeline events={scenario.auditEvents} />
            </div>
          </>
        )}

      </main>

      {/* ------------------------------------------------------------------ */}
      {/* Footer                                                              */}
      {/* ------------------------------------------------------------------ */}
      <footer className="border-t border-slate-800/60 px-6 py-4">
        <div className="mx-auto flex max-w-screen-xl items-center justify-between text-xs text-slate-700">
          <span>Projection Control Plane</span>
          <span>
            {liveTrace
              ? `Live · ${liveTrace.totalDurationMs}ms · ${liveTrace.request.model}`
              : "Mock scenarios — start dev:orchestrator for live execution"}
          </span>
        </div>
      </footer>

    </div>
  );
}
