import type { MockProjectionFrame } from "@/lib/mock/execution";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";

interface ProjectionFramePanelProps {
  frame: MockProjectionFrame;
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color =
    pct >= 90 ? "bg-violet-500" : pct >= 70 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2.5">
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-slate-800">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-9 shrink-0 text-right text-xs text-slate-500">
        {pct}%
      </span>
    </div>
  );
}

export function ProjectionFramePanel({ frame }: ProjectionFramePanelProps) {
  return (
    <Card accent="violet" className="flex flex-col ring-1 ring-violet-500/10">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
            <span className="text-xs font-semibold uppercase tracking-widest text-slate-300">
              Projection Frame
            </span>
          </div>
          <span className="rounded-full border border-violet-500/25 bg-violet-500/10 px-2.5 py-0.5 text-xs text-violet-400">
            {frame.intent.category}
          </span>
        </div>
      </CardHeader>

      <CardBody className="flex flex-1 flex-col gap-5">

        {/* ── Intent — the hero ── */}
        <div>
          <p className="mb-2.5 text-base font-medium leading-snug text-slate-100">
            {frame.intent.summary}
          </p>
          <ConfidenceBar value={frame.intent.confidence} />
        </div>

        {/* ── Bounded Operational Context ── */}
        <div className="rounded-lg border border-dashed border-violet-500/20 bg-violet-500/[0.03] p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-violet-500/50">
            Bounded Operational Context
          </p>

          {/* Operational context grid */}
          {frame.operationalContext.length > 0 && (
            <div className="mb-4 grid grid-cols-2 gap-x-4 gap-y-2">
              {frame.operationalContext.map((item) => (
                <div key={item.label}>
                  <p className="text-xs text-slate-600">{item.label}</p>
                  <p className="text-xs font-medium text-slate-300">{item.value}</p>
                </div>
              ))}
            </div>
          )}

          {/* Authorized capabilities */}
          <div className="mb-3">
            <p className="mb-1.5 text-xs text-slate-600">Authorized Capabilities</p>
            <div className="flex flex-wrap gap-1.5">
              {frame.authorizedCapabilities.map((cap) => (
                <span
                  key={cap.id}
                  className="rounded-md border border-violet-500/25 bg-violet-500/10 px-2.5 py-1 text-xs font-medium text-violet-300"
                >
                  {cap.name}
                </span>
              ))}
            </div>
          </div>

          {/* Constraints */}
          {frame.constraints.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs text-slate-600">Constraints</p>
              <div className="space-y-1">
                {frame.constraints.map((c, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-xs">
                    <span className="text-slate-500">{c.field}</span>
                    <span className="text-violet-500/60">{c.operator}</span>
                    <span className="font-medium text-slate-300">{String(c.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Approval requirements (conditional) ── */}
        {frame.approvalRequirements.length > 0 && (
          <div className="rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2.5">
            <p className="mb-0.5 text-xs font-medium text-amber-300">
              Requires Approval — {frame.approvalRequirements[0]?.approverRole}
            </p>
            <p className="text-xs text-slate-400">
              {frame.approvalRequirements[0]?.reason}
            </p>
          </div>
        )}

        {/* ── Boundary statement ── */}
        <div className="mt-auto border-t border-slate-800/60 pt-3">
          <p className="text-xs text-slate-600">
            AI reasoning is bounded to this frame — no capability executes outside it.
          </p>
        </div>

      </CardBody>
    </Card>
  );
}
