import type { ExtensionAPI, Skill } from "@earendil-works/pi-coding-agent";
import { rankSkills, transcriptText } from "./picker.ts";
import { parseMaxNew, parseThreshold, readSettings, writeSettings } from "./settings.ts";

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
  let settings = readSettings();

  pi.registerCommand("skill-picker-settings", {
    description: "Set Jev skill relevance threshold and maximum new skills",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) return;
      for (;;) {
        const thresholdOption = `Threshold: ${settings.threshold}`;
        const maxNewOption = `Max new skills: ${settings.maxNew}`;
        const choice = await ctx.ui.select("Skill picker settings", [thresholdOption, maxNewOption, "Done"]);
        if (!choice || choice === "Done") break;
        const threshold = choice === thresholdOption;
        for (;;) {
          const value = await ctx.ui.input(
            threshold ? "Relevance threshold (0–1)" : "Maximum new skills (0–100)",
            String(threshold ? settings.threshold : settings.maxNew),
          );
          if (value === undefined) break;
          const parsed = threshold ? parseThreshold(value) : parseMaxNew(value);
          if (parsed === undefined) {
            ctx.ui.notify(threshold ? "Enter a number between 0 and 1." : "Enter a whole number from 0 to 100.", "warning");
            continue;
          }
          const updated = { ...settings, [threshold ? "threshold" : "maxNew"]: parsed };
          try {
            writeSettings(updated);
            settings = updated;
            ctx.ui.notify("Skill picker settings saved.", "info");
          } catch (error) {
            ctx.ui.notify(`Could not save skill picker settings: ${String(error)}`, "error");
          }
          break;
        }
      }
    },
  });

  pi.on("session_start", async () => {
    settings = readSettings();
    selected.clear();
    inventory = [];
    lastPrompt = "";
    lastContext = "";
    skipFirstRequest = false;
  });

  pi.on("before_agent_start", async (event, ctx) => {
    lastPrompt = event.prompt;
    // Intercept precisely the skills Pi loaded for this session/project.
    // No independent filesystem scanning or additional skill sources.
    const names = new Set<string>();
    inventory = event.systemPromptOptions.skills.filter((skill) => {
      if (skill.disableModelInvocation || names.has(skill.name)) return false;
      names.add(skill.name);
      return true;
    });
    for (const [name, skill] of selected) {
      if (!inventory.some((available) => available.name === name && available.filePath === skill.filePath)) selected.delete(name);
    }
    // Always remove Pi's original full skills list, including on API failure.
    event.systemPromptOptions.skills = [...selected.values()];
    const pending = inventory.filter((skill) => !selected.has(skill.name));
    if (pending.length) {
      try {
        const newlySelected = await rankSkills(lastPrompt, pending, [...selected.values()], {
          apiKey: await ctx.modelRegistry.getApiKeyForProvider("openrouter") ?? "",
          model: process.env.PI_SKILL_PICKER_MODEL,
          threshold: settings.threshold,
          maxNew: settings.maxNew,
        });
        for (const skill of newlySelected) selected.set(skill.name, skill);
      } catch (error) {
        console.error("[pi-skill-picker-jev] Initial ranking failed (skills hidden):", error);
      }
    }
    event.systemPromptOptions.skills = [...selected.values()];
    skipFirstRequest = true;
    lastContext = "";
  });

  pi.on("context_with_system", async (event, ctx) => {
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
          apiKey: await ctx.modelRegistry.getApiKeyForProvider("openrouter") ?? "",
          model: process.env.PI_SKILL_PICKER_MODEL,
          threshold: settings.threshold,
          maxNew: settings.maxNew,
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
