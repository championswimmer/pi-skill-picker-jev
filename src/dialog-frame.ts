import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

/** Frame a custom dialog at the exact width allocated by Pi's overlay renderer. */
export function dialogFrame(theme: Theme, title: string, width: number, body: string[]): string[] {
  const w = Math.max(4, width);
  const inner = w - 4;
  const label = truncateToWidth(` ${title} `, w - 3);
  const header = theme.fg("border", "┌─") + theme.fg("accent", label)
    + theme.fg("border", `${"─".repeat(w - 3 - visibleWidth(label))}┐`);
  return [header, ...body.map((text) => {
    const content = truncateToWidth(text, inner);
    return theme.fg("border", "│ ") + content + " ".repeat(inner - visibleWidth(content)) + theme.fg("border", " │");
  }), theme.fg("border", `└${"─".repeat(w - 2)}┘`)];
}
