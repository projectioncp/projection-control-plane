import { type NextRequest, NextResponse } from "next/server";

const RUNTIME_URL = process.env["RUNTIME_URL"] ?? "http://localhost:3001";

export async function POST(req: NextRequest) {
  const body = await req.json() as unknown;

  let res: Response;
  try {
    res = await fetch(`${RUNTIME_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return NextResponse.json(
      { error: "Orchestrator is not reachable. Start it with: npm run dev:orchestrator" },
      { status: 502 },
    );
  }

  const data = await res.json() as unknown;
  return NextResponse.json(data, { status: res.status });
}
