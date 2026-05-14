interface DataRowProps {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}

export function DataRow({ label, value, mono = false }: DataRowProps) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 text-sm">
      <span className="shrink-0 text-slate-500">{label}</span>
      <span
        className={`text-right text-slate-200 ${mono ? "font-mono text-xs" : ""}`}
      >
        {value}
      </span>
    </div>
  );
}

interface SectionLabelProps {
  children: React.ReactNode;
  className?: string;
}

export function SectionLabel({ children, className = "" }: SectionLabelProps) {
  return (
    <p className={`mb-1.5 mt-3 text-xs font-semibold uppercase tracking-widest text-slate-600 ${className}`}>
      {children}
    </p>
  );
}
