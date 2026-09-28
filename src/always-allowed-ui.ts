import type { ExtensionCommandContext, Skill } from "@earendil-works/pi-coding-agent";
import { Input, fuzzyFilter, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import { readAllowlist, writeAllowlist } from "./always-allowed.ts";
import { decideSkills } from "./decision.ts";

/** A project-scoped editor. Cancelling never writes the draft. */
export async function showAlwaysAllowed(ctx: ExtensionCommandContext, skills: Skill[]): Promise<void> {
  const names = new Set<string>();
  const available = skills.filter((skill) => {
    if (skill.disableModelInvocation || names.has(skill.name)) return false;
    names.add(skill.name);
    return true;
  });
  if (!available.length) {
    ctx.ui.notify("No model-invocable skills are available in this project.", "warning");
    return;
  }
  const draft = readAllowlist(ctx.cwd);
  let scores: Map<string, number> | undefined;
  let detailOpen = false;
  const saved = await ctx.ui.custom<boolean>((tui, theme, _keys, done) => {
    let mode: "alphabetical" | "relevance" = "alphabetical";
    let searching = false;
    let detail: Skill | undefined;
    let index = 0;
    let offset = 0;
    let loading = false;
    const input = new Input({ prompt: "Search: ", placeholder: "skill name or description" });
    const ordered = () => {
      const sorted = [...available].sort((a, b) => mode === "relevance" && scores
        ? (scores.get(b.name) ?? -1) - (scores.get(a.name) ?? -1) || a.name.localeCompare(b.name)
        : a.name.localeCompare(b.name));
      const matches = new Set(fuzzyFilter(sorted, input.getValue(), (skill) => `${skill.name} ${skill.description}`));
      return sorted.filter((skill) => matches.has(skill));
    };
    const redraw = () => tui.requestRender();
    const rank = async (refresh = false) => {
      if (loading || (scores && !refresh)) return;
      loading = true;
      redraw();
      try {
        const ranked = await decideSkills(ctx, "Assess each skill's broad, project-independent importance across typical tasks.", available, [], {
          threshold: 0, maxNew: available.length, globalImportance: true, requireKey: true,
        });
        scores = new Map(ranked.map(({ skill, probability }) => [skill.name, probability]));
        mode = "relevance";
        index = 0;
      } catch (error) {
        if (!scores) mode = "alphabetical";
        ctx.ui.notify(`Relevance sort unavailable: ${String(error)}`, "warning");
      } finally { loading = false; redraw(); }
    };
    return {
      render(width: number): string[] {
        const w = Math.max(1, width - 4);
        const line = (text: string) => `  ${truncateToWidth(text, w)}`;
        if (detail) return [line(theme.fg("accent", `Skill: ${detail.name}`)), "", ...detail.description.split(/\n/).flatMap((paragraph) => {
          const chunks = paragraph.match(/.{1,70}(?:\s|$)|.{1,70}/g) ?? [""];
          return chunks.map((chunk) => line(chunk.trim()));
        }).slice(0, 9), "", line("Esc / Ctrl+O · back")];
        const items = ordered();
        index = Math.min(index, Math.max(0, items.length - 1));
        if (index < offset) offset = index;
        if (index >= offset + 10) offset = index - 9;
        const lines = [line(theme.fg("accent", `Always allowed · ${ctx.cwd}`)),
          line(`Sort: ${mode}${loading ? " (ranking…)" : ""} · ${draft.size} selected · ${items.length} results`),
          line("Enter toggle · Ctrl+O description · Ctrl+F search"),
          line("Tab sort · Ctrl+R refresh ranking · Ctrl+S save · Esc cancel"), "", ...input.render(w).map(line), ""];
        for (let i = offset; i < Math.min(items.length, offset + 10); i++) {
          const skill = items[i];
          lines.push(line(`${i === index ? "❯" : " "} ${draft.has(skill.name) ? "[x]" : "[ ]"} ${skill.name}${mode === "relevance" && scores?.has(skill.name) ? ` · ${scores.get(skill.name)!.toFixed(2)}` : ""}`));
        }
        if (!items.length) lines.push(line("No matching skills"));
        lines.push(line(`${Math.min(index + 1, items.length)}/${items.length}`));
        return lines;
      },
      invalidate() { input.invalidate(); },
      handleInput(data: string) {
        if (detail) {
          if (matchesKey(data, "escape") || matchesKey(data, "ctrl+o") || matchesKey(data, "return")) { detail = undefined; detailOpen = false; }
          redraw(); return;
        }
        if (matchesKey(data, "ctrl+s")) {
          try { writeAllowlist(ctx.cwd, draft); done(true); }
          catch (error) { ctx.ui.notify(`Could not save always allowed skills: ${String(error)}`, "error"); }
          return;
        }
        if (matchesKey(data, "ctrl+f")) { searching = true; redraw(); return; }
        if (matchesKey(data, "tab")) {
          if (mode === "relevance") { mode = "alphabetical"; index = 0; redraw(); }
          else if (scores) { mode = "relevance"; index = 0; redraw(); }
          else void rank();
          return;
        }
        if (matchesKey(data, "ctrl+r")) { void rank(true); return; }
        if (matchesKey(data, "escape")) {
          if (searching) searching = false;
          else done(false);
          redraw(); return;
        }
        if (searching) {
          if (matchesKey(data, "return")) searching = false;
          else { input.handleInput(data); index = 0; offset = 0; }
          redraw(); return;
        }
        const items = ordered();
        if (matchesKey(data, "up")) index = Math.max(0, index - 1);
        else if (matchesKey(data, "down")) index = Math.max(0, Math.min(items.length - 1, index + 1));
        else if (matchesKey(data, "ctrl+o") && items[index]) { detail = items[index]; detailOpen = true; }
        else if (matchesKey(data, "return") && items[index]) {
          const name = items[index].name;
          if (draft.has(name)) draft.delete(name); else draft.add(name);
        }
        redraw();
      },
    };
  }, { overlay: true, overlayOptions: () => ({ width: detailOpen ? "60%" : "80%", maxHeight: detailOpen ? "45%" : "80%" }) });
  if (saved) ctx.ui.notify("Project always allowed skills saved.", "info");
}
