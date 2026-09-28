import type { ExtensionCommandContext, Skill } from "@earendil-works/pi-coding-agent";
import { Input, fuzzyFilter, matchesKey, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { dialogFrame } from "./dialog-frame.ts";
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
  const saved = await ctx.ui.custom<boolean>((tui, theme, _keys, done) => {
    let mode: "alphabetical" | "relevance" = "alphabetical";
    let expandedName: string | undefined;
    let index = 0;
    let offset = 0;
    let loading = false;
    let rankError: string | undefined;
    let listFocused = false;
    let hasTuiFocus = false;
    const input = new Input({ prompt: "Search: ", placeholder: "skill name or description" });
    const focusSearch = () => { listFocused = false; input.focused = hasTuiFocus; };
    const ordered = () => {
      const sorted = [...available].sort((a, b) => mode === "relevance" && scores
        ? (scores.get(b.name) ?? -1) - (scores.get(a.name) ?? -1) || a.name.localeCompare(b.name)
        : a.name.localeCompare(b.name));
      if (mode === "relevance") return sorted;
      const matches = new Set(fuzzyFilter(sorted, input.getValue(), (skill) => `${skill.name} ${skill.description}`));
      return sorted.filter((skill) => matches.has(skill));
    };
    const redraw = () => tui.requestRender();
    const switchTab = () => {
      mode = mode === "relevance" ? "alphabetical" : "relevance";
      index = 0;
      offset = 0;
      focusSearch();
      redraw();
    };
    const rank = async () => {
      if (loading) return;
      loading = true;
      rankError = undefined;
      redraw();
      try {
        const query = input.getValue().trim();
        const ranked = await decideSkills(ctx, query || "Assess each skill's broad, project-independent importance across typical tasks.", available, [], {
          threshold: 0, maxNew: available.length, globalImportance: !query, topicSearch: !!query,
          requireKey: true, showStatus: false, signal: AbortSignal.timeout(30_000),
        });
        scores = new Map(ranked.map(({ skill, probability }) => [skill.name, probability]));
        index = 0;
      } catch (error) {
        rankError = `Relevance sort unavailable: ${String(error)}`;
      } finally { loading = false; redraw(); }
    };
    return {
      render(width: number): string[] {
        const w = Math.max(1, width - 4);
        const items = ordered();
        index = Math.min(index, Math.max(0, items.length - 1));
        if (index < offset) offset = index;
        if (index >= offset + 10) offset = index - 9;
        const tab = (label: string, selected: boolean) => selected
          ? theme.bg("selectedBg", theme.fg("text", ` ${label} `)) : ` ${label} `;
        const lines = [`Project: ${ctx.cwd}`,
          `${tab("A-Z", mode === "alphabetical")}  ${tab("Relevance", mode === "relevance")}${loading ? " (ranking…)" : ""}`,
          `${draft.size} selected · ${items.length} results`,
          ...(mode === "relevance" && rankError ? [rankError] : []),
          mode === "relevance" ? scores
            ? "Ctrl+R re-ranks skills with the text in the search bar (no fuzzy filter)"
            : "Press Ctrl+R to rank skills with the text in the search bar"
            : "A-Z: fuzzy search by name or description",
          ...input.render(w), ""];
        for (let i = offset; i < Math.min(items.length, offset + 10); i++) {
          const skill = items[i];
          lines.push(`${listFocused && i === index ? "❯" : " "} ${draft.has(skill.name) ? "[x]" : "[ ]"} ${skill.name}${mode === "relevance" && scores?.has(skill.name) ? ` · ${scores.get(skill.name)!.toFixed(2)}` : ""}`);
          if (expandedName === skill.name) {
            const description = wrapTextWithAnsi(skill.description, Math.max(1, w - 4));
            description.forEach((line, n) => lines.push(`${n === 0 ? "  • " : "    "}${line}`));
          }
        }
        if (!items.length) lines.push("No matching skills");
        lines.push(`${Math.min(index + 1, items.length)}/${items.length}`, "",
          "Type to search · Ctrl+K clear · ↓ enter list · Space toggle · Enter description",
          "Esc search (twice close) · Tab switch tabs · Ctrl+R rank · Ctrl+S save");
        return dialogFrame(theme, "Always allowed skills", width, lines);
      },
      get focused() { return hasTuiFocus; },
      set focused(value: boolean) { hasTuiFocus = value; input.focused = value && !listFocused; },
      invalidate() { input.invalidate(); },
      handleInput(data: string) {
        if (matchesKey(data, "ctrl+s")) {
          try { writeAllowlist(ctx.cwd, draft); done(true); }
          catch (error) { ctx.ui.notify(`Could not save always allowed skills: ${String(error)}`, "error"); }
          return;
        }
        if (matchesKey(data, "tab") || matchesKey(data, "left") || matchesKey(data, "right")) {
          switchTab();
          return;
        }
        if (matchesKey(data, "ctrl+r")) { if (mode === "relevance") void rank(); return; }
        if (!listFocused && matchesKey(data, "ctrl+k")) {
          input.setValue("");
          index = 0;
          offset = 0;
          redraw();
          return;
        }
        if (matchesKey(data, "escape")) {
          if (listFocused) { focusSearch(); redraw(); }
          else done(false);
          return;
        }
        const items = ordered();
        if (matchesKey(data, "down")) {
          if (!listFocused && items.length) { listFocused = true; input.focused = false; index = 0; }
          else if (listFocused) index = Math.min(items.length - 1, index + 1);
        } else if (listFocused && matchesKey(data, "up")) index = Math.max(0, index - 1);
        else if (listFocused && matchesKey(data, "space") && items[index]) {
          const name = items[index].name;
          if (draft.has(name)) draft.delete(name); else draft.add(name);
        } else if (listFocused && matchesKey(data, "return") && items[index]) {
          const name = items[index].name;
          expandedName = expandedName === name ? undefined : name;
        } else if (!listFocused) {
          const before = input.getValue();
          input.handleInput(data);
          if (input.getValue() !== before) { index = 0; offset = 0; }
        }
        redraw();
      },
    };
  }, { overlay: true, overlayOptions: { width: "80%", maxHeight: "80%" } });
  if (saved) ctx.ui.notify("Project always allowed skills saved.", "info");
}
