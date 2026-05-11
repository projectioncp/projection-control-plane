interface CardProps {
  children: React.ReactNode;
  className?: string;
  accent?: "blue" | "violet" | "amber" | "emerald" | "slate" | "red";
}

const ACCENT_BORDER: Record<NonNullable<CardProps["accent"]>, string> = {
  blue:    "border-t-blue-500",
  violet:  "border-t-violet-500",
  amber:   "border-t-amber-500",
  emerald: "border-t-emerald-500",
  slate:   "border-t-slate-600",
  red:     "border-t-red-500",
};

export function Card({ children, className = "", accent }: CardProps) {
  const accentClass = accent ? `border-t-2 ${ACCENT_BORDER[accent]}` : "";
  return (
    <div
      className={`rounded-lg border border-slate-800 bg-slate-900 ${accentClass} ${className}`}
    >
      {children}
    </div>
  );
}

interface CardHeaderProps {
  children: React.ReactNode;
  className?: string;
}

export function CardHeader({ children, className = "" }: CardHeaderProps) {
  return (
    <div className={`border-b border-slate-800 px-4 py-3 ${className}`}>
      {children}
    </div>
  );
}

interface CardBodyProps {
  children: React.ReactNode;
  className?: string;
}

export function CardBody({ children, className = "" }: CardBodyProps) {
  return <div className={`px-4 py-3 ${className}`}>{children}</div>;
}
