import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { dialogFrame } from "../src/dialog-frame.ts";

test("dialog frames keep their title, sides and content within the available columns", () => {
  const theme = { fg: (_color: string, text: string) => text } as any;
  const lines = dialogFrame(theme, "Skill picker · always allowed", 22, ["a very long result name", "短い名前"]);
  assert.equal(lines.length, 4);
  assert.match(lines[0], /^┌─ Skill picker/);
  assert.match(lines[1], /^│ .* │$/);
  assert.match(lines[3], /^└─+┘$/);
  assert.ok(lines.every((line) => visibleWidth(line) === 22));
});
