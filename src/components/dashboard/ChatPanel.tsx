"use client";

import { useState, useRef, useEffect, useId } from "react";
import type { MockAuditEvent } from "@/lib/mock/execution";
import { sendChatMessage } from "@/lib/runtime/client";
import { AuditTimeline } from "./AuditTimeline";

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "error";
  content: string;
}

interface ChatPanelProps {
  principalId: string;
}

export function ChatPanel({ principalId }: ChatPanelProps) {
  const uid = useId();
  const conversationId = `conv-${uid.replace(/:/g, "")}`;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [auditEvents, setAuditEvents] = useState<MockAuditEvent[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [turnCount, setTurnCount] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend(overrideText?: string) {
    const text = (overrideText ?? input).trim();
    if (!text || isSending) return;

    setMessages((prev) => [...prev, { id: `msg-${Date.now()}`, role: "user", content: text }]);
    if (!overrideText) setInput("");
    setIsSending(true);

    try {
      const result = await sendChatMessage({
        principalId,
        userMessage: text,
        conversationId,
        sessionId: `sess-${conversationId}`,
      });

      setTurnCount(result.turnCount);
      setMessages((prev) => [
        ...prev,
        { id: `msg-${Date.now()}`, role: "assistant", content: result.response },
      ]);
      if (result.auditEvents?.length) {
        setAuditEvents((prev) => [...prev, ...result.auditEvents]);
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { id: `msg-err-${Date.now()}`, role: "error", content: err instanceof Error ? err.message : "Request failed." },
      ]);
    } finally {
      setIsSending(false);
      textareaRef.current?.focus();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  return (
    <>
    <div className="flex flex-col rounded-lg border border-slate-800 bg-slate-900/60 h-[600px]">

      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-slate-300">Chat</span>
          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-500">
            {conversationId}
          </span>
        </div>
        {turnCount > 0 && (
          <span className="text-[10px] text-slate-600">
            {turnCount} {turnCount === 1 ? "turn" : "turns"}
          </span>
        )}
      </div>

      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="flex h-full items-center justify-center text-xs text-slate-600">
            Start a conversation.
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[82%] rounded-lg px-3 py-2 text-xs leading-relaxed ${
                msg.role === "user"
                  ? "bg-violet-900/60 text-slate-200"
                  : msg.role === "error"
                    ? "bg-red-950/60 text-red-400"
                    : "bg-slate-800 text-slate-300"
              }`}
            >
              {msg.role !== "user" && (
                <div className={`mb-1 text-[10px] font-medium ${msg.role === "error" ? "text-red-500" : "text-slate-500"}`}>
                  {msg.role === "error" ? "Error" : "Projection Runtime"}
                </div>
              )}
              <span className="whitespace-pre-wrap">{msg.content}</span>
            </div>
          </div>
        ))}

        {isSending && (
          <div className="flex justify-start">
            <div className="flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2">
              <div className="h-1 w-1 animate-bounce rounded-full bg-slate-500 [animation-delay:-0.3s]" />
              <div className="h-1 w-1 animate-bounce rounded-full bg-slate-500 [animation-delay:-0.15s]" />
              <div className="h-1 w-1 animate-bounce rounded-full bg-slate-500" />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input row */}
      <div className="border-t border-slate-800 px-4 py-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isSending}
            placeholder="Message the runtime… (Enter to send, Shift+Enter for newline)"
            rows={2}
            className="flex-1 resize-none rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200 placeholder:text-slate-600 focus:border-violet-700 focus:outline-none disabled:opacity-50"
          />
          <button
            onClick={() => void handleSend()}
            disabled={isSending || !input.trim()}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-700 bg-slate-800 text-slate-400 transition-colors hover:border-violet-700 hover:text-slate-200 disabled:opacity-40"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M1 7h12M7 1l6 6-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
        <div className="mt-1.5 text-[10px] text-slate-700">Principal: {principalId}</div>
      </div>

    </div>

    {auditEvents.length > 0 && (
      <div className="mt-5">
        <AuditTimeline events={auditEvents} />
      </div>
    )}
    </>
  );
}
