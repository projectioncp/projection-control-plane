# Contributing to Projection Control Plane

Projection Control Plane (PCP) is a governed operational AI runtime. It mediates
between probabilistic AI reasoning and deterministic enterprise execution through
four separated layers: **Projection → Guardrail → Runtime → Capabilities**.

This guide covers how to wire a real LLM model into the system and run a
live end-to-end execution.

---

## Architecture in one paragraph

Every user request flows through a pipeline:

1. **Projection** — an LLM builds a bounded `DecisionFrame` from the user's
   intent. The AI only sees what the frame permits.
2. **Guardrail** — the `DecisionFrame` and `ExecutionRequest` are evaluated
   against policies before anything executes.
3. **Runtime** — LangGraph orchestrates the workflow, manages conversation
   state, and handles approval gate suspension/resumption.
4. **Capabilities** — deterministic handlers execute the authorized operation.

The library (`src/`) defines all interfaces. You provide the concrete
implementations. Nothing in the library imports from LangGraph or any LLM SDK.

---

## Prerequisites

- Node.js ≥ 20
- npm ≥ 10
- An API key for your chosen LLM provider (Anthropic, OpenAI, etc.)

---

## Running the dashboard (no backend required)

The UI dashboard runs on static mock data and requires no API keys.

```bash
cp .env.example .env.local
npm install
npm run dev
# → http://localhost:3000/dashboard
```

---

## Wiring a real LLM — step by step

You need to implement three concrete classes and one runtime server.
All four implementations live **outside** this library — in your application code.

### Step 1 — Install dependencies

```bash
npm install @anthropic-ai/sdk        # or openai, etc.
npm install @langchain/langgraph
```

### Step 2 — Implement `FrameProjector`

The `FrameProjector` calls your LLM to interpret the user's message and
construct a `DecisionFrame` — the bounded operational context for this turn.

```typescript
// app/projector.ts
import type {
  FrameProjector,
  ProjectionInput,
  ProjectionResult,
} from "projection-control-plane/langgraph";
import Anthropic from "@anthropic-ai/sdk";

export class AnthropicFrameProjector implements FrameProjector {
  constructor(private client: Anthropic) {}

  async project(input: ProjectionInput): Promise<ProjectionResult> {
    const response = await this.client.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 2048,
      system: PROJECTION_SYSTEM_PROMPT,    // your prompt that produces a frame
      messages: input.conversationHistory.map((m) => ({
        role: m.role === "user" ? "user" : "assistant",
        content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      })),
    });

    // Parse the structured response into a DecisionFrame + ExecutionRequest
    // The frame must be bounded to the authorized scope for this principal.
    const parsed = parseFrameFromResponse(response);

    if (!parsed) {
      return { outcome: "clarification-needed", clarificationMessage: "..." };
    }

    return {
      outcome: "frame-built",
      frame: parsed.frame,
      executionRequest: parsed.executionRequest, // exactly one per turn
    };
  }
}
```

> **Key invariant:** `ProjectionResult` with `outcome: "frame-built"` carries
> exactly **one** `executionRequest`. Multiple requests per turn bypass the
> one-request-per-Guardrail-pass governance boundary.

### Step 3 — Implement `ResponseSynthesizer`

The `ResponseSynthesizer` generates the natural language response after
execution. It receives a sanitized `GovernanceOutcomeSummary` — never the
raw `GuardrailResult` — to prevent policy internals leaking into the LLM context.

```typescript
// app/synthesizer.ts
import type {
  ResponseSynthesizer,
  ResponseSynthesisInput,
  ResponseTokenChunk,
} from "projection-control-plane/langgraph";
import type { ConversationMessage } from "projection-control-plane/langgraph";
import Anthropic from "@anthropic-ai/sdk";

export class AnthropicResponseSynthesizer implements ResponseSynthesizer {
  constructor(private client: Anthropic) {}

  async generate(input: ResponseSynthesisInput): Promise<ConversationMessage> {
    const response = await this.client.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 1024,
      system: buildSynthesisPrompt(input),
      messages: input.messages.map(toAnthropicMessage),
    });

    return {
      messageId: crypto.randomUUID(),
      role: "assistant",
      content: extractText(response),
      createdAt: new Date().toISOString(),
    };
  }

  async *stream(
    input: ResponseSynthesisInput,
  ): AsyncIterable<ResponseTokenChunk> {
    const stream = await this.client.messages.stream({
      model: "claude-opus-4-5",
      max_tokens: 1024,
      system: buildSynthesisPrompt(input),
      messages: input.messages.map(toAnthropicMessage),
    });

    for await (const chunk of stream) {
      if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
        yield { delta: chunk.delta.text };
      }
    }
  }
}
```

### Step 4 — Implement `LangGraphOrchestrationAdapter`

This is the only place `@langchain/langgraph` is imported. It bridges the
PCP graph definition to a compiled LangGraph graph.

```typescript
// app/langgraph-adapter.ts
import { StateGraph, Annotation, MemorySaver } from "@langchain/langgraph";
import type {
  LangGraphOrchestrationAdapter,
  OrchestrationGraphDefinition,
  OrchestrationContext,
  CompiledOrchestrationGraph,
  LangGraphAdapterConfig,
  OrchestrationState,
} from "projection-control-plane/langgraph";
import { ORCHESTRATION_STATE_CHANNELS } from "projection-control-plane/langgraph";

export class LangGraphAdapter implements LangGraphOrchestrationAdapter<...> {
  constructor(private config: LangGraphAdapterConfig<MemorySaver>) {}

  buildGraph(
    definition: OrchestrationGraphDefinition,
    context: OrchestrationContext,
  ): CompiledOrchestrationGraph<...> {
    // 1. Build the Annotation from ORCHESTRATION_STATE_CHANNELS
    // 2. Add nodes from definition.nodes
    // 3. Add edges from definition.edges
    // 4. Set entry point
    // 5. Compile with checkpointer and interruptBefore for approval nodes
    // 6. Return a CompiledOrchestrationGraph wrapper
  }
}
```

See `src/langgraph/adapter.ts` for the full interface contract and
`src/langgraph/index.ts` for the complete JSDoc wiring example.

### Step 5 — Assemble `OrchestrationServices`

```typescript
// app/services.ts
import type { OrchestrationServices } from "projection-control-plane/langgraph";

export function buildServices(): OrchestrationServices {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  return {
    projector:    new AnthropicFrameProjector(anthropic),
    guardrail:    new MyGuardrailEvaluator(policyStore),
    dispatcher:   new MyCapabilityDispatcher(capabilityRegistry),
    approval:     new MyApprovalGateway(approvalService),
    synthesizer:  new AnthropicResponseSynthesizer(anthropic),
    auditEmitter: new MyAuditEmitter(db),
    hookExecutor: new MyHookExecutor(hookRegistry),
  };
}
```

### Step 6 — Build the graph

```typescript
// app/graph.ts
import {
  WorkflowGraphBuilder,
  StandardWorkflowGraphDefinition,
  StandardNodeId,
} from "projection-control-plane/langgraph";

export function buildGraph(services: OrchestrationServices) {
  return new WorkflowGraphBuilder(StandardWorkflowGraphDefinition)
    .replaceNode(StandardNodeId.RECEIVE_INPUT,      buildReceiveInputNode(services))
    .replaceNode(StandardNodeId.PROJECT_FRAME,      buildProjectFrameNode(services))
    .replaceNode(StandardNodeId.EVALUATE_GUARDRAIL, buildEvaluateGuardrailNode(services))
    .replaceNode(StandardNodeId.REQUEST_APPROVAL,   buildRequestApprovalNode(services))
    .replaceNode(StandardNodeId.EXECUTE_CAPABILITY, buildExecuteCapabilityNode(services))
    .replaceNode(StandardNodeId.GENERATE_RESPONSE,  buildGenerateResponseNode(services))
    .replaceNode(StandardNodeId.HANDLE_ERROR,       buildHandleErrorNode(services))
    .replaceNode(StandardNodeId.TERMINATE,          buildTerminateNode(services))
    .build();
}
```

### Step 7 — Stand up a runtime server

The UI dashboard (`src/lib/runtime/client.ts`) calls three endpoints:

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/execute` | POST | Submit a new request |
| `/api/execute/:id` | GET | Retrieve an execution trace |
| `/api/execute/:id/stream` | GET (SSE) | Stream `OrchestrationStreamEvent`s |
| `/api/approve/:gateId` | POST | Resolve an approval gate |

Wire these to `compiledGraph.invoke()`, `compiledGraph.stream()`, and
`compiledGraph.resumeApproval()` respectively.

---

## Scripts

```bash
npm run dev           # Start the UI dashboard (http://localhost:3000)
npm run build:lib     # Compile the library to dist/
npm run typecheck     # Type-check the library (strict, NodeNext)
npm run typecheck:app # Type-check the Next.js app
npm run build         # Production build of the dashboard
```

---

## Governance invariants (do not break)

These are enforced by the type system and should be respected in any
implementation:

1. **One request per turn** — `ProjectionResult` carries a single
   `executionRequest`. Multiple requests bypass per-request governance.
2. **No raw GuardrailResult to the synthesizer** — use `GovernanceOutcomeSummary`
   only. Raw results leak policy topology to the LLM context.
3. **No "tool" role in conversation** — capability invocations travel as
   `CapabilityRequestContentBlock` / `CapabilityResultContentBlock` within
   governed messages, not as direct LLM tool calls.
4. **Capabilities only execute after Guardrail** — the graph topology enforces
   this; do not add edges that bypass the guardrail node.
5. **LangGraph imports only in the adapter** — nothing in `src/` imports from
   `@langchain/langgraph`. Keep it that way.

---

## License

Apache 2.0 — see [LICENSE](./LICENSE).
