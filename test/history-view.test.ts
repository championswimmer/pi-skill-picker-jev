import assert from "node:assert/strict";
import { test } from "node:test";
import skillPicker from "../src/extension.ts";
import { ADDITION_ENTRY, TURN_ENTRY, buildHistoryView, type SkillAddition } from "../src/history.ts";

test("history previews six scored skills per turn and offers an expandable remainder", async () => {
  const additions: SkillAddition[] = [
    { turn: 1, step: 1, threshold: 0.75, skills: Array.from({ length: 5 }, (_, i) => ({ name: `skill-${i + 1}`, score: 0.9 - i * 0.01 })) },
    { turn: 1, step: 2, threshold: 0.75, skills: Array.from({ length: 4 }, (_, i) => ({ name: `later-${i + 1}`, score: 0.85 - i * 0.01 })) },
    { turn: 2, step: 1, threshold: 0.8, skills: [{ name: "next", score: 0.94 }] },
  ];
  const view = buildHistoryView(additions);
  const expand = view.rows.find((row) => row.includes("(expand)"));
  assert.equal(view.rows.filter((row) => row.startsWith("Turn 1 ·") && !row.includes("(expand)")).length, 6);
  assert.equal(expand, "Turn 1 · … 3 more skills (expand)");
  assert.equal(view.expansions.get(expand!)?.rows.length, 9);
  assert.match(view.rows[0], /score 0\.900 ≥ 0\.750/);
  assert.match(view.rows.at(-1)!, /Turn 2 · initial · next \(score 0\.940 ≥ 0\.800\)/);

  const branch = [{ type: "custom", customType: TURN_ENTRY, data: { turn: 1 } },
    ...additions.map((data) => ({ type: "custom", customType: ADDITION_ENTRY, data })),
    { type: "custom", customType: TURN_ENTRY, data: { turn: 2 } }];
  const handlers = new Map<string, Function>();
  const commands = new Map<string, { handler: Function }>();
  skillPicker({ on: (name: string, handler: Function) => handlers.set(name, handler),
    registerCommand: (name: string, command: { handler: Function }) => commands.set(name, command) } as any);
  const dialogs: Array<{ title: string; rows: string[] }> = [];
  const selections = [expand!, "Back", "Close"];
  const ctx = { hasUI: true, sessionManager: { getBranch: () => branch }, ui: {
    select: async (title: string, rows: string[]) => {
      dialogs.push({ title, rows });
      const choice = selections.shift();
      assert.ok(choice && rows.includes(choice));
      return choice;
    },
  } };
  await handlers.get("session_start")!({}, ctx);
  await commands.get("skill-picker")!.handler("history", ctx);
  assert.equal(dialogs.length, 3);
  assert.equal(dialogs[0].rows.filter((r) => r.startsWith("Turn 1 ·") && !r.includes("(expand)")).length, 6);
  assert.equal(dialogs[1].title, "Turn 1 · all 9 added skills");
  assert.equal(dialogs[1].rows.length, 10); // nine scored skills + Back
  assert.deepEqual(dialogs[0].rows, dialogs[2].rows); // returns to summary
});
