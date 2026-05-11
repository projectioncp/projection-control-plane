import type { PipelineStatus, GuardrailDecision, CapabilityStatus } from "@/lib/mock/execution";

type BadgeVariant =
  | PipelineStatus
  | GuardrailDecision
  | CapabilityStatus
  | "neutral"
  | "info";

const VARIANT_STYLES: Record<BadgeVariant, string> = {
  // Pipeline / overall status
  completed:           "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  denied:              "bg-red-500/15 text-red-400 border-red-500/30",
  "awaiting-approval": "bg-amber-500/15 text-amber-400 border-amber-500/30",
  failed:              "bg-red-500/15 text-red-400 border-red-500/30",
  pending:             "bg-slate-500/15 text-slate-400 border-slate-500/30",

  // Guardrail decisions
  allow:               "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  deny:                "bg-red-500/15 text-red-400 border-red-500/30",
  "require-approval":  "bg-amber-500/15 text-amber-400 border-amber-500/30",
  flag:                "bg-orange-500/15 text-orange-400 border-orange-500/30",

  // Capability execution status (duplicates resolved by union priority)
  success:             "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",

  // Generic
  neutral:             "bg-slate-500/15 text-slate-400 border-slate-500/30",
  info:                "bg-blue-500/15 text-blue-400 border-blue-500/30",
};

const DOT_STYLES: Partial<Record<BadgeVariant, string>> = {
  completed:           "bg-emerald-400",
  success:             "bg-emerald-400",
  allow:               "bg-emerald-400",
  denied:              "bg-red-400",
  deny:                "bg-red-400",
  failed:              "bg-red-400",
  "awaiting-approval": "bg-amber-400 animate-pulse",
  "require-approval":  "bg-amber-400 animate-pulse",
  pending:             "bg-slate-400 animate-pulse",
  flag:                "bg-orange-400",
};

interface BadgeProps {
  variant: BadgeVariant;
  label?: string;
  dot?: boolean;
  className?: string;
}

export function Badge({ variant, label, dot = false, className = "" }: BadgeProps) {
  const styles = VARIANT_STYLES[variant] ?? VARIANT_STYLES.neutral;
  const dotColor = DOT_STYLES[variant];

  const text = label ?? variant;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium tracking-wide ${styles} ${className}`}
    >
      {dot && dotColor && (
        <span className={`h-1.5 w-1.5 rounded-full ${dotColor}`} />
      )}
      {text}
    </span>
  );
}
