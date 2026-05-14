import type { LLMProvider, LLMMessage, LLMChatOptions } from "../types";

export class OpenAIProvider implements LLMProvider {
  private readonly model: string;

  constructor() {
    this.model = process.env["LLM_MODEL"] ?? "gpt-4o";
  }

  async chat(messages: LLMMessage[], options: LLMChatOptions = {}): Promise<string> {
    // Lazy import — requires: npm install openai
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let OpenAI: any;
    try {
      // @ts-ignore — optional dependency, not installed until user runs: npm install openai
      ({ default: OpenAI } = await import("openai"));
    } catch {
      throw new Error(
        "OpenAI provider requires the 'openai' package. Run: npm install openai",
      );
    }

    const client = new OpenAI({
      apiKey: process.env["OPENAI_API_KEY"],
    });

    const response = await client.chat.completions.create({
      model: this.model,
      messages,
      temperature: options.temperature ?? 0.2,
      max_tokens: options.maxTokens ?? 1024,
      ...(options.json ? { response_format: { type: "json_object" } } : {}),
    });

    return response.choices[0]?.message.content ?? "";
  }
}
