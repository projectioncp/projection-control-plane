import { Ollama } from "ollama";
import type { LLMProvider, LLMMessage, LLMChatOptions } from "../types";

export class OllamaProvider implements LLMProvider {
  private readonly client: Ollama;
  private readonly model: string;

  constructor() {
    this.client = new Ollama({
      host: process.env["OLLAMA_HOST"] ?? "http://localhost:11434",
    });
    this.model = process.env["LLM_MODEL"] ?? process.env["PROJECTION_MODEL"] ?? "gemma3:4b";
  }

  async chat(messages: LLMMessage[], options: LLMChatOptions = {}): Promise<string> {
    const response = await this.client.chat({
      model: this.model,
      messages,
      ...(options.json ? { format: "json" } : {}),
      options: {
        temperature: options.temperature ?? 0.2,
        num_predict: options.maxTokens ?? 1024,
      },
    });
    return response.message.content;
  }
}
