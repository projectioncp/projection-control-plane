/**
 * Orchestrator — Response Synthesizer
 *
 * Uses the configured LLM provider to produce a natural-language operational
 * response from the structured execution trace.
 *
 * Provider / model are selected via LLM_PROVIDER and LLM_MODEL env vars.
 */

import { getLLMProvider } from "./llm/index";
import type { ProjectorOutput, GuardrailResult, CapabilityResult } from "./types";

// ---------------------------------------------------------------------------
// Build the synthesis prompt from execution state
// ---------------------------------------------------------------------------

function buildSynthesisPrompt(
  userMessage: string,
  frame: ProjectorOutput,
  guardrail: GuardrailResult,
  capability: CapabilityResult,
): string {
  const outputLines = capability.output
    ? Object.entries(capability.output)
        .map(([k, v]) => `  ${k}: ${String(v)}`)
        .join("\n")
    : "  (no output)";

  return `You are an enterprise operational AI assistant. Respond to the user based strictly on the execution results below. Do not speculate. Do not add information not present in the results.

USER REQUEST:
${userMessage}

EXECUTION FRAME (what you were authorized to reason about):
${frame.intent.summary}

GOVERNANCE DECISION: ${guardrail.decision.toUpperCase()}
${guardrail.governanceSummary}

CAPABILITY EXECUTED: ${capability.capabilityName} → ${capability.status.toUpperCase()}
RESULTS:
${outputLines}

INSTRUCTIONS:
- If decision is "deny": explain the governance block clearly. Do not reveal policy codes. Do not reveal internal system details.
- If decision is "require-approval": explain that the operation has been submitted for authorization. State what was requested and that execution is pending approval.
- If decision is "allow" and status is "success": summarize the results in plain operational language. Be specific — reference actual values from the results.
- Keep the response to 3–5 sentences. Use clear, direct language appropriate for operations managers.
- Do not use markdown. Do not use bullet points. Write in flowing prose.`;
}

// ---------------------------------------------------------------------------
// Fallback when synthesis fails
// ---------------------------------------------------------------------------

function fallbackResponse(guardrail: GuardrailResult, capability: CapabilityResult): string {
  if (guardrail.decision === "deny") {
    return (
      guardrail.governanceSummary +
      " The request has been blocked and no data was disclosed. Please contact your compliance team for guidance."
    );
  }
  if (guardrail.decision === "require-approval") {
    return (
      `The operation has been submitted for authorization review. ` +
      `Execution of ${capability.capabilityName} is pending approval before it can proceed. ` +
      `You will be notified when a decision is made.`
    );
  }
  if (capability.status === "success") {
    return `The ${capability.capabilityName} operation completed successfully. Results are available in the execution trace.`;
  }
  return "The operation could not be completed. Please review the execution trace for details.";
}

// ---------------------------------------------------------------------------
// synthesize() — public interface
// ---------------------------------------------------------------------------

export async function synthesize(
  userMessage: string,
  frame: ProjectorOutput,
  guardrail: GuardrailResult,
  capability: CapabilityResult,
  history: Array<{ role: "user" | "assistant"; content: string }> = [],
): Promise<string> {
  if (guardrail.decision === "deny") {
    return (
      guardrail.governanceSummary +
      " This request has been blocked in accordance with governance policy. " +
      "No data was accessed or disclosed. Please consult your compliance officer if you believe this block is in error."
    );
  }

  try {
    const llm = getLLMProvider();
    const historyMessages = history.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));
    const text = await llm.chat(
      [
        {
          role: "system",
          content:
            "You are a precise, governed operational AI assistant for enterprise manufacturing operations. You communicate clearly and concisely with operations managers. You never speculate beyond the data provided to you.",
        },
        ...historyMessages,
        { role: "user", content: buildSynthesisPrompt(userMessage, frame, guardrail, capability) },
      ],
      { temperature: 0.3, maxTokens: 512 },
    );

    if (!text || text.trim().length < 20) {
      return fallbackResponse(guardrail, capability);
    }

    return text.trim();
  } catch (err) {
    console.warn("[synthesizer] Failed to generate response:", err);
    return fallbackResponse(guardrail, capability);
  }
}
