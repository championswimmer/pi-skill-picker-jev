import type { Skill } from "@earendil-works/pi-coding-agent";

export interface RankedSkill {
  skill: Skill;
  probability: number;
}

export interface DecisionOptions {
  apiKey: string;
  model?: string;
  threshold?: number;
  batchSize?: number;
  maxNew?: number;
  fetcher?: typeof fetch;
}

/** Rank every unsent candidate in batches. Never fail open by displaying all skills. */
export async function rankSkills(
  task: string, candidates: Skill[], alreadySent: Skill[], options: DecisionOptions,
): Promise<RankedSkill[]> {
  if (!options.apiKey || !candidates.length || !task.trim()) return [];
  const fetcher = options.fetcher ?? fetch;
  const batchSize = Math.max(1, Math.min(60, options.batchSize ?? 40));
  const threshold = options.threshold ?? 0.75;
  const scores: RankedSkill[] = [];
  // Sequential batching prevents rate-limit bursts and keeps the context per decision bounded.
  for (let start = 0; start < candidates.length; start += batchSize) {
    const batch = candidates.slice(start, start + batchSize);
    const questions = Object.fromEntries(batch.map((skill, i) => [
      `s${i}`, { type: "noul", instructions: `Would this skill be directly useful for the current task? Name: ${skill.name}. Description: ${skill.description.slice(0, 1200)}`,
        criteria: { true: "Directly useful for this task; include its description in the agent context.", false: "Not needed now; omit it from the agent context." } },
    ]));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetcher("https://openrouter.ai/api/alpha/decisions", {
        method: "POST", signal: controller.signal,
        headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: options.model ?? "typesafe/jev-1.13", state: {
          task: task.slice(-12_000), already_available: alreadySent.map((s) => `${s.name}: ${s.description}`).join("\n").slice(0, 3000),
        }, questions }),
      });
      if (!response.ok) throw new Error(`OpenRouter returned ${response.status}`);
      const data = await response.json() as { answers?: Record<string, { noul?: number }> };
      batch.forEach((skill, i) => {
        const probability = data.answers?.[`s${i}`]?.noul;
        if (typeof probability === "number" && Number.isFinite(probability) && probability >= threshold && probability <= 1) scores.push({ skill, probability });
      });
    } finally { clearTimeout(timeout); }
  }
  return scores.sort((a, b) => b.probability - a.probability).slice(0, options.maxNew ?? 6);
}

export function transcriptText(messages: Array<{ role: string; content?: unknown }>, lastPrompt = ""): string {
  const parts = messages.filter((m) => m.role === "user" || m.role === "assistant" || m.role === "toolResult")
    .slice(-14).map((m) => {
      const blocks = typeof m.content === "string" ? m.content : Array.isArray(m.content)
        ? m.content.filter((b) => b?.type === "text" && typeof b.text === "string").map((b) => b.text).join(" ") : "";
      return `${m.role}: ${blocks.slice(0, 1200)}`;
    });
  return [...parts, lastPrompt && `Current user request: ${lastPrompt}`].filter(Boolean).join("\n").slice(-12_000);
}
