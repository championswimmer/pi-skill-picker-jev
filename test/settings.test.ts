import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Skill } from "@earendil-works/pi-coding-agent";
import skillPicker from "../src/extension.ts";
import { DEFAULT_SETTINGS, parseMaxNew, parseThreshold, readSettings, writeSettings } from "../src/settings.ts";

function skill(name: string): Skill {
  return { name, description: `${name} expertise`, filePath: `/skills/${name}/SKILL.md`, baseDir: `/skills/${name}`,
    disableModelInvocation: false, sourceInfo: { path: `/skills/${name}/SKILL.md`, source: "test", scope: "project", origin: "top-level", baseDir: `/skills/${name}` } };
}

test("settings validate values and persist across loads", () => {
  const dir = mkdtempSync(join(tmpdir(), "jev-settings-"));
  const path = join(dir, "nested", "settings.json");
  try {
    assert.deepEqual(readSettings(path), DEFAULT_SETTINGS);
    assert.equal(parseThreshold("0"), 0);
    assert.equal(parseThreshold("1"), 1);
    assert.equal(parseThreshold("-0.1"), undefined);
    assert.equal(parseThreshold("NaN"), undefined);
    assert.equal(parseThreshold(""), undefined);
    assert.equal(parseMaxNew("0"), 0);
    assert.equal(parseMaxNew("100"), 100);
    assert.equal(parseMaxNew("1.5"), undefined);
    assert.equal(parseMaxNew("101"), undefined);
    writeSettings({ threshold: 0.91, maxNew: 2 }, path);
    assert.deepEqual(readSettings(path), { threshold: 0.91, maxNew: 2 });
    assert.throws(() => writeSettings({ threshold: 2, maxNew: 1 }, path), /Invalid/);
    assert.deepEqual(readSettings(path), { threshold: 0.91, maxNew: 2 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("TUI settings command saves values and ranking uses them without env vars", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jev-tui-"));
  const oldDir = process.env.PI_CODING_AGENT_DIR;
  const oldThreshold = process.env.PI_SKILL_PICKER_THRESHOLD;
  const oldMax = process.env.PI_SKILL_PICKER_MAX_NEW;
  const oldFetch = globalThis.fetch;
  try {
    process.env.PI_CODING_AGENT_DIR = dir;
    process.env.PI_SKILL_PICKER_THRESHOLD = "0"; // obsolete variables must have no effect
    process.env.PI_SKILL_PICKER_MAX_NEW = "100";
    const handlers = new Map<string, Function>();
    const commands = new Map<string, { handler: Function }>();
    const branch: Array<{ type: string; customType: string; data: unknown }> = [];
    skillPicker({ on: (name: string, handler: Function) => handlers.set(name, handler),
      registerCommand: (name: string, command: { handler: Function }) => commands.set(name, command),
      appendEntry: (customType: string, data: unknown) => branch.push({ type: "custom", customType, data }) } as any);
    const choices = ["Threshold: 0.75", "Max new skills: 6", "Done"];
    const inputs = ["bad", "0.9", "1"];
    const notifications: string[] = [];
    const ctx = { hasUI: true, sessionManager: { getBranch: () => branch }, ui: {
      select: async (_title: string, options: string[]) => { const choice = choices.shift(); assert.ok(!choice || options.includes(choice)); return choice; },
      input: async () => inputs.shift(), notify: (message: string) => notifications.push(message),
    }, modelRegistry: { getApiKeyForProvider: async () => "pi-key" } };
    await commands.get("skill-picker")!.handler("settings", ctx);
    assert.deepEqual(readSettings(join(dir, "pi-skill-picker-jev.json")), { threshold: 0.9, maxNew: 1 });
    assert.match(notifications.join(" "), /number between 0 and 1/);
    await handlers.get("session_start")!({}, ctx);
    globalThis.fetch = (async (_url: unknown, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      const answers = Object.fromEntries(Object.entries(body.questions).map(([id, q]: [string, any]) => [id, { noul: q.instructions.includes("review") ? 0.96 : 0.85 }]));
      return new Response(JSON.stringify({ answers }), { status: 200 });
    }) as typeof fetch;
    const event = { prompt: "Use relevant skills", systemPromptOptions: { skills: [skill("review"), skill("deploy")] } };
    await handlers.get("before_agent_start")!(event, ctx);
    assert.deepEqual(event.systemPromptOptions.skills.map((s) => s.name), ["review"]);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = oldDir;
    if (oldThreshold === undefined) delete process.env.PI_SKILL_PICKER_THRESHOLD; else process.env.PI_SKILL_PICKER_THRESHOLD = oldThreshold;
    if (oldMax === undefined) delete process.env.PI_SKILL_PICKER_MAX_NEW; else process.env.PI_SKILL_PICKER_MAX_NEW = oldMax;
    rmSync(dir, { recursive: true, force: true });
  }
});
