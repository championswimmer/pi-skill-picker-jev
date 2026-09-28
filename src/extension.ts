import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext, Skill } from "@earendil-works/pi-coding-agent";
import { rankSkills, transcriptText, type RankedSkill } from "./picker.ts";
import { ADDITION_ENTRY, TURN_ENTRY, groupHistoryByTurn, restoreHistory, type SkillAddition } from "./history.ts";
import { showTurnSkills } from "./history-ui.ts";
import { parseMaxNew, parseThreshold, readSettings, writeSettings } from "./settings.ts";
import { withPickerStatus } from "./status.ts";

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
  let additions: SkillAddition[] = [];
  let knownAdded = new Set<string>();
  let turnNumber = 0;
  let requestNumber = 0;

  const restore = (ctx: ExtensionContext) => {
    const restored = restoreHistory(ctx.sessionManager.getBranch());
    additions = restored.additions;
    knownAdded = restored.selectedNames;
    turnNumber = restored.turn;
    requestNumber = 0;
    selected.clear();
    inventory = [];
    lastPrompt = "";
    lastContext = "";
    skipFirstRequest = false;
  };

  const recordAddition = (ranked: RankedSkill[], step: number) => {
    if (!ranked.length) return;
    const entry: SkillAddition = { turn: turnNumber, step, threshold: settings.threshold,
      skills: ranked.map(({ skill, probability }) => ({ name: skill.name, score: probability })) };
    pi.appendEntry(ADDITION_ENTRY, entry);
    additions.push(entry);
    for (const skill of entry.skills) knownAdded.add(skill.name);
  };

  const showSettings = async (ctx: ExtensionCommandContext) => {
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
  };

  const showHistory = async (ctx: ExtensionCommandContext) => {
    const turns = groupHistoryByTurn(additions);
    if (!turns.length) {
      await ctx.ui.select("Skill picker · additions this session", ["No skills added this session.", "Close"]);
      return;
    }
    const options = turns.map(({ turn, skills }) => `Turn ${turn} · ${skills.length} skill${skills.length === 1 ? "" : "s"} added (expand)`);
    for (;;) {
      const choice = await ctx.ui.select("Skill picker · turns with additions", [...options, "Close"]);
      const index = options.indexOf(choice ?? "");
      if (index < 0) break;
      // Descriptions come from Pi's *current* registered skill commands, not
      // our session entries, and are looked up only when the dialog is opened.
      const descriptions = new Map(pi.getCommands().filter((command) => command.source === "skill" && command.name.startsWith("skill:"))
        .map((command) => [command.name.slice(6), command.description ?? ""]));
      await showTurnSkills(ctx, turns[index], descriptions);
    }
  };

  pi.registerCommand("skill-picker", {
    description: "Skill picker settings and session history (/skill-picker settings|history)",
    getArgumentCompletions: (prefix) => {
      const matches = ["settings", "history"].filter((name) => name.startsWith(prefix));
      return matches.length ? matches.map((value) => ({ value, label: value })) : null;
    },
    handler: async (args, ctx) => {
      if (!ctx.hasUI) return;
      let action = args.trim().toLowerCase();
      if (!action) action = (await ctx.ui.select("Skill picker", ["settings", "history"])) ?? "";
      if (action === "settings") await showSettings(ctx);
      else if (action === "history") await showHistory(ctx);
      else if (action) ctx.ui.notify("Use /skill-picker settings or /skill-picker history.", "warning");
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    settings = readSettings();
    restore(ctx);
  });
  pi.on("session_tree", async (_event, ctx) => restore(ctx));

  pi.on("before_agent_start", async (event, ctx) => {
    lastPrompt = event.prompt;
    turnNumber++;
    requestNumber = 1;
    pi.appendEntry(TURN_ENTRY, { turn: turnNumber });
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
    for (const skill of inventory) {
      if (knownAdded.has(skill.name) && !selected.has(skill.name)) selected.set(skill.name, skill);
    }
    // Always remove Pi's original full skills list, including on API failure.
    event.systemPromptOptions.skills = [...selected.values()];
    const pending = inventory.filter((skill) => !selected.has(skill.name));
    if (pending.length) {
      try {
        const newlySelected = await withPickerStatus(ctx, async () => rankSkills(lastPrompt, pending, [...selected.values()], {
          apiKey: await ctx.modelRegistry.getApiKeyForProvider("openrouter") ?? "",
          model: process.env.PI_SKILL_PICKER_MODEL,
          threshold: settings.threshold,
          maxNew: settings.maxNew,
        }));
        for (const { skill } of newlySelected) selected.set(skill.name, skill);
        recordAddition(newlySelected, 1);
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
    requestNumber++;
    const context = transcriptText(event.messages, lastPrompt);
    const pending = inventory.filter((skill) => !selected.has(skill.name));
    if (context && context !== lastContext && pending.length) {
      lastContext = context;
      try {
        const newlySelected = await withPickerStatus(ctx, async () => rankSkills(context, pending, [...selected.values()], {
          apiKey: await ctx.modelRegistry.getApiKeyForProvider("openrouter") ?? "",
          model: process.env.PI_SKILL_PICKER_MODEL,
          threshold: settings.threshold,
          maxNew: settings.maxNew,
        }));
        for (const { skill } of newlySelected) selected.set(skill.name, skill);
        recordAddition(newlySelected, requestNumber);
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
