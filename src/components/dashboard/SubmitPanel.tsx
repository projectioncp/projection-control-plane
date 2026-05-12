"use client";

interface SubmitPanelProps {
  onSubmit: (principalId: string, userMessage: string) => void;
  isSubmitting: boolean;
  error: string | null;
  message: string;
  onMessageChange: (msg: string) => void;
  principalId: string;
  onPrincipalChange: (id: string) => void;
}

export function SubmitPanel({
  onSubmit,
  isSubmitting,
  error,
  message,
  onMessageChange,
  principalId,
  onPrincipalChange,
}: SubmitPanelProps) {
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!message.trim() || isSubmitting) return;
    onSubmit(principalId.trim(), message.trim());
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="flex gap-3">

        {/* Principal ID */}
        <div className="w-56 shrink-0">
          <label className="mb-1 block text-xs text-slate-600">Principal</label>
          <input
            type="text"
            value={principalId}
            onChange={(e) => onPrincipalChange(e.target.value)}
            className="w-full rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-300 placeholder-slate-600 focus:border-slate-600 focus:outline-none"
            placeholder="principal-id@org"
          />
        </div>

        {/* Message */}
        <div className="min-w-0 flex-1">
          <label className="mb-1 block text-xs text-slate-600">Operational request</label>
          <textarea
            value={message}
            onChange={(e) => onMessageChange(e.target.value)}
            rows={2}
            className="w-full resize-none rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-300 placeholder-slate-600 focus:border-slate-600 focus:outline-none"
            placeholder="Describe the operational action or analysis you need…"
          />
        </div>

        {/* Submit */}
        <div className="flex shrink-0 flex-col justify-end">
          <button
            type="submit"
            disabled={!message.trim() || isSubmitting}
            className="rounded-md bg-violet-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isSubmitting ? "Running…" : "Execute"}
          </button>
        </div>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}
    </form>
  );
}
