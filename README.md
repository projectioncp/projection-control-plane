# Projection Control Plane

> AI doesn't see your enterprise. It sees what you project.

Projection Control Plane is a governed operational AI runtime designed to safely mediate between probabilistic AI reasoning systems and deterministic enterprise execution systems.

The platform introduces bounded operational cognition through Decision Frames and governed execution through Guardrail validation.

Rather than exposing unrestricted enterprise systems, raw operational data, or open-ended tool access to AI agents, Projection constructs scoped operational context and controlled execution boundaries that allow AI systems to reason safely within enterprise environments.

---

# Why Projection Exists

Most enterprise AI systems today rely on:
- unrestricted retrieval
- broad tool exposure
- probabilistic orchestration
- open-ended agent behavior

This creates significant enterprise risks:
- hallucinated actions
- operational overreach
- uncontrolled tool execution
- context explosion
- inconsistent governance
- weak auditability
- unsafe automation boundaries

Projection Control Plane approaches enterprise AI differently.

Enterprise systems are deterministic.

LLMs are probabilistic.

Projection exists to safely mediate that boundary.

---

# Core Thesis

Projection defines what AI sees.

Guardrail defines what AI can do.

---

# Core Concepts

## Projection

Projection creates bounded operational cognition.

AI systems do not directly perceive the enterprise.  
They reason against curated and governed operational context.

Projection dynamically constructs:

- Decision Frames
- scoped enterprise visibility
- workflow-aware operational state
- entitlement-aware context
- constrained reasoning surfaces

This limits AI reasoning to authorized operational reality.

---

## Decision Frames

Decision Frames are bounded runtime operational context objects created by Projection.

A Decision Frame may contain:
- workflow state
- operational telemetry
- retrieval results
- authorized capabilities
- policy constraints
- approval requirements
- execution boundaries
- contextual memory references

Decision Frames are dynamically generated based on:
- user intent
- workflow context
- governance policies
- operational state
- authorization scope

The AI reasons inside the Decision Frame rather than against unrestricted enterprise systems.

---

## Guardrail

Guardrail governs enterprise execution.

Projection controls visibility.

Guardrail controls execution.

Guardrail responsibilities include:
- policy validation
- approval workflows
- capability authorization
- execution constraints
- confidence thresholds
- audit generation
- operational governance
- deterministic execution boundaries

Guardrail ensures enterprise systems are not directly controlled by unrestricted AI behavior.

---

## Capabilities

Capabilities are deterministic enterprise operations exposed to the runtime through governed interfaces.

Examples:
- workflow execution
- analytics
- forecasting
- scheduling
- simulations
- operational actions
- deployment generation
- approval routing

The AI reasons.

Capabilities execute.

---

## Hooks

Hooks are lifecycle interception points used throughout workflow execution.

Hooks support:
- approvals
- telemetry
- audit generation
- policy enforcement
- rollback handling
- execution validation
- operational governance

Hooks allow governance to exist throughout the execution lifecycle rather than only at the prompt layer.

---

# Architecture

Projection Control Plane is composed of two layers:

## Orchestrator (`server/`)

The backend pipeline. Receives operational requests, runs the governed execution pipeline, and returns a full execution trace.

```
POST /api/execute   — submit a request, receive an ExecutionTrace
GET  /api/execute/:id — retrieve a stored trace by ID
```

Pipeline stages:

| File | Stage | Description |
|---|---|---|
| `orchestrator.ts` | Coordinator | Sequences all stages, owns the in-memory trace store |
| `projector.ts` | Frame Projection | Calls Gemma via Ollama to produce a structured Decision Frame |
| `guardrail.ts` | Guardrail Evaluation | Deterministic rule-based governance (auth, export control, supplier access, operational threshold) |
| `dispatcher.ts` | Capability Dispatch | Executes authorized capabilities and returns structured results |
| `synthesizer.ts` | Response Synthesis | Calls Gemma to produce a natural-language operational response |
| `types.ts` | Shared Types | `ExecutionRequest`, `ExecutionTrace`, `ProjectedFrame`, `GuardrailResult`, etc. |
| `index.ts` | HTTP Entry Point | Express server exposing the orchestrator over HTTP |

## UI (`src/`)

The frontend dashboard. Visualizes the full execution pipeline — projection frame, guardrail decision, capability result, and audit timeline.

- **Dashboard** — live submission form + three built-in mock scenarios (change impact, stock reallocation, export blocked)
- **API proxy** (`src/app/api/execute/`) — forwards UI requests to the Orchestrator (avoids CORS)
- **Runtime client** (`src/lib/runtime/client.ts`) — `submitRequest` / `getExecutionTrace` / `resolveApprovalGate`

---

# High-Level Flow

```
Request
    ↓
Projection Layer      ← Gemma builds the Decision Frame
    ↓
Decision Frame
    ↓
Guardrail Evaluation  ← deterministic rule-based governance
    ↓
Capability Dispatch   ← deterministic enterprise execution
    ↓
Response Synthesis    ← Gemma generates the operational response
    ↓
Audit / Telemetry
```

---

# Quick Start

## 1. Prerequisites

- Node.js ≥ 20

```bash
npm install
```

## 2. Choose your LLM provider

Pick one path and follow the steps for it. You can change providers at any time by updating `.env.local`.

---

### Option A — No LLM (mock, no API key needed)

Deterministic keyword-based responses. No model, no key, no network calls. Good for trying the UI or running in CI.

```bash
npm run dev:mock
```

Skip to step 3 — no `.env.local` needed for this option.

---

### Option B — Ollama (local, free)

Runs a model on your machine. Requires [Ollama](https://ollama.com) installed.

```bash
ollama pull gemma3:4b   # or any model you prefer
ollama serve
```

Create `.env.local`:
```bash
cp .env.example .env.local
```

`.env.local` (Ollama defaults — no changes needed unless using a different model):
```env
LLM_PROVIDER=ollama
LLM_MODEL=gemma3:4b
```

Start the orchestrator:
```bash
npm run dev:orchestrator
```

---

### Option C — OpenAI

```bash
npm install openai
cp .env.example .env.local
```

`.env.local`:
```env
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
LLM_MODEL=gpt-4o
```

Start the orchestrator:
```bash
npm run dev:orchestrator
```

---

### Option D — Anthropic (Claude)

```bash
npm install @anthropic-ai/sdk
cp .env.example .env.local
```

`.env.local`:
```env
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
LLM_MODEL=claude-sonnet-4-6
```

Start the orchestrator:
```bash
npm run dev:orchestrator
```

---

## 3. Start the UI

In a separate terminal:

```bash
npm run dev
```

Open `http://localhost:3000`.

---

# Environment Variables

## LLM Provider

| Variable | Default | Description |
|---|---|---|
| `LLM_PROVIDER` | `ollama` | `mock`, `ollama`, `openai`, or `anthropic` |
| `LLM_MODEL` | *(provider default)* | Override the provider's default model |

Provider defaults:

| Provider | Default model | Required package | Required env var |
|---|---|---|---|
| `mock` | — | *(none)* | — |
| `ollama` | `gemma3:4b` | *(built-in)* | — |
| `openai` | `gpt-4o` | `npm install openai` | `OPENAI_API_KEY` |
| `anthropic` | `claude-sonnet-4-6` | `npm install @anthropic-ai/sdk` | `ANTHROPIC_API_KEY` |

## Orchestrator

| Variable | Default | Description |
|---|---|---|
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama host (only used when `LLM_PROVIDER=ollama`) |
| `PORT` | `3001` | Orchestrator HTTP port |
| `CORS_ORIGIN` | `http://localhost:3000` | Allowed CORS origin |

## UI

| Variable | Default | Description |
|---|---|---|
| `RUNTIME_URL` | `http://localhost:3001` | URL the Next.js proxy uses to reach the Orchestrator |
