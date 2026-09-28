import { SelectList, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { formatHistorySkill, type TurnHistory } from "./history.ts";

/** Descriptions are resolved from Pi's live skills, never written to session entries. */
export async function showTurnSkills(
  ctx: ExtensionCommandContext, turn: TurnHistory, descriptions: Map<string, string>,
): Promise<void> {
  if (ctx.mode !== "tui") {
    await ctx.ui.select(`Turn ${turn.turn} · skills`, [...turn.skills.map((skill) => formatHistorySkill(turn.turn, skill)), "Back"]);
    return;
  }
  await ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
    const items = turn.skills.map((skill, i) => ({ value: String(i), label: formatHistorySkill(turn.turn, skill) }));
    const list = new SelectList(items, Math.min(items.length, 12), {
      selectedPrefix: (text) => theme.fg("accent", text),
      selectedText: (text) => theme.fg("accent", text),
      description: (text) => theme.fg("muted", text),
      scrollInfo: (text) => theme.fg("dim", text),
      noMatch: (text) => theme.fg("warning", text),
    });
    let expanded: number | undefined;
    list.onSelect = (item) => {
      const index = Number(item.value);
      expanded = expanded === index ? undefined : index;
      tui.requestRender();
    };
    list.onSelectionChange = () => { expanded = undefined; };
    list.onCancel = () => done();

    return {
      render(width: number) {
        const lines = [truncateToWidth(theme.fg("accent", `Turn ${turn.turn} · ${turn.skills.length} skills added`), width), "", ...list.render(width)];
        if (expanded !== undefined) {
          const name = turn.skills[expanded].name;
          // Skill metadata is provided by Pi's current resource loader via getCommands().
          const description = (descriptions.get(name)?.trim() || "Description unavailable (skill is no longer loaded by Pi).")
            .replace(/[\u0000-\u001f\u007f\u001b]/g, " ").trim();
          lines.push("", truncateToWidth(theme.fg("accent", `Description · ${name}`), width));
          lines.push(...wrapTextWithAnsi(description, Math.max(1, width - 2)).map((line) => `  ${theme.fg("text", line)}`));
        }
        lines.push("", theme.fg("dim", "↑↓ navigate · enter expand/collapse · esc back"));
        return lines;
      },
      invalidate() { list.invalidate(); },
      handleInput(data: string) { list.handleInput(data); tui.requestRender(); },
      handleMouse(event) {
        if (event.y < 2) return;
        const result = list.handleMouse({ ...event, y: event.y - 2 });
        tui.requestRender();
        return result;
      },
    };
  });
}
