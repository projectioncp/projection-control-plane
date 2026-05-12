/**
 * Orchestrator — Express Entry Point
 *
 * Routes:
 *   POST /api/execute        — submit a new operational request
 *   GET  /api/execute/:id    — retrieve a completed execution trace
 *
 * Start with: npm run dev:orchestrator
 */

import express from "express";
import cors from "cors";
import { execute, getTrace } from "./orchestrator";
import { runConversationTurn } from "./langgraph/executor";
import type { ExecutionRequest } from "./types";

const app = express();
const PORT = process.env["PORT"] ? parseInt(process.env["PORT"]) : 3001;

app.use(cors({ origin: process.env["CORS_ORIGIN"] ?? "http://localhost:3000" }));
app.use(express.json());

// ---------------------------------------------------------------------------
// POST /api/execute
// ---------------------------------------------------------------------------

app.post("/api/execute", async (req, res) => {
  const body = req.body as Partial<ExecutionRequest>;

  if (!body.principalId || !body.userMessage) {
    res.status(400).json({ error: "principalId and userMessage are required" });
    return;
  }

  try {
    const trace = await execute(body as ExecutionRequest);
    res.status(200).json(trace);
  } catch (err) {
    console.error("[server] Execution failed:", err);
    res.status(500).json({ error: "Execution pipeline failed" });
  }
});

// ---------------------------------------------------------------------------
// GET /api/execute/:id
// ---------------------------------------------------------------------------

app.get("/api/execute/:id", (req, res) => {
  const trace = getTrace(req.params.id ?? "");

  if (!trace) {
    res.status(404).json({ error: "Trace not found" });
    return;
  }

  res.status(200).json(trace);
});

// ---------------------------------------------------------------------------
// POST /api/chat  — multi-turn conversation endpoint
// ---------------------------------------------------------------------------

app.post("/api/chat", async (req, res) => {
  const { principalId, userMessage, conversationId, sessionId } = req.body as {
    principalId?: string;
    userMessage?: string;
    conversationId?: string;
    sessionId?: string;
  };

  if (!principalId || !userMessage) {
    res.status(400).json({ error: "principalId and userMessage are required" });
    return;
  }

  try {
    const result = await runConversationTurn({
      conversationId: conversationId ?? `conv-${Date.now()}`,
      sessionId: sessionId ?? `sess-${Date.now()}`,
      principalId,
      userMessage,
    });

    res.status(200).json(result);
  } catch (err) {
    console.error("[server] Chat turn failed:", err);
    res.status(500).json({ error: "Conversation pipeline failed" });
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`[server] Projection runtime listening on http://localhost:${PORT}`);
  console.log(`[server] Model: ${process.env["PROJECTION_MODEL"] ?? "gemma3:4b"}`);
  console.log(`[server] Ollama: ${process.env["OLLAMA_HOST"] ?? "http://localhost:11434"}`);
});
