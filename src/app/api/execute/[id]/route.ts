import { type NextRequest, NextResponse } from "next/server";

const RUNTIME_URL = process.env["RUNTIME_URL"] ?? "http://localhost:3001";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let res: Response;
  try {
    res = await fetch(`${RUNTIME_URL}/api/execute/${id}`);
  } catch {
    return NextResponse.json(
      { error: "Orchestrator is not reachable. Start it with: npm run dev:orchestrator" },
      { status: 502 },
    );
  }

  if (res.status === 404) {
    return NextResponse.json({ error: "Trace not found" }, { status: 404 });
  }

  const data = await res.json() as unknown;
  return NextResponse.json(data, { status: res.status });
}
