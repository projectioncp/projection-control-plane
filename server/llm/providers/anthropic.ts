import type { LLMProvider, LLMMessage, LLMChatOptions } from "../types";

export class AnthropicProvider implements LLMProvider {
  private readonly model: string;

  constructor() {
    this.model = process.env["LLM_MODEL"] ?? "claude-opus-4-5";
  }

  async chat(messages: LLMMessage[], options: LLMChatOptions = {}): Promise<string> {
    // Lazy import — requires: npm install @anthropic-ai/sdk
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let Anthropic: any;
    try {
      // @ts-ignore — optional dependency, not installed until user runs: npm install @anthropic-ai/sdk
      ({ default: Anthropic } = await import("@anthropic-ai/sdk"));
    } catch {
      throw new Error(
        "Anthropic provider requires the '@anthropic-ai/sdk' package. Run: npm install @anthropic-ai/sdk",
      );
    }

    const client = new Anthropic({
      apiKey: process.env["ANTHROPIC_API_KEY"],
    });

    // Anthropic separates system from user/assistant messages
    const systemMsg = messages.find((m) => m.role === "system");
    const conversationMsgs = messages.filter((m) => m.role !== "system");

    const response = await client.messages.create({
      model: this.model,
      max_tokens: options.maxTokens ?? 1024,
      system: systemMsg?.content,
      messages: conversationMsgs.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    });

    const block = response.content[0];
    return block?.type === "text" ? block.text : "";
  }
}
