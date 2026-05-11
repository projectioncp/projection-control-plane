import type { MockCapabilityResult } from "@/lib/mock/execution";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

interface CapabilityPanelProps {
  result: MockCapabilityResult;
}

const STATUS_ACCENT: Record<
  MockCapabilityResult["status"],
  "emerald" | "red" | "amber" | "slate"
> = {
  success:             "emerald",
  failed:              "red",
  denied:              "red",
  pending:             "slate",
  "awaiting-approval": "amber",
};

// Human-readable status descriptions
const STATUS_PROSE: Record<MockCapabilityResult["status"], string> = {
  success:             "Executed successfully.",
  failed:              "Execution failed.",
  denied:              "Blocked by Guardrail. No operation was performed.",
  pending:             "Pending dispatch.",
  "awaiting-approval": "Suspended — awaiting approval before execution.",
};

export function CapabilityPanel({ result }: CapabilityPanelProps) {
  const accent = STATUS_ACCENT[result.status];

  // Show only the 2 most meaningful output keys
  const outputEntries = result.output
    ? Object.entries(result.output).slice(0, 2)
    : [];

  return (
    <Card accent={accent} className="flex flex-col">
      <CardHeader>
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-widest text-slate-500">
            Capability
          </span>
          <Badge variant={result.status} dot label={result.status} />
        </div>
      </CardHeader>

      <CardBody className="flex flex-1 flex-col gap-4">

        {/* ── Capability name ── */}
        <div>
          <p className="text-base font-medium text-slate-100">
            {result.capabilityName}
          </p>
          <p className="mt-1 text-sm text-slate-400">
            {STATUS_PROSE[result.status]}
          </p>
        </div>

        {/* ── Output (success only, top 2 lines) ── */}
        {outputEntries.length > 0 && (
          <div className="space-y-1.5 rounded-md border border-emerald-500/15 bg-emerald-500/5 px-3 py-2.5">
            {outputEntries.map(([key, val]) => (
              <div key={key} className="flex items-center justify-between text-xs">
                <span className="text-slate-500">{key}</span>
                <span className="text-slate-300">{String(val)}</span>
              </div>
            ))}
          </div>
        )}

        {/* ── Approval gate (awaiting-approval only) ── */}
        {result.approvalGateId && (
          <div className="rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2.5 text-xs text-amber-300">
            <p className="font-medium">Approval gate open</p>
            <p className="mt-0.5 text-slate-400">
              Execution is suspended. The operation will resume once the required approval is granted.
            </p>
          </div>
        )}

      </CardBody>
    </Card>
  );
}
