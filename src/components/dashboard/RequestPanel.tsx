import type { MockRequest } from "@/lib/mock/execution";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";

interface RequestPanelProps {
  request: MockRequest;
}

export function RequestPanel({ request }: RequestPanelProps) {
  return (
    <Card accent="blue" className="flex flex-col">
      <CardHeader>
        <span className="text-xs font-medium uppercase tracking-widest text-slate-500">
          Request
        </span>
      </CardHeader>

      <CardBody className="flex flex-1 flex-col gap-4">
        {/* The user message is the only thing that matters here */}
        <p className="text-sm leading-relaxed text-slate-200">
          &ldquo;{request.userMessage}&rdquo;
        </p>

        <div className="mt-auto space-y-1.5 border-t border-slate-800/60 pt-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-600">Principal</span>
            <span className="text-slate-400">{request.principalId.replace("principal-", "")}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-600">Model</span>
            <span className="text-slate-400">{request.model}</span>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
