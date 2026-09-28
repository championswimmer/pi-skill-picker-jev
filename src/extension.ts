import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { discoverSkills, rankSkills, transcriptText, uniqueSkills, type Skill } from "./picker.ts";

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/** Matches Pi's native skills prompt section; only selected metadata is exposed. */
export function renderSkills(skills: Skill[]): string {
  if (!skills.length) return "";
  return ["\n\nThe following skills provide specialized instructions for specific tasks.",
    "Use the read tool to load a skill's file when the task matches its description.",
    "When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.",
    "", "<available_skills>",
    ...skills.flatMap((skill) => ["  <skill>", `    <name>${xml(skill.name)}</name>`,
      `    <description>${xml(skill.description)}</description>`, `    <location>${xml(skill.filePath)}</location>`, "  </skill>"]),
    "</available_skills>"].join("\n");
}

export default function skillPicker(pi: ExtensionAPI) {
  const selected = new Map<string, Skill>();
  let inventory: Skill[] = [];
  let skipFirstRequest = false;
  let lastPrompt = "";
  let lastContext = "";

  pi.on("session_start", async () => {
    selected.clear();
    inventory = [];
    lastPrompt = "";
    lastContext = "";
    skipFirstRequest = false;
  });

  pi.on("before_agent_start", async (event, ctx) => {
    lastPrompt = event.prompt;
    // Use Pi's loaded skills first, so its existing discovery/precedence rules win.
    // PI_SKILL_PICKER_ROOT can point at any monorepo. Otherwise use ./mono, or cwd.
    const root = process.env.PI_SKILL_PICKER_ROOT ?? (existsSync(join(ctx.cwd, "mono")) ? join(ctx.cwd, "mono") : ctx.cwd);
    const discovered = discoverSkills(root);
    const piSkills = event.systemPromptOptions.skills as Skill[];
    inventory = uniqueSkills([...piSkills, ...discovered]);
    // Always remove Pi's original full skills list, including on API failure.
    event.systemPromptOptions.skills = [...selected.values()] as typeof event.systemPromptOptions.skills;
    const pending = inventory.filter((skill) => !selected.has(skill.name));
    if (pending.length) {
      try {
        const newlySelected = await rankSkills(lastPrompt, pending, [...selected.values()], {
          apiKey: process.env.OPENROUTER_API_KEY ?? "",
          model: process.env.PI_SKILL_PICKER_MODEL,
          threshold: Number(process.env.PI_SKILL_PICKER_THRESHOLD ?? 0.75),
          maxNew: Number(process.env.PI_SKILL_PICKER_MAX_NEW ?? 6),
        });
        for (const skill of newlySelected) selected.set(skill.name, skill);
      } catch (error) {
        console.error("[pi-skill-picker-jev] Initial ranking failed (skills hidden):", error);
      }
    }
    event.systemPromptOptions.skills = [...selected.values()] as typeof event.systemPromptOptions.skills;
    skipFirstRequest = true;
    lastContext = "";
  });

  pi.on("context_with_system", async (event) => {
    if (skipFirstRequest) {
      skipFirstRequest = false;
      return;
    }
    const context = transcriptText(event.messages, lastPrompt);
    const pending = inventory.filter((skill) => !selected.has(skill.name));
    if (context && context !== lastContext && pending.length) {
      lastContext = context;
      try {
        const newlySelected = await rankSkills(context, pending, [...selected.values()], {
          apiKey: process.env.OPENROUTER_API_KEY ?? "",
          model: process.env.PI_SKILL_PICKER_MODEL,
          threshold: Number(process.env.PI_SKILL_PICKER_THRESHOLD ?? 0.75),
          maxNew: Number(process.env.PI_SKILL_PICKER_MAX_NEW ?? 6),
        });
        for (const skill of newlySelected) selected.set(skill.name, skill);
      } catch (error) {
        console.error("[pi-skill-picker-jev] Incremental ranking failed (keeping previous skills):", error);
      }
    }
    // Pi's system prompt is section-based. Override ONLY its skills section for
    // this request, preserving the head, tools, project context and other hooks.
    // This patch is request-local; the next request is rebuilt from selected skills.
    const skills = renderSkills([...selected.values()]);
    return { messages: [...event.messages, {
      role: "system" as const, content: "", sections: { skills: skills || null }, timestamp: Date.now(),
    }] };
  });
}
