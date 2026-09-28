import assert from "node:assert/strict";
import { test } from "node:test";
import skillPicker from "../src/extension.ts";
import { ADDITION_ENTRY, TURN_ENTRY, groupHistoryByTurn, type SkillAddition } from "../src/history.ts";

test("history has two levels: turns then scored skills with live expandable descriptions", async () => {
  const additions: SkillAddition[] = [
    { turn: 1, step: 1, threshold: 0.75, skills: Array.from({ length: 5 }, (_, i) => ({ name: `skill-${i + 1}`, score: 0.9 - i * 0.01 })) },
    { turn: 1, step: 2, threshold: 0.75, skills: Array.from({ length: 4 }, (_, i) => ({ name: `later-${i + 1}`, score: 0.85 - i * 0.01 })) },
    { turn: 2, step: 1, threshold: 0.8, skills: [{ name: "next", score: 0.94 }] },
  ];
  const turns = groupHistoryByTurn(additions);
  assert.equal(turns.length, 2);
  assert.equal(turns[0].skills.length, 9); // no six-skill truncation on the second level
  assert.deepEqual(turns[0].skills[5], { name: "later-1", score: 0.85, threshold: 0.75, step: 2 });

  const branch = [{ type: "custom", customType: TURN_ENTRY, data: { turn: 1 } },
    ...additions.map((data) => ({ type: "custom", customType: ADDITION_ENTRY, data })),
    { type: "custom", customType: TURN_ENTRY, data: { turn: 2 } }];
  const handlers = new Map<string, Function>();
  const commands = new Map<string, { handler: Function }>();
  const description = "Reviews changes and explains the reasoning behind a pull request. ".repeat(3);
  skillPicker({ on: (name: string, handler: Function) => handlers.set(name, handler),
    registerCommand: (name: string, command: { handler: Function }) => commands.set(name, command),
    getCommands: () => [{ name: "skill:skill-1", source: "skill", description }],
  } as any);
  const turnDialogs: string[][] = [];
  const selectedTurns = ["Turn 1 · 9 skills added (expand)", "Close"];
  const renders: string[] = [];
  const ctx = { hasUI: true, mode: "tui", sessionManager: { getBranch: () => branch }, ui: {
    select: async (_title: string, rows: string[]) => {
      turnDialogs.push(rows);
      const choice = selectedTurns.shift();
      assert.ok(choice && rows.includes(choice));
      return choice;
    },
    custom: async (factory: Function) => {
      let completed = false;
      const component = factory({ requestRender: () => {} }, { fg: (_color: string, text: string) => text }, {}, () => { completed = true; });
      const render = () => component.render(72).join("\n");
      renders.push(render());
      component.handleInput("\r"); // expand the highlighted skill inline
      renders.push(render());
      component.handleInput("\r"); // collapse it again
      renders.push(render());
      component.handleInput("\x1b"); // back to the turn list
      assert.ok(completed);
    },
  } };
  await handlers.get("session_start")!({}, ctx);
  await commands.get("skill-picker")!.handler("history", ctx);
  assert.deepEqual(turnDialogs[0], ["Turn 1 · 9 skills added (expand)", "Turn 2 · 1 skill added (expand)", "Close"]);
  assert.match(renders[0], /skill-1 \(score 0\.900 ≥ 0\.750\)/);
  assert.doesNotMatch(renders[0], /Reviews changes/);
  assert.match(renders[1], /Description · skill-1/);
  assert.match(renders[1], /Reviews changes/);
  assert.doesNotMatch(renders[2], /Reviews changes/);
  assert.doesNotMatch(JSON.stringify(branch), /Reviews changes/); // never serialized to session history
});
