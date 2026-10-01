import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Skill } from "@earendil-works/pi-coding-agent";
import skillPicker from "../src/extension.ts";
import { allowlistPath, readAllowlist, writeAllowlist } from "../src/always-allowed.ts";
import { showAlwaysAllowed } from "../src/always-allowed-ui.ts";
import { rankSkills } from "../src/picker.ts";
import { DEFAULT_SETTINGS, writeSettings } from "../src/settings.ts";

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
  const oldAgentDir = process.env.PI_CODING_AGENT_DIR;
  try {
    process.env.PI_CODING_AGENT_DIR = dir;
    writeSettings({ ...DEFAULT_SETTINGS, minSkills: 0 });
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
  } finally {
    if (oldAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = oldAgentDir;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("allowlist rows show cached skill file character counts with k notation", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jev-allowed-sizes-"));
  try {
    const entries = [
      ["small", "a".repeat(999)], ["thousand", "b".repeat(1000)],
      ["large", "c".repeat(1550)], ["unicode", "😺😺😺"],
    ] as const;
    const skills = entries.map(([name, content]) => {
      const filePath = join(dir, `${name}.md`);
      writeFileSync(filePath, content);
      return { ...skill(name), filePath };
    });
    skills.push(skill("missing"));
    let component!: { handleInput(data: string): void; render(width: number): string[] };
    const ctx = { cwd: dir, ui: { custom: (factory: Function) => new Promise<boolean>((resolve) => {
      component = factory({ requestRender: () => {} }, { fg: (_color: string, text: string) => text, bg: (_color: string, text: string) => text }, {}, resolve);
    }) } };
    const pending = showAlwaysAllowed(ctx as any, skills);
    const render = () => component.render(100).join("\n");
    assert.match(render(), /small · 999 chars/);
    assert.match(render(), /thousand · 1k chars/);
    assert.match(render(), /large · 1\.6k chars/);
    assert.match(render(), /unicode · 3 chars/);
    assert.match(render(), /missing · \? chars/);
    writeFileSync(join(dir, "small.md"), "changed");
    component.handleInput("\t"); // Cached size is also shown in relevance mode
    assert.match(render(), /small · 999 chars/);
    component.handleInput("\x1b");
    await pending;
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("relevance scores are cached across tab switches and Ctrl+R refreshes them", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jev-allowed-ui-"));
  const oldFetch = globalThis.fetch;
  try {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response(JSON.stringify({ answers: { s0: { type: "score", score: 3.6 }, s1: { type: "score", score: 0.4 } } }), { status: 200 });
    }) as typeof fetch;
    let component: { handleInput(data: string): void; render(width: number): string[] };
    let finish!: (saved: boolean) => void;
    const ctx = { cwd: dir, hasUI: false, modelRegistry: { getApiKeyForProvider: async () => "test" }, sessionManager: {},
      ui: { notify: () => {}, custom: (factory: Function) => new Promise<boolean>((resolve) => {
        finish = resolve;
        component = factory({ requestRender: () => {} }, { fg: (_color: string, text: string) => text, bg: (_color: string, text: string) => `\x1b[44m${text}\x1b[49m` }, {}, resolve);
      }) },
    };
    const pending = showAlwaysAllowed(ctx as any, [skill("one"), skill("two")]);
    component!.handleInput("\x1b[C"); // Right arrow selects Relevance without starting a request
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls, 0);
    assert.match(component!.render(100).join("\n"), /\x1b\[44m Relevance \x1b\[49m/);
    assert.match(component!.render(100).join("\n"), /Press Ctrl\+R to rank/);
    component!.handleInput("\x12"); // Ctrl+R performs the initial ranking
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls, 1);
    component!.handleInput("\x1b[D"); // Left arrow selects A-Z
    assert.match(component!.render(100).join("\n"), /\x1b\[44m A-Z \x1b\[49m/);
    component!.handleInput("\t");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls, 1);
    component!.handleInput("\x12"); // Ctrl+R refreshes cached ranking
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls, 2);
    finish(false);
    await pending;
  } finally { globalThis.fetch = oldFetch; rmSync(dir, { recursive: true, force: true }); }
});

test("allow dialog has a title and filters immediately while typing and backspacing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jev-allowed-search-"));
  try {
    let component!: { handleInput(data: string): void; render(width: number): string[] };
    const ctx = { cwd: dir, ui: { notify: () => {}, custom: (factory: Function) => new Promise<boolean>((resolve) => {
      component = factory({ requestRender: () => {} }, { fg: (_color: string, text: string) => text, bg: (_color: string, text: string) => `\x1b[44m${text}\x1b[49m` }, {}, resolve);
    }) } };
    const pending = showAlwaysAllowed(ctx as any, [skill("alpha"), skill("beta")]);
    const render = () => component.render(80).join("\n");
    assert.match(render(), /^┌─ Always allowed skills /);
    assert.match(render(), /2 results/);
    const lines = component.render(80);
    assert.match(lines[2], /A-Z.*Relevance/);
    assert.match(lines.at(-3)!, /Type to search · Ctrl\+K clear · ↓ enter list/);
    assert.match(lines.at(-2)!, /Esc search \(twice close\)/);
    component.handleInput("b");
    assert.match(render(), /1 results/);
    assert.match(render(), /\[ \] beta/);
    assert.doesNotMatch(render(), /\[ \] alpha/);
    component.handleInput(" "); // Space in search is text, not a toggle
    assert.match(render(), /Search: b /);
    assert.deepEqual([...readAllowlist(dir)], []);
    component.handleInput("\x1b[B"); // Down enters the list at its first result
    assert.match(render(), /❯ \[ \] beta/);
    component.handleInput("\r"); // Enter expands the description beneath the skill
    assert.match(render(), /\[ \] beta[^\n]*\n│   • beta description/);
    component.handleInput("\r"); // Enter collapses it
    assert.doesNotMatch(render(), /• beta description/);
    component.handleInput(" "); // Space toggles only while in the list
    assert.match(render(), /\[x\] beta/);
    component.handleInput("\x0b"); // Ctrl+K in the list does not erase the query
    assert.match(render(), /Search: b /);
    component.handleInput("\x1b"); // Esc returns to search instead of cancelling
    assert.doesNotMatch(render(), /❯ \[x\] beta/);
    component.handleInput("\x0b"); // Ctrl+K clears the entire query
    assert.match(render(), /Search: /);
    assert.doesNotMatch(render(), /Search: b /);
    assert.match(render(), /2 results/);
    component.handleInput("\x13"); // Ctrl+S saves without closing
    assert.deepEqual([...readAllowlist(dir)], ["beta"]);
    component.handleInput("\x1b"); // Esc closes from search
    await pending;
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("Ctrl+S saves in place and the yellow dot tracks unsaved allowlist changes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jev-allowed-save-"));
  try {
    let component!: { handleInput(data: string): void; render(width: number): string[] };
    let closed = false;
    const ctx = { cwd: dir, ui: { custom: (factory: Function) => new Promise<boolean>((resolve) => {
      component = factory({ requestRender: () => {} }, { fg: (color: string, text: string) => color === "warning" ? `<yellow>${text}</yellow>` : text,
        bg: (_color: string, text: string) => text }, {}, resolve);
    }) } };
    const pending = showAlwaysAllowed(ctx as any, [skill("alpha"), skill("beta")]).then(() => { closed = true; });
    const footer = () => component.render(100).at(-2)!;
    assert.doesNotMatch(footer(), /<yellow>● <\/yellow>Ctrl\+S save/);
    component.handleInput("\x1b[B"); // Enter the list and toggle alpha
    component.handleInput(" ");
    assert.match(footer(), /<yellow>● <\/yellow>Ctrl\+S save/);
    component.handleInput(" "); // Undo the change: no longer dirty
    assert.doesNotMatch(footer(), /<yellow>● <\/yellow>Ctrl\+S save/);
    component.handleInput(" ");
    component.handleInput("\x13"); // Save, but keep editing in the dialog
    assert.deepEqual([...readAllowlist(dir)], ["alpha"]);
    assert.equal(closed, false);
    assert.doesNotMatch(footer(), /<yellow>● <\/yellow>Ctrl\+S save/);
    component.handleInput("\x1b[B"); // Select beta and make a new unsaved change
    component.handleInput(" ");
    assert.match(footer(), /<yellow>● <\/yellow>Ctrl\+S save/);
    component.handleInput("\x1b"); // Esc to search, then Esc to close
    assert.equal(closed, false);
    component.handleInput("\x1b");
    await pending;
    assert.deepEqual([...readAllowlist(dir)], ["alpha"]); // Discard only post-save edits
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("search owns the cursor until Down enters the list; Esc returns before cancelling", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jev-allowed-focus-"));
  try {
    let component!: { handleInput(data: string): void; render(width: number): string[]; focused: boolean };
    const ctx = { cwd: dir, ui: { notify: () => {}, custom: (factory: Function) => new Promise<boolean>((resolve) => {
      component = factory({ requestRender: () => {} }, { fg: (_color: string, text: string) => text, bg: (_color: string, text: string) => text }, {}, resolve);
    }) } };
    const pending = showAlwaysAllowed(ctx as any, [skill("alpha"), skill("beta")]);
    component.focused = true;
    const render = () => component.render(80).join("\n");
    assert.doesNotMatch(render(), /❯ \[ \]/);
    component.handleInput(" ");
    assert.match(render(), /Search:  /);
    assert.deepEqual([...readAllowlist(dir)], []);
    component.handleInput("\x1b[B");
    assert.match(render(), /❯ \[ \] alpha/); // First Down selects first, not second
    component.handleInput("\x1b[B");
    assert.match(render(), /❯ \[ \] beta/);
    component.handleInput(" ");
    assert.match(render(), /❯ \[x\] beta/);
    component.handleInput("\x1b");
    assert.doesNotMatch(render(), /❯ \[x\]/);
    component.handleInput(" "); // Back in search, Space is text again
    assert.match(render(), /Search:   /);
    component.handleInput("\x1b"); // Esc from search cancels
    await pending;
    assert.deepEqual([...readAllowlist(dir)], []);
    // Dialog completion came from Esc, not an external test resolver.
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("inline skill descriptions wrap, and Ctrl+O no longer opens a detail dialog", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jev-allowed-detail-"));
  try {
    let component!: { handleInput(data: string): void; render(width: number): string[] };
    let finish!: (saved: boolean) => void;
    const ctx = { cwd: dir, ui: { notify: () => {}, custom: (factory: Function) => new Promise<boolean>((resolve) => {
      finish = resolve;
      component = factory({ requestRender: () => {} }, { fg: (_color: string, text: string) => text, bg: (_color: string, text: string) => text }, {}, resolve);
    }) } };
    const long = { ...skill("alpha"), description: "First line of a much longer description that should wrap neatly beneath the skill.\nSecond paragraph." };
    const pending = showAlwaysAllowed(ctx as any, [long]);
    component.handleInput("\x1b[B"); // Enter list before expanding a skill
    component.handleInput("\x0f"); // Ctrl+O is no longer a detail shortcut
    assert.match(component.render(40).join("\n"), /Always allowed skills/);
    component.handleInput("\r");
    const lines = component.render(40).join("\n");
    assert.match(lines, /• First line of a much longer/);
    assert.match(lines, /    description that should wrap/);
    assert.match(lines, /│     Second paragraph\./); // Newline stays in the inline description
    assert.doesNotMatch(lines, /Skill: alpha/);
    finish(false);
    await pending;
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("relevance search ranks all skills for the query only when refreshed, without fuzzy filtering", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jev-allowed-topics-"));
  const oldFetch = globalThis.fetch;
  try {
    const requests: any[] = [];
    globalThis.fetch = (async (_url, init) => {
      const body = JSON.parse(init!.body as string);
      requests.push(body);
      return new Response(JSON.stringify({ answers: {
        s0: { type: "score", score: body.state.task === "database migrations" ? 0.4 : 3.6 },
        s1: { type: "score", score: body.state.task === "database migrations" ? 3.6 : 0.4 },
      } }), { status: 200 });
    }) as typeof fetch;
    let component!: { handleInput(data: string): void; render(width: number): string[] };
    let finish!: (saved: boolean) => void;
    const ctx = { cwd: dir, hasUI: true, isIdle: () => { throw new Error("overlay must not use status widget"); },
      modelRegistry: { getApiKeyForProvider: async () => "test" }, sessionManager: {},
      ui: { notify: () => {}, setWorkingMessage: () => { throw new Error("overlay must not update Working row"); },
        custom: (factory: Function) => new Promise<boolean>((resolve) => {
          finish = resolve;
          component = factory({ requestRender: () => {} }, { fg: (_color: string, text: string) => text, bg: (_color: string, text: string) => text }, {}, resolve);
        }) },
    };
    const pending = showAlwaysAllowed(ctx as any, [skill("alpha"), skill("beta")]);
    component.handleInput("database "); // A-Z uses fuzzy search; switching tabs does not search Jev
    component.handleInput("\t");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(requests.length, 0);
    component.handleInput("migrations");
    assert.equal(requests.length, 0);
    let rendered = component.render(100).join("\n");
    assert.match(rendered, /Press Ctrl\+R to rank skills with the text in the search bar/);
    assert.match(rendered, /Search: database migrations/);
    assert.match(rendered, /\[ \] alpha[\s\S]*\[ \] beta/);
    component.handleInput("\x12");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(requests.length, 1);
    assert.equal(requests[0].state.task, "database migrations");
    assert.match(requests[0].questions.s0.instructions, /useful is this skill for work on the topics in the search query/);
    assert.equal(requests[0].questions.s0.type, "score");
    assert.match(requests[0].questions.s0.criteria[4], /required to work on the topics/);
    rendered = component.render(100).join("\n");
    assert.match(rendered, /\[ \] beta · \? chars · 0\.90[\s\S]*\[ \] alpha · \? chars · 0\.10/);
    component.handleInput("!");
    assert.equal(requests.length, 1); // Editing never triggers another Jev call
    assert.match(component.render(100).join("\n"), /\[ \] beta · \? chars · 0\.90[\s\S]*\[ \] alpha · \? chars · 0\.10/);
    component.handleInput("\x1b[D");
    assert.match(component.render(100).join("\n"), /0 results/); // A-Z is fuzzy search
    finish(false);
    await pending;
  } finally { globalThis.fetch = oldFetch; rmSync(dir, { recursive: true, force: true }); }
});

test("Jev failures appear inside the overlay and Ctrl+R can retry", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jev-allowed-retry-"));
  const oldFetch = globalThis.fetch;
  try {
    let requests = 0;
    globalThis.fetch = (async () => {
      requests++;
      return requests === 1 ? new Response("unavailable", { status: 503 })
        : new Response(JSON.stringify({ answers: { s0: { type: "score", score: 3.6 } } }), { status: 200 });
    }) as typeof fetch;
    let component!: { handleInput(data: string): void; render(width: number): string[] };
    const ctx = { cwd: dir, modelRegistry: { getApiKeyForProvider: async () => "test" }, sessionManager: {},
      ui: { notify: () => {}, custom: (factory: Function) => new Promise<boolean>((resolve) => {
        component = factory({ requestRender: () => {} }, { fg: (_color: string, text: string) => text, bg: (_color: string, text: string) => text }, {}, resolve);
      }) },
    };
    const pending = showAlwaysAllowed(ctx as any, [skill("alpha")]);
    component.handleInput("\t");
    component.handleInput("\x12");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(requests, 1);
    assert.match(component.render(100).join("\n"), /Relevance sort unavailable: Error: OpenRouter returned 503/);
    assert.doesNotMatch(component.render(100).join("\n"), /ranking…/);
    component.handleInput("\x12");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(requests, 2);
    assert.match(component.render(100).join("\n"), /\[ \] alpha · \? chars · 0\.90/);
    assert.doesNotMatch(component.render(100).join("\n"), /Relevance sort unavailable/);
    component.handleInput("\x1b");
    await pending;
  } finally { globalThis.fetch = oldFetch; rmSync(dir, { recursive: true, force: true }); }
});

test("global importance requests score all candidates independently of task relevance", async () => {
  const candidates = [skill("one"), skill("two")];
  const ranked = await rankSkills("Assess global importance", candidates, [], {
    apiKey: "test", threshold: 0, maxNew: candidates.length, globalImportance: true,
    fetcher: async (_url, init) => {
      const body = JSON.parse(init!.body as string);
      assert.match(body.questions.s0.instructions, /broadly useful/);
      assert.doesNotMatch(body.questions.s0.instructions, /current task/);
      return new Response(JSON.stringify({ answers: { s0: { type: "score", score: 0.8 }, s1: { type: "score", score: 3.6 } } }), { status: 200 });
    },
  });
  assert.deepEqual(ranked.map(({ skill, score }) => [skill.name, score]), [["two", 0.9], ["one", 0.2]]);
});
