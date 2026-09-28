import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Skill } from "@earendil-works/pi-coding-agent";
import skillPicker from "../src/extension.ts";
import { allowlistPath, readAllowlist, writeAllowlist } from "../src/always-allowed.ts";
import { rankSkills } from "../src/picker.ts";
import { showAlwaysAllowed } from "../src/always-allowed-ui.ts";

const skill = (name: string, disabled = false): Skill => ({
  name, description: `${name} description`, filePath: `/skills/${name}/SKILL.md`, baseDir: `/skills/${name}`,
  disableModelInvocation: disabled, sourceInfo: { path: `/skills/${name}/SKILL.md`, source: "test", scope: "project", origin: "top-level", baseDir: `/skills/${name}` },
});

test("allowlist persists only names per project and ignores malformed files", () => {
  const dir = mkdtempSync(join(tmpdir(), "jev-allowed-"));
  try {
    assert.deepEqual([...readAllowlist(dir)], []);
    writeAllowlist(dir, ["z", "a", "z"]);
    assert.deepEqual(JSON.parse(readFileSync(allowlistPath(dir), "utf8")), { alwaysAllowed: ["a", "z"] });
    assert.deepEqual([...readAllowlist(dir)].sort(), ["a", "z"]);
    assert.deepEqual([...readAllowlist(join(dir, "other"))], []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("always allowed skills stay visible without credentials or Jev and do not expose other candidates", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jev-allowed-ext-"));
  try {
    writeAllowlist(dir, ["keep", "disabled", "stale"]);
    const handlers = new Map<string, Function>();
    skillPicker({ on: (name: string, handler: Function) => handlers.set(name, handler), registerCommand: () => {}, appendEntry: () => {} } as any);
    const ctx = { cwd: dir, hasUI: false, sessionManager: { getBranch: () => [] }, modelRegistry: { getApiKeyForProvider: async () => undefined } };
    await handlers.get("session_start")!({}, ctx);
    const options = { skills: [skill("keep"), skill("hidden"), skill("disabled", true)] };
    await handlers.get("before_agent_start")!({ prompt: "anything", systemPromptOptions: options }, ctx);
    assert.deepEqual(options.skills.map((s) => s.name), ["keep"]);
    await handlers.get("context_with_system")!({ messages: [{ role: "user", content: "anything" }] }, ctx);
    const rendered = await handlers.get("context_with_system")!({ messages: [{ role: "user", content: "anything" }] }, ctx);
    const section = rendered.messages.at(-1).sections.skills;
    assert.match(section, /<name>keep<\/name>/);
    assert.doesNotMatch(section, /<name>hidden<\/name>|<name>disabled<\/name>/);
    writeAllowlist(dir, []);
    await handlers.get("before_agent_start")!({ prompt: "anything", systemPromptOptions: options }, ctx);
    assert.deepEqual(options.skills, []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("relevance scores are cached across tab switches and Ctrl+R refreshes them", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jev-allowed-ui-"));
  const oldFetch = globalThis.fetch;
  try {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response(JSON.stringify({ answers: { s0: { noul: 0.9 }, s1: { noul: 0.1 } } }), { status: 200 });
    }) as typeof fetch;
    let component: { handleInput(data: string): void; render(width: number): string[] };
    let finish!: (saved: boolean) => void;
    const ctx = { cwd: dir, hasUI: false, modelRegistry: { getApiKeyForProvider: async () => "test" }, sessionManager: {},
      ui: { notify: () => {}, custom: (factory: Function) => new Promise<boolean>((resolve) => {
        finish = resolve;
        component = factory({ requestRender: () => {} }, { fg: (_color: string, text: string) => text }, {}, resolve);
      }) },
    };
    const pending = showAlwaysAllowed(ctx as any, [skill("one"), skill("two")]);
    component!.handleInput("\t");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls, 1);
    assert.match(component!.render(100).join("\n"), /Sort: relevance/);
    component!.handleInput("\t");
    component!.handleInput("\t");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls, 1);
    component!.handleInput("\x12"); // Ctrl+R
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls, 2);
    finish(false);
    await pending;
  } finally { globalThis.fetch = oldFetch; rmSync(dir, { recursive: true, force: true }); }
});

test("global importance requests score all candidates independently of task relevance", async () => {
  const candidates = [skill("one"), skill("two")];
  const ranked = await rankSkills("Assess global importance", candidates, [], {
    apiKey: "test", threshold: 0, maxNew: candidates.length, globalImportance: true,
    fetcher: async (_url, init) => {
      const body = JSON.parse(init!.body as string);
      assert.match(body.questions.s0.instructions, /broadly important/);
      assert.doesNotMatch(body.questions.s0.instructions, /current task/);
      return new Response(JSON.stringify({ answers: { s0: { noul: 0.2 }, s1: { noul: 0.9 } } }), { status: 200 });
    },
  });
  assert.deepEqual(ranked.map(({ skill, probability }) => [skill.name, probability]), [["two", 0.9], ["one", 0.2]]);
});
