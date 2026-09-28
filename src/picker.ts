import { closeSync, openSync, readSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import YAML from "yaml";

export interface Skill {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  disableModelInvocation: boolean;
  sourceInfo: { path: string; source: string; scope: "project"; origin: "top-level"; baseDir: string };
}

const ignored = new Set(["node_modules", ".git", ".next", "dist", "build", "vendor", "target", ".venv", "venv", ".cache"]);

/** Only parse YAML frontmatter; never send skill bodies to Jev. */
export function discoverSkills(root: string): Skill[] {
  const result: Skill[] = [];
  const walk = (dir: string) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (!entry.isFile() || entry.name !== "SKILL.md") continue;
      const filePath = join(dir, entry.name);
      try {
        const fd = openSync(filePath, "r");
        const buf = Buffer.alloc(16_384);
        let size: number;
        try { size = readSync(fd, buf, 0, buf.length, 0); } finally { closeSync(fd); }
        const text = buf.toString("utf8", 0, size);
        const match = /^---\s*\r?\n([\s\S]*?)\r?\n---(?:\s*\r?\n|$)/.exec(text);
        if (!match) continue;
        const meta = YAML.parse(match[1]);
        if (!meta || typeof meta !== "object" || typeof meta.description !== "string" || !meta.description.trim()) continue;
        const name = typeof meta.name === "string" && meta.name.trim() ? meta.name.trim() : basename(dir);
        result.push({ name, description: meta.description.trim(), filePath, baseDir: dirname(filePath),
          disableModelInvocation: meta["disable-model-invocation"] === true,
          sourceInfo: { path: filePath, source: "pi-skill-picker-jev", scope: "project", origin: "top-level", baseDir: dirname(filePath) } });
      } catch { /* Ignore unreadable/invalid skill manifests, never interrupt a Pi turn. */ }
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !ignored.has(entry.name)) walk(join(dir, entry.name));
    }
  };
  walk(resolve(root));
  return result.sort((a, b) => a.filePath.localeCompare(b.filePath));
}

export function uniqueSkills(skills: Skill[]): Skill[] {
  const names = new Set<string>();
  return skills.filter((skill) => {
    if (skill.disableModelInvocation || names.has(skill.name)) return false;
    names.add(skill.name);
    return true;
  });
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
): Promise<Skill[]> {
  if (!options.apiKey || !candidates.length || !task.trim()) return [];
  const fetcher = options.fetcher ?? fetch;
  const batchSize = Math.max(1, Math.min(60, options.batchSize ?? 40));
  const threshold = options.threshold ?? 0.75;
  const scores: Array<{ skill: Skill; probability: number }> = [];
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
        if (typeof probability === "number" && probability >= threshold) scores.push({ skill, probability });
      });
    } finally { clearTimeout(timeout); }
  }
  return scores.sort((a, b) => b.probability - a.probability).slice(0, options.maxNew ?? 6).map(({ skill }) => skill);
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
