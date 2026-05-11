import type { MockGuardrailResult } from "@/lib/mock/execution";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

interface GuardrailPanelProps {
  result: MockGuardrailResult;
}

// Stage display label — falls back to the stage's own label field from mock data

export function GuardrailPanel({ result }: GuardrailPanelProps) {
  const cardAccent =
    result.decision === "allow"
      ? "emerald"
      : result.decision === "deny"
      ? "red"
      : "amber";

  return (
    <Card accent={cardAccent as "emerald" | "red" | "amber"} className="flex flex-col">
      <CardHeader>
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-widest text-slate-500">
            Guardrail
          </span>
          <Badge variant={result.decision} dot label={result.decision} />
        </div>
      </CardHeader>

      <CardBody className="flex flex-1 flex-col gap-4">

        {/* ── Governance summary ── */}
        <p className="text-sm leading-relaxed text-slate-300">
          {result.governanceSummary}
        </p>

        {/* ── Stage checks — dots only, no timing ── */}
        <div className="space-y-2">
          {result.stagesEvaluated.map((stage) => (
            <div key={stage.name} className="flex items-center gap-2.5">
              <span
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-xs ${
                  stage.passed
                    ? "bg-emerald-500/15 text-emerald-400"
                    : "bg-red-500/15 text-red-400"
                }`}
              >
                {stage.passed ? "✓" : "✕"}
              </span>
              <span className="text-sm text-slate-400">
                {stage.label}
              </span>
            </div>
          ))}
        </div>

        {/* ── Violation (shown only on deny) ── */}
        {result.violations.length > 0 && (
          <div className="rounded-md border border-red-500/20 bg-red-500/5 px-3 py-2.5 text-xs text-red-300">
            {result.violations[0]?.message}
          </div>
        )}

        {/* ── Flag (shown on require-approval or flag) ── */}
        {result.flags.length > 0 && (
          <div className="rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2.5 text-xs text-amber-300">
            {result.flags[0]?.reason}
          </div>
        )}

      </CardBody>
    </Card>
  );
}
