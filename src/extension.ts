import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext, Skill } from "@earendil-works/pi-coding-agent";
import { transcriptText, type RankedSkill } from "./picker.ts";
import { decideSkills } from "./decision.ts";
import { TriggerTracker } from "./triggers.ts";
import { ADDITION_ENTRY, TURN_ENTRY, groupHistoryByTurn, restoreHistory, type SkillAddition } from "./history.ts";
import { showTurnSkills } from "./history-ui.ts";
import {
  CLASSIFIER_MODE_LABELS,
  CLASSIFIER_MODES,
  TRIGGER_LABELS,
  TRIGGER_MODES,
  parseApiBaseUrl,
  parseMaxNew,
  parseMinSkills,
  parseThreshold,
  readSettings,
  writeSettings,
} from "./settings.ts";
import { isAlwaysAllowed, readAllowlist, readGlobalAllowlist } from "./always-allowed.ts";
import { showAlwaysAllowed } from "./always-allowed-ui.ts";

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
  let pickerActiveForTurn = false;
  let skipFirstRequest = false;
  let lastPrompt = "";
  const triggers = new TriggerTracker();
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
    pickerActiveForTurn = false;
    lastPrompt = "";
    triggers.reset();
    skipFirstRequest = false;
  };

  const syncAllowlist = (cwd: string) => {
    // Project skills follow the project allowlist; user-level skills follow the global one.
    const project = readAllowlist(cwd);
    const global = readGlobalAllowlist();
    for (const [name, skill] of selected) {
      if (!knownAdded.has(name) && !isAlwaysAllowed(skill, project, global)) selected.delete(name);
    }
    for (const skill of inventory) {
      if (isAlwaysAllowed(skill, project, global)) selected.set(skill.name, skill);
    }
  };

  const recordAddition = (ranked: RankedSkill[], step: number) => {
    if (!ranked.length) return;
    const entry: SkillAddition = { turn: turnNumber, step, threshold: settings.threshold, scoreType: "score",
      skills: ranked.map(({ skill, score }) => ({ name: skill.name, score })) };
    pi.appendEntry(ADDITION_ENTRY, entry);
    additions.push(entry);
    for (const skill of entry.skills) knownAdded.add(skill.name);
  };

  const showSettings = async (ctx: ExtensionCommandContext) => {
      for (;;) {
        const enabledOption = `Skill picker: ${settings.enabled ? "On" : "Off"}`;
        const thresholdOption = `Threshold: ${settings.threshold}`;
        const maxNewOption = `Max new skills: ${settings.maxNew}`;
        const minSkillsOption = `Minimum repo skills: ${settings.minSkills}`;
        const triggerOption = `When to pick: ${TRIGGER_LABELS[settings.triggerMode]}`;
        const modeOption = `Classifier mode: ${CLASSIFIER_MODE_LABELS[settings.mode]}`;
        const globalAllowedOption = `Always allowed global skills: ${readGlobalAllowlist().size}`;
        const allowedOption = `Always allowed project skills (this project): ${readAllowlist(ctx.cwd).size}`;
        const customHttpActive = settings.mode === "custom-http";
        const baseOption = `Custom HTTP base URL: ${settings.apiBaseUrl ?? "not set"}`;
        const tokenOption = `Custom HTTP token: ${settings.apiToken ? "configured (hidden)" : "not set"}`;
        const modelOption = `Decision model: ${settings.model ?? "default / PI_SKILL_PICKER_MODEL"}`;
        const choice = await ctx.ui.select("Skill picker settings", [
          enabledOption, thresholdOption, maxNewOption, minSkillsOption, triggerOption, modeOption, globalAllowedOption, allowedOption,
          ...(customHttpActive ? [baseOption, tokenOption] : []),
          modelOption, "Done",
        ]);
        if (!choice || choice === "Done") break;
        if (choice === enabledOption) {
          const updated = { ...settings, enabled: !settings.enabled };
          try {
            writeSettings(updated);
            settings = updated;
            ctx.ui.notify(`Skill picker ${settings.enabled ? "enabled" : "disabled"}.`, "info");
          } catch (error) { ctx.ui.notify(`Could not save skill picker settings: ${String(error)}`, "error"); }
          continue;
        }
        if (choice === modeOption) {
          const picked = await ctx.ui.select("Classifier mode", CLASSIFIER_MODES.map((mode) => CLASSIFIER_MODE_LABELS[mode]));
          const mode = CLASSIFIER_MODES.find((value) => CLASSIFIER_MODE_LABELS[value] === picked);
          if (mode) {
            try {
              const updated = { ...settings, mode };
              if (mode !== "custom-http") {
                delete updated.apiBaseUrl;
                delete updated.apiToken;
              }
              writeSettings(updated);
              settings = updated;
              ctx.ui.notify(mode === "custom-http"
                ? "Skill picker settings saved. Custom HTTP base URL and token are now in this menu."
                : "Skill picker settings saved. Cleared saved Custom HTTP endpoint settings.", "info");
            } catch (error) {
              ctx.ui.notify(`Could not save skill picker settings: ${String(error)}`, "error");
            }
          }
          continue;
        }
        if (choice === baseOption || choice === tokenOption || choice === modelOption) {
          const key = choice === baseOption ? "apiBaseUrl" : choice === tokenOption ? "apiToken" : "model";
          if (key === "apiToken") ctx.ui.notify("Token input is visible while typing; saved only in your agent settings (mode 0600).", "warning");
          const value = await ctx.ui.input(
            key === "apiBaseUrl" ? "Custom TypeSafe-compatible server root URL for Custom HTTP endpoint mode (blank = clear)" :
              key === "apiToken" ? "Custom HTTP token for Custom HTTP endpoint mode (blank = clear; never prefilled)" : "Decision model (blank = default)",
            key === "apiToken" ? undefined : settings[key],
          );
          if (value === undefined) continue;
          const trimmed = value.trim();
          if (key === "apiBaseUrl" && trimmed && !parseApiBaseUrl(trimmed)) {
            ctx.ui.notify("Enter an HTTP(S) base URL without credentials, query, or fragment.", "warning");
            continue;
          }
          const updated = { ...settings };
          if (trimmed) updated[key] = key === "apiBaseUrl" ? parseApiBaseUrl(trimmed)! : trimmed;
          else delete updated[key];
          // A token belongs to the endpoint it was configured for.
          if (key === "apiBaseUrl" && updated.apiBaseUrl !== settings.apiBaseUrl) delete updated.apiToken;
          try {
            writeSettings(updated);
            settings = updated;
            ctx.ui.notify(key === "apiBaseUrl"
              ? "Settings saved. Endpoint changes clear the token; configure it next if needed."
              : "Skill picker settings saved.", "info");
          } catch (error) {
            ctx.ui.notify(`Could not save skill picker settings: ${String(error)}`, "error");
          }
          continue;
        }
        if (choice === allowedOption || choice === globalAllowedOption) {
          // Before the first turn, Pi's registered skill commands provide the
          // same names/descriptions; never scan files or invent new candidates.
          const commands = pi.getCommands().filter((command) => command.source === "skill" && command.name.startsWith("skill:"));
          const skills = inventory.length ? inventory : commands.map((command) => ({
            name: command.name.slice(6), description: command.description ?? "", filePath: "", sourceInfo: command.sourceInfo,
            // UI/ranking only; never passed to Pi's skills prompt.
          } as Skill));
          await showAlwaysAllowed(ctx, skills, choice === globalAllowedOption ? "global" : "project");
          // The global allowlist shares the settings file; refresh so later writes keep it.
          settings = readSettings();
          syncAllowlist(ctx.cwd);
          continue;
        }
        if (choice === triggerOption) {
          const picked = await ctx.ui.select("When to pick skills", TRIGGER_MODES.map((mode) => TRIGGER_LABELS[mode]));
          const triggerMode = TRIGGER_MODES.find((mode) => TRIGGER_LABELS[mode] === picked);
          if (triggerMode) {
            try {
              const updated = { ...settings, triggerMode };
              writeSettings(updated);
              settings = updated;
              ctx.ui.notify("Skill picker settings saved.", "info");
            } catch (error) {
              ctx.ui.notify(`Could not save skill picker settings: ${String(error)}`, "error");
            }
          }
          continue;
        }
        const numericSetting = choice === thresholdOption ? {
          key: "threshold" as const,
          prompt: "Normalized usefulness rating cutoff (0–1; default 0.625)",
          value: settings.threshold,
          parse: parseThreshold,
          warning: "Enter a number between 0 and 1.",
        } : choice === maxNewOption ? {
          key: "maxNew" as const,
          prompt: "Maximum new skills (0–100)",
          value: settings.maxNew,
          parse: parseMaxNew,
          warning: "Enter a whole number from 0 to 100.",
        } : {
          key: "minSkills" as const,
          prompt: "Minimum repo skills before the picker runs (0 = disable this gate; counts dedupe names and exclude disableModelInvocation)",
          value: settings.minSkills,
          parse: parseMinSkills,
          warning: "Enter a whole number 0 or greater. Use 0 to disable the gate.",
        };
        for (;;) {
          const value = await ctx.ui.input(numericSetting.prompt, String(numericSetting.value));
          if (value === undefined) break;
          const parsed = numericSetting.parse(value);
          if (parsed === undefined) {
            ctx.ui.notify(numericSetting.warning, "warning");
            continue;
          }
          const updated = { ...settings, [numericSetting.key]: parsed };
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
      const matches = ["on", "off", "settings", "history"].filter((name) => name.startsWith(prefix));
      return matches.length ? matches.map((value) => ({ value, label: value })) : null;
    },
    handler: async (args, ctx) => {
      if (!ctx.hasUI) return;
      let action = args.trim().toLowerCase();
      if (!action) action = (await ctx.ui.select("Skill picker", ["settings", "history"])) ?? "";
      if (action === "settings") await showSettings(ctx);
      else if (action === "history") await showHistory(ctx);
      else if (action === "on" || action === "off") {
        const updated = { ...settings, enabled: action === "on" };
        try {
          writeSettings(updated);
          settings = updated;
          ctx.ui.notify(`Skill picker ${settings.enabled ? "enabled" : "disabled"}.`, "info");
        } catch (error) { ctx.ui.notify(`Could not save skill picker settings: ${String(error)}`, "error"); }
      }
      else if (action) ctx.ui.notify("Use /skill-picker on|off, settings, or history.", "warning");
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    settings = readSettings();
    restore(ctx);
  });
  pi.on("session_tree", async (_event, ctx) => restore(ctx));

  pi.on("before_agent_start", async (event, ctx) => {
    settings = readSettings();
    lastPrompt = event.prompt;
    if (!settings.enabled) {
      inventory = [];
      pickerActiveForTurn = false;
      selected.clear();
      skipFirstRequest = true;
      triggers.reset();
      return;
    }
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
    pickerActiveForTurn = settings.minSkills === 0 || inventory.length >= settings.minSkills;
    if (!pickerActiveForTurn) {
      skipFirstRequest = true;
      triggers.reset();
      return;
    }
    for (const [name, skill] of selected) {
      if (!inventory.some((available) => available.name === name && available.filePath === skill.filePath)) selected.delete(name);
    }
    for (const skill of inventory) {
      if (knownAdded.has(skill.name) && !selected.has(skill.name)) selected.set(skill.name, skill);
    }
    syncAllowlist(ctx.cwd);
    // Always remove Pi's original full skills list, including on API failure.
    event.systemPromptOptions.skills = [...selected.values()];
    const pending = inventory.filter((skill) => !selected.has(skill.name));
    if (pending.length) {
      try {
        const newlySelected = await decideSkills(ctx, lastPrompt, pending, [...selected.values()], { ...settings, signal: ctx.signal });
        for (const { skill } of newlySelected) selected.set(skill.name, skill);
        recordAddition(newlySelected, 1);
      } catch (error) {
        if (!ctx.signal?.aborted) console.error("[pi-skill-picker-jev] Initial ranking failed (skills hidden):", error);
      }
    }
    event.systemPromptOptions.skills = [...selected.values()];
    skipFirstRequest = true;
    triggers.reset();
  });

  pi.on("context_with_system", async (event, ctx) => {
    if (!settings.enabled || !pickerActiveForTurn) return;
    if (skipFirstRequest) {
      skipFirstRequest = false;
      triggers.snapshot(event.messages, lastPrompt);
      return;
    }
    requestNumber++;
    syncAllowlist(ctx.cwd);
    const shouldRank = triggers.shouldRank(settings.triggerMode, event.messages, lastPrompt);
    const pending = inventory.filter((skill) => !selected.has(skill.name));
    if (shouldRank && pending.length) {
      const context = transcriptText(event.messages, lastPrompt);
      try {
        const newlySelected = await decideSkills(ctx, context, pending, [...selected.values()], { ...settings, signal: ctx.signal });
        for (const { skill } of newlySelected) selected.set(skill.name, skill);
        recordAddition(newlySelected, requestNumber);
      } catch (error) {
        if (!ctx.signal?.aborted) console.error("[pi-skill-picker-jev] Incremental ranking failed (keeping previous skills):", error);
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
