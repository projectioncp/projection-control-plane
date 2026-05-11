"use client";

import { useState } from "react";
import type { MockAuditEvent } from "@/lib/mock/execution";

interface AuditTimelineProps {
  events: MockAuditEvent[];
}

const EVENT_DOT: Record<string, string> = {
  "frame-created":       "bg-violet-400",
  "guardrail-evaluated": "bg-amber-400",
  "capability-executed": "bg-emerald-400",
  "approval-requested":  "bg-amber-400",
  "turn-completed":      "bg-blue-400",
  "entitlement-denied":  "bg-red-400",
  "policy-violation":    "bg-red-400",
};

const OUTCOME_COLOR: Record<string, string> = {
  success:             "text-emerald-400",
  denied:              "text-red-400",
  "awaiting-approval": "text-amber-400",
  pending:             "text-slate-400",
};

const EVENT_LABEL: Record<string, string> = {
  "frame-created":       "Frame built",
  "guardrail-evaluated": "Guardrail evaluated",
  "capability-executed": "Capability executed",
  "approval-requested":  "Approval requested",
  "turn-completed":      "Turn completed",
  "entitlement-denied":  "Access denied",
  "policy-violation":    "Policy violation",
};

export function AuditTimeline({ events }: AuditTimelineProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900">
      {/* ── Toggle header ── */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between px-5 py-3.5 text-left transition-colors hover:bg-slate-800/40"
      >
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium uppercase tracking-widest text-slate-500">
            Audit Trail
          </span>
          {/* Compact event dots — visible even when collapsed */}
          <div className="flex items-center gap-1">
            {events.map((e) => (
              <span
                key={e.eventId}
                className={`h-1.5 w-1.5 rounded-full ${EVENT_DOT[e.type] ?? "bg-slate-600"}`}
                title={EVENT_LABEL[e.type] ?? e.type}
              />
            ))}
          </div>
          <span className="text-xs text-slate-600">{events.length} events</span>
        </div>
        <span className="text-xs text-slate-600">
          {expanded ? "Hide ↑" : "Expand ↓"}
        </span>
      </button>

      {/* ── Expanded timeline ── */}
      {expanded && (
        <div className="border-t border-slate-800">
          <div className="relative px-5 py-2">
            {/* Vertical line */}
            <div className="absolute left-[2.1rem] top-0 h-full w-px bg-slate-800" />

            <div className="space-y-0">
              {events.map((event) => {
                const dot = EVENT_DOT[event.type] ?? "bg-slate-600";
                const outcomeColor = OUTCOME_COLOR[event.outcome] ?? "text-slate-500";

                return (
                  <div key={event.eventId} className="relative flex gap-4 py-3">
                    {/* Dot */}
                    <div className="relative z-10 mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                      <span className={`h-2 w-2 rounded-full ${dot}`} />
                    </div>

                    {/* Content */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-sm text-slate-300">
                          {EVENT_LABEL[event.type] ?? event.type}
                        </span>
                        <span className={`shrink-0 text-xs ${outcomeColor}`}>
                          {event.outcome}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
                        {event.detail}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
