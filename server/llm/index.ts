import { OllamaProvider } from "./providers/ollama";
import { OpenAIProvider } from "./providers/openai";
import { AnthropicProvider } from "./providers/anthropic";
import { MockProvider } from "./providers/mock";
import type { LLMProvider } from "./types";

export type { LLMProvider, LLMMessage, LLMChatOptions } from "./types";

let _provider: LLMProvider | null = null;

/**
 * Returns the configured LLM provider, creating it once and caching it.
 *
 * Set LLM_PROVIDER to select the backend (default: "ollama"):
 *   LLM_PROVIDER=mock       — No LLM, keyword-based deterministic responses (default for hosted demos)
 *   LLM_PROVIDER=ollama     — Ollama local inference (default model: gemma3:4b)
 *   LLM_PROVIDER=openai     — OpenAI API           (default model: gpt-4o)
 *   LLM_PROVIDER=anthropic  — Anthropic API        (default model: claude-sonnet-4-6)
 *
 * Set LLM_MODEL to override the default model for the selected provider.
 */
export function getLLMProvider(): LLMProvider {
  if (_provider) return _provider;

  const name = process.env["LLM_PROVIDER"] ?? "ollama";

  switch (name) {
    case "mock":
      _provider = new MockProvider();
      break;
    case "ollama":
      _provider = new OllamaProvider();
      break;
    case "openai":
      _provider = new OpenAIProvider();
      break;
    case "anthropic":
      _provider = new AnthropicProvider();
      break;
    default:
      throw new Error(
        `Unknown LLM_PROVIDER: "${name}". Supported values: mock, ollama, openai, anthropic`,
      );
  }

  console.log(`[llm] Provider: ${name} / model: ${process.env["LLM_MODEL"] ?? "(default)"}`);
  return _provider;
}
