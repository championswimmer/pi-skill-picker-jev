import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Skill } from "@earendil-works/pi-coding-agent";
import skillPicker from "../src/extension.ts";
import { ADDITION_ENTRY, TURN_ENTRY, buildHistoryView, restoreHistory } from "../src/history.ts";

function skill(name: string): Skill {
  return { name, description: `${name} expertise`, filePath: `/skills/${name}/SKILL.md`, baseDir: `/skills/${name}`,
    disableModelInvocation: false, sourceInfo: { path: `/skills/${name}/SKILL.md`, source: "test", scope: "project", origin: "top-level", baseDir: `/skills/${name}` } };
}

test("session branch history restores only valid turn and addition records", () => {
  const entries = [
    { type: "custom", customType: TURN_ENTRY, data: { turn: 1 } },
    { type: "custom", customType: ADDITION_ENTRY, data: { turn: 1, step: 1, skills: ["review"] } },
    { type: "custom", customType: ADDITION_ENTRY, data: { turn: -4, step: 0, skills: ["invalid"] } },
    { type: "message", customType: ADDITION_ENTRY, data: { turn: 8, step: 1, skills: ["not-branch-data"] } },
  ];
  const result = restoreHistory(entries);
  assert.equal(result.turn, 1);
  assert.deepEqual(result.additions, [{ turn: 1, step: 1, threshold: null, skills: [{ name: "review", score: null }] }]);
  assert.deepEqual([...result.selectedNames], ["review"]);
  assert.deepEqual(buildHistoryView(result.additions).rows, ["Turn 1 · initial · review (score unavailable)"]);
});

test("/skill-picker history shows per-turn additions and restores the active branch", async () => {
  const oldFetch = globalThis.fetch;
  const oldAgentDir = process.env.PI_CODING_AGENT_DIR;
  const agentDir = mkdtempSync(join(tmpdir(), "skill-picker-history-"));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  try {
    let branch: Array<{ type: string; customType: string; data: unknown }> = [];
    const handlers = new Map<string, Function>();
    const commands = new Map<string, { handler: Function; getArgumentCompletions: Function }>();
    skillPicker({ on: (name: string, handler: Function) => handlers.set(name, handler),
      registerCommand: (name: string, command: { handler: Function; getArgumentCompletions: Function }) => commands.set(name, command),
      appendEntry: (customType: string, data: unknown) => branch.push({ type: "custom", customType, data }) } as any);
    assert.deepEqual(commands.get("skill-picker")!.getArgumentCompletions("h"), [{ value: "history", label: "history" }]);
    const dialogs: { title: string; rows: string[] }[] = [];
    const ctx = { hasUI: true, sessionManager: { getBranch: () => branch }, ui: {
      select: async (title: string, rows: string[]) => { dialogs.push({ title, rows }); return "Close"; },
      notify: () => {}, setStatus: () => {},
    }, modelRegistry: { getApiKeyForProvider: async () => "pi-key" } };
    await handlers.get("session_start")!({}, ctx);
    await commands.get("skill-picker")!.handler("history", ctx);
    assert.deepEqual(dialogs.at(-1)?.rows, ["No skills added this session.", "Close"]);
    globalThis.fetch = (async (_url: unknown, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      const answers = Object.fromEntries(Object.entries(body.questions).map(([id, q]: [string, any]) => {
        const name = q.instructions.match(/Name: (\w+)/)?.[1];
        return [id, { noul: body.state.task.toLowerCase().includes(name) ? 0.99 : 0.01 }];
      }));
      return new Response(JSON.stringify({ answers }), { status: 200 });
    }) as typeof fetch;
    const skills = [skill("review"), skill("deploy"), skill("test")];
    await handlers.get("before_agent_start")!({ prompt: "Review this PR", systemPromptOptions: { skills: [...skills] } }, ctx);
    const messages = [{ role: "system", content: "Pi" }, { role: "user", content: "Review this PR" }];
    await handlers.get("context_with_system")!({ messages }, ctx); // first request already ranked
    await handlers.get("context_with_system")!({ messages: [...messages, { role: "toolResult", content: [{ type: "text", text: "Now deploy" }] }] }, ctx);
    await handlers.get("before_agent_start")!({ prompt: "Run test suite", systemPromptOptions: { skills: [...skills] } }, ctx);
    await commands.get("skill-picker")!.handler("history", ctx);
    assert.deepEqual(dialogs.at(-1)?.rows, [
      "Turn 1 · initial · review (score 0.990 ≥ 0.750)",
      "Turn 1 · follow-up #2 · deploy (score 0.990 ≥ 0.750)",
      "Turn 2 · initial · test (score 0.990 ≥ 0.750)",
      "Close",
    ]);
    assert.equal(branch.filter((entry) => entry.customType === TURN_ENTRY).length, 2);
    assert.equal(branch.filter((entry) => entry.customType === ADDITION_ENTRY).length, 3);
    // A session reload must replay the same history; a fork must NOT display
    // additions from turns or branches outside its active ancestry.
    await handlers.get("session_start")!({ reason: "reload" }, ctx);
    await commands.get("skill-picker")!.handler("history", ctx);
    assert.equal(dialogs.at(-1)?.rows.length, 4);
    branch = branch.slice(0, 2);
    await handlers.get("session_tree")!({ newLeafId: "fork", oldLeafId: "main" }, ctx);
    await commands.get("skill-picker")!.handler("history", ctx);
    assert.deepEqual(dialogs.at(-1)?.rows, ["Turn 1 · initial · review (score 0.990 ≥ 0.750)", "Close"]);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = oldAgentDir;
    rmSync(agentDir, { recursive: true, force: true });
  }
});
