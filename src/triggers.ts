import { transcriptText } from "./picker.ts";
import type { TriggerMode } from "./settings.ts";

type ContextMessage = { role: string; content?: unknown; toolCallId?: string; timestamp?: number };

function toolResultKeys(messages: ContextMessage[]): string[] {
  return messages.flatMap((message, index) => {
    if (message.role !== "toolResult") return [];
    const text = typeof message.content === "string" ? message.content : Array.isArray(message.content)
      ? message.content.filter((block) => block?.type === "text" && typeof block.text === "string").map((block) => block.text).join(" ") : "";
    if (!text.trim()) return []; // Jev cannot use non-text tool output.
    if (message.toolCallId) return [`id:${message.toolCallId}`];
    return [`fallback:${index}:${message.timestamp ?? 0}:${text.slice(0, 512)}`];
  });
}

/** One snapshot per model request, never per streamed token or tool-progress event. */
export class TriggerTracker {
  private lastContext = "";
  private seenTools = new Set<string>();

  reset(): void {
    this.lastContext = "";
    this.seenTools.clear();
  }

  snapshot(messages: ContextMessage[], prompt: string): void {
    this.lastContext = transcriptText(messages, prompt);
    this.seenTools = new Set(toolResultKeys(messages));
  }

  shouldRank(mode: TriggerMode, messages: ContextMessage[], prompt: string): boolean {
    const context = transcriptText(messages, prompt);
    const changed = context !== this.lastContext;
    const keys = toolResultKeys(messages);
    const newToolResult = keys.some((key) => !this.seenTools.has(key));
    keys.forEach((key) => this.seenTools.add(key));
    this.lastContext = context;
    if (!context) return false;
    if (mode === "prompt-only") return false;
    if (mode === "prompt-and-tools") return newToolResult;
    return changed;
  }
}
