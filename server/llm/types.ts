export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMChatOptions {
  temperature?: number;
  maxTokens?: number;
  /** Request structured JSON output. Providers that support native JSON mode will use it. */
  json?: boolean;
}

export interface LLMProvider {
  chat(messages: LLMMessage[], options?: LLMChatOptions): Promise<string>;
}
