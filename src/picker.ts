import type { Skill } from "@earendil-works/pi-coding-agent";

export interface RankedSkill {
  skill: Skill;
  probability: number;
}

export interface DecisionCallUsage {
  model: string;
  input: number;
  output: number;
  cost: number;
}

export interface DecisionOptions {
  apiKey: string;
  model?: string;
  threshold?: number;
  batchSize?: number;
  maxNew?: number;
  /** Score general usefulness independently of the current task (settings UI only). */
  globalImportance?: boolean;
  fetcher?: typeof fetch;
  /** One callback per successful Jev API request/batch, including batches with no selected skills. */
  onUsage?: (usage: DecisionCallUsage) => void;
}

/** Rank every unsent candidate in batches. Never fail open by displaying all skills. */
export async function rankSkills(
  task: string, candidates: Skill[], alreadySent: Skill[], options: DecisionOptions,
): Promise<RankedSkill[]> {
  if (!options.apiKey || !candidates.length || !task.trim()) return [];
  const fetcher = options.fetcher ?? fetch;
  const batchSize = Math.max(1, Math.min(60, options.batchSize ?? 40));
  const threshold = options.threshold ?? 0.75;
  const batchCount = Math.ceil(candidates.length / batchSize);
  const results: RankedSkill[][] = Array.from({ length: batchCount }, () => []);
  let nextBatch = 0;
  let failure: unknown;
  let failed = false;
  // Run up to three requests at a time, without leaving in-flight batches behind on failure.
  async function worker(): Promise<void> {
    while (nextBatch < batchCount && !failed) {
      const index = nextBatch++;
      try {
        results[index] = await rankBatch(index);
      } catch (error) {
        if (!failed) failure = error;
        failed = true;
      }
    }
  }
  async function rankBatch(index: number): Promise<RankedSkill[]> {
    const batch = candidates.slice(index * batchSize, (index + 1) * batchSize);
    const questions = Object.fromEntries(batch.map((skill, i) => [
      `s${i}`, { type: "noul", instructions: options.globalImportance
        ? `Would this skill be broadly important to keep available across tasks in a project? Name: ${skill.name}. Description: ${skill.description.slice(0, 1200)}`
        : `Would this skill be directly useful for the current task? Name: ${skill.name}. Description: ${skill.description.slice(0, 1200)}`,
        criteria: options.globalImportance
          ? { true: "Broadly useful across many tasks; important to keep available globally.", false: "Specialized or rarely useful; not important globally." }
          : { true: "Directly useful for this task; include its description in the agent context.", false: "Not needed now; omit it from the agent context." } },
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
      const data = await response.json() as { model?: string; usage?: { input_tokens?: number; output_tokens?: number; cost?: number }; answers?: Record<string, { noul?: number }> };
      const usage = data.usage;
      if (usage && typeof usage.cost === "number" && Number.isFinite(usage.cost) && usage.cost >= 0) {
        const nonnegative = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : 0;
        try {
          options.onUsage?.({ model: data.model || options.model || "typesafe/jev-1.13",
            input: nonnegative(usage.input_tokens), output: nonnegative(usage.output_tokens), cost: usage.cost });
        } catch (error) {
          console.error("[pi-skill-picker-jev] Could not record Jev usage:", error);
        }
      }
      return batch.flatMap((skill, i) => {
        const probability = data.answers?.[`s${i}`]?.noul;
        return typeof probability === "number" && Number.isFinite(probability) && probability >= threshold && probability <= 1
          ? [{ skill, probability }] : [];
      });
    } finally { clearTimeout(timeout); }
  }
  await Promise.all(Array.from({ length: Math.min(3, batchCount) }, () => worker()));
  if (failed) throw failure;
  return results.flat().sort((a, b) => b.probability - a.probability).slice(0, options.maxNew ?? 6);
}

export function transcriptText(messages: Array<{ role: string; content?: unknown }>, lastPrompt = ""): string {
  const parts = messages.filter((m) => m.role === "user" || m.role === "assistant" || m.role === "toolResult")
    .map((m) => {
      const blocks = typeof m.content === "string" ? m.content : Array.isArray(m.content)
        ? m.content.filter((b) => b?.type === "text" && typeof b.text === "string").map((b) => b.text).join(" ") : "";
      return blocks.trim() ? `${m.role}: ${blocks.slice(0, 1200)}` : "";
    }).filter(Boolean).slice(-14);
  return [...parts, lastPrompt && `Current user request: ${lastPrompt}`].filter(Boolean).join("\n").slice(-12_000);
}
