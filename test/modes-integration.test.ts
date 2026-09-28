import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Skill } from "@earendil-works/pi-coding-agent";
import skillPicker from "../src/extension.ts";
import { writeSettings, type TriggerMode } from "../src/settings.ts";

function skill(name: string): Skill {
  return { name, description: `${name} expertise`, filePath: `/skills/${name}/SKILL.md`, baseDir: `/skills/${name}`,
    disableModelInvocation: false, sourceInfo: { path: `/skills/${name}/SKILL.md`, source: "test", scope: "project", origin: "top-level", baseDir: `/skills/${name}` } };
}

async function countDecisionCalls(triggerMode: TriggerMode): Promise<number> {
  const dir = mkdtempSync(join(tmpdir(), "jev-mode-"));
  const oldDir = process.env.PI_CODING_AGENT_DIR;
  const oldFetch = globalThis.fetch;
  try {
    process.env.PI_CODING_AGENT_DIR = dir;
    writeSettings({ threshold: 0.75, maxNew: 6, triggerMode });
    let calls = 0;
    globalThis.fetch = (async (_url: unknown, init: RequestInit) => {
      calls++;
      const body = JSON.parse(init.body as string);
      const answers = Object.fromEntries(Object.entries(body.questions).map(([id, q]: [string, any]) => {
        const name = q.instructions.match(/Name: (\w+)/)?.[1];
        return [id, { type: "score", score: body.state.task.toLowerCase().includes(name) ? 3.92 : 0.08 }];
      }));
      return new Response(JSON.stringify({ answers }), { status: 200 });
    }) as typeof fetch;
    const handlers = new Map<string, Function>();
    const branch: Array<{ type: string; customType: string; data: unknown }> = [];
    skillPicker({ on: (name: string, handler: Function) => handlers.set(name, handler),
      registerCommand: () => {}, appendEntry: (customType: string, data: unknown) => branch.push({ type: "custom", customType, data }) } as any);
    const ctx = { hasUI: false, sessionManager: { getBranch: () => branch }, modelRegistry: { getApiKeyForProvider: async () => "pi-key" } };
    await handlers.get("session_start")!({}, ctx);
    await handlers.get("before_agent_start")!({ prompt: "Review PR", systemPromptOptions: { skills: [skill("review"), skill("deploy"), skill("test")] } }, ctx);
    const first = [{ role: "system", content: "Pi" }, { role: "user", content: "Review PR" }];
    const second = [...first, { role: "assistant", content: [{ type: "text", text: "Now deploy" }] }];
    const third = [...second, { role: "toolResult", toolCallId: "call-test", content: [{ type: "text", text: "Now test" }] }];
    for (const messages of [first, second, third, third]) await handlers.get("context_with_system")!({ messages }, ctx);
    return calls;
  } finally {
    globalThis.fetch = oldFetch;
    if (oldDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = oldDir;
    rmSync(dir, { recursive: true, force: true });
  }
}

test("settings reduce Jev model calls: prompt-only 1, after tools 2, every changed request 3", async () => {
  assert.equal(await countDecisionCalls("prompt-only"), 1);
  assert.equal(await countDecisionCalls("prompt-and-tools"), 2);
  assert.equal(await countDecisionCalls("every-request"), 3);
});
