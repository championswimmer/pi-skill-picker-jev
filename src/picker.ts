import type { Skill } from "@earendil-works/pi-coding-agent";
import { DEFAULT_SETTINGS, parseApiBaseUrl } from "./settings.ts";

export interface RankedSkill {
  skill: Skill;
  /** TypeSafe's expected rubric level normalized to [0,1], not a probability. */
  score: number;
}

export interface DecisionCallUsage {
  model: string;
  input: number;
  output: number;
  cost: number;
}

export interface DecisionOptions {
  apiKey: string;
  apiBaseUrl?: string;
  model?: string;
  threshold?: number;
  batchSize?: number;
  maxNew?: number;
  /** Score general usefulness independently of the current task (settings UI only). */
  globalImportance?: boolean;
  /** Score skills needed to work on topics supplied by the allowlist search bar. */
  topicSearch?: boolean;
  fetcher?: typeof fetch;
  /** Optional shared deadline/cancellation across all batches. */
  signal?: AbortSignal;
  /** One callback per successful Jev API request/batch, including batches with no selected skills. */
  onUsage?: (usage: DecisionCallUsage) => void;
}

// Concrete, independently understandable levels per TypeSafe's Score guidance.
// Each rubric measures one dimension; array position is the level number.
const TASK_LEVELS = [
  "Unrelated; no help for this task.",
  "Related topic; no actionable help.",
  "Optional support; not directly needed.",
  "Directly useful for a concrete part of the task.",
  "Essential to the task's central work.",
];
const TOPIC_LEVELS = [
  "Unrelated to the topics in the search query; provides no help working on them.",
  "Mentions an adjacent topic but offers no actionable help for the queried topics.",
  "Offers optional background or supporting techniques for the queried topics.",
  "Provides techniques directly useful for a concrete part of work on the queried topics.",
  "Provides core techniques required to work on the topics in the search query.",
];
const IMPORTANCE_LEVELS = [
  "Has no practical use in project work.",
  "Useful only in rare, narrowly specialized project tasks.",
  "Useful in recurring tasks within one specialized area of a project.",
  "Useful in several common kinds of tasks across a project.",
  "Foundational guidance useful in most everyday tasks across a project.",
];

/** Rank every unsent candidate in batches. Never fail open by displaying all skills. */
export async function rankSkills(
  task: string, candidates: Skill[], alreadySent: Skill[], options: DecisionOptions,
): Promise<RankedSkill[]> {
  if ((!options.apiKey && !options.apiBaseUrl) || !candidates.length || !task.trim()) return [];
  const base = options.apiBaseUrl === undefined ? undefined : parseApiBaseUrl(options.apiBaseUrl);
  if (options.apiBaseUrl !== undefined && !base) throw new Error("Invalid TypeSafe API base URL");
  const endpoint = base ? `${base.replace(/\/v1$/, "")}/v1/systemone` : "https://openrouter.ai/api/alpha/decisions";
  const model = options.model ?? (base ? "jev-latest" : "typesafe/jev-1.13");
  const fetcher = options.fetcher ?? fetch;
  const batchSize = Math.max(1, Math.min(60, options.batchSize ?? 50));
  const threshold = options.threshold ?? DEFAULT_SETTINGS.threshold;
  const batchCount = Math.ceil(candidates.length / batchSize);
  const results: RankedSkill[][] = Array.from({ length: batchCount }, () => []);
  let nextBatch = 0;
  let failure: unknown;
  let failed = false;
  // Run up to six requests at a time, without leaving in-flight batches behind on failure.
  async function worker(): Promise<void> {
    while (nextBatch < batchCount && !failed && !options.signal?.aborted) {
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
      `s${i}`, { type: "score", instructions: options.globalImportance
        ? `How broadly useful is this skill across tasks in a project? Name: ${skill.name}. Description: ${skill.description.slice(0, 1200)}`
        : options.topicSearch
          ? `How useful is this skill for work on the topics in the search query (state.task)? Name: ${skill.name}. Description: ${skill.description.slice(0, 1200)}`
          : `How useful would this skill be for the current task? Name: ${skill.name}. Description: ${skill.description.slice(0, 1200)}`,
        criteria: options.globalImportance ? IMPORTANCE_LEVELS : options.topicSearch ? TOPIC_LEVELS : TASK_LEVELS },
    ]));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetcher(endpoint, {
        // Do not forward credentials or private task text through server redirects.
        redirect: "error",
        method: "POST", signal: options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal,
        headers: {
          ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
          "Content-Type": "application/json",
          // Attribute OpenRouter calls to the host agent and this extension, rather
          // than letting Node's generic fetch user-agent identify the client.
          ...(!base ? { "User-Agent": "pi-coding-agent (pi-skill-picker-jev)", "X-Title": "Pi Coding Agent" } : {}),
        },
        body: JSON.stringify({ model, state: {
          task: task.slice(-12_000), already_available: alreadySent.map((s) => `${s.name}: ${s.description}`).join("\n").slice(0, 3000),
        }, questions }),
      });
      if (!response.ok) throw new Error(`${base ? "TypeSafe API" : "OpenRouter"} returned ${response.status}`);
      const data = await response.json() as { model?: string; usage?: { input_tokens?: number; output_tokens?: number; cost?: number }; answers?: Record<string, { type?: string; score?: number } | null> };
      const usage = data.usage;
      if (usage && typeof usage.cost === "number" && Number.isFinite(usage.cost) && usage.cost >= 0) {
        const nonnegative = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : 0;
        try {
          options.onUsage?.({ model: data.model || model,
            input: nonnegative(usage.input_tokens), output: nonnegative(usage.output_tokens), cost: usage.cost });
        } catch (error) {
          console.error("[pi-skill-picker-jev] Could not record Jev usage:", error);
        }
      }
      return batch.flatMap((skill, i) => {
        const answer = data.answers?.[`s${i}`];
        const raw = answer?.score;
        const topLevel = questions[`s${i}`].criteria.length - 1;
        // Do not reinterpret legacy Noul responses, clamp malformed ratings, or
        // multiply by confidence (distribution concentration is not usefulness).
        if (answer?.type !== "score" || typeof raw !== "number" || !Number.isFinite(raw) || raw < 0 || raw > topLevel) return [];
        const score = raw / topLevel;
        return score >= threshold ? [{ skill, score }] : [];
      });
    } finally { clearTimeout(timeout); }
  }
  await Promise.all(Array.from({ length: Math.min(6, batchCount) }, () => worker()));
  if (failed) throw failure;
  if (options.signal?.aborted) throw options.signal.reason;
  return results.flat().sort((a, b) => b.score - a.score).slice(0, options.maxNew ?? 6);
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
