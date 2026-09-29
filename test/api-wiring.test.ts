import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import skillPicker from "../src/extension.ts";
import { decideSkills } from "../src/decision.ts";
import { DEFAULT_SETTINGS, readSettings, writeSettings } from "../src/settings.ts";
import type { Skill } from "@earendil-works/pi-coding-agent";

const skill: Skill = { name: "review", description: "Review code", filePath: "/test/SKILL.md", baseDir: "/test", disableModelInvocation: false,
  sourceInfo: { path: "/test/SKILL.md", source: "test", scope: "project", origin: "top-level", baseDir: "/test" } };

async function isolated(fn: (dir: string) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), "picker-api-wiring-"));
  const before = process.env.PI_CODING_AGENT_DIR;
  const fetcher = globalThis.fetch;
  process.env.PI_CODING_AGENT_DIR = dir;
  try { await fn(dir); } finally {
    if (before === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = before;
    globalThis.fetch = fetcher;
    rmSync(dir, { recursive: true, force: true });
  }
}

test("decision auth precedence: token override, custom no-auth, then Pi OpenRouter auth", async () => isolated(async (dir) => {
  let authCalls = 0;
  let expectedUrl = "https://openrouter.ai/api/alpha/decisions";
  let expectedAuth: string | null = "Bearer override";
  let networkCalls = 0;
  const ctx = { cwd: dir, hasUI: false, ui: {}, modelRegistry: { getApiKeyForProvider: async (provider: string) => {
    assert.equal(provider, "openrouter"); authCalls++; return "pi-provider-key";
  } } };
  globalThis.fetch = (async (url, init) => {
    networkCalls++;
    assert.equal(url, expectedUrl);
    assert.equal(new Headers(init?.headers).get("Authorization"), expectedAuth);
    return new Response(JSON.stringify({ answers: {} }));
  }) as typeof fetch;
  const decide = () => decideSkills(ctx as any, "Review code", [skill], [], { showStatus: false, requireKey: true });
  writeSettings({ ...DEFAULT_SETTINGS, apiToken: "override" });
  await decide();
  assert.equal(authCalls, 0);
  expectedUrl = "http://127.0.0.1:8008/v1/systemone";
  expectedAuth = null;
  writeSettings({ ...DEFAULT_SETTINGS, apiBaseUrl: "http://127.0.0.1:8008" });
  await decide();
  assert.equal(authCalls, 0);
  expectedAuth = "Bearer local-token";
  writeSettings({ ...DEFAULT_SETTINGS, apiBaseUrl: "http://127.0.0.1:8008", apiToken: "local-token" });
  await decide();
  assert.equal(authCalls, 0);
  expectedUrl = "https://openrouter.ai/api/alpha/decisions";
  expectedAuth = "Bearer pi-provider-key";
  writeSettings(DEFAULT_SETTINGS);
  await decide();
  assert.equal(authCalls, 1);
  assert.equal(networkCalls, 4);
  writeFileSync(join(dir, "pi-skill-picker-jev.json"), JSON.stringify({ ...DEFAULT_SETTINGS, apiBaseUrl: "bad-url", apiToken: "private" }));
  await assert.rejects(decide(), /Invalid TypeSafe API base URL/);
  assert.equal(networkCalls, 4);
  assert.equal(authCalls, 1);
}));

test("decision forwards the agent cancellation signal to an in-flight Jev request", async () => isolated(async () => {
  const controller = new AbortController();
  globalThis.fetch = ((_url: unknown, init: RequestInit) => new Promise((_resolve, reject) => {
    init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
  })) as typeof fetch;
  const ctx = { hasUI: false, modelRegistry: { getApiKeyForProvider: async () => "key" } };
  const pending = decideSkills(ctx as any, "Review code", [skill], [], { showStatus: false, signal: controller.signal });
  controller.abort(new Error("user cancelled"));
  await assert.rejects(pending, /user cancelled/);
}));

test("API settings UI persists URL/model, never prefills tokens, and clears tokens on endpoint changes", async () => isolated(async (dir) => {
  let command: any;
  writeSettings({ ...DEFAULT_SETTINGS, apiToken: "old-private-token" });
  skillPicker({ on: () => {}, registerCommand: (_name: string, options: any) => { command = options; } } as any);
  const selections = ["TypeSafe API base URL:", "API token:", "Decision model:", "Done"];
  const values = ["http://127.0.0.1:8008/", "new-private-token", "kev-latest"];
  const inputs: { title: string; prefill: unknown }[] = [];
  const ctx = { cwd: dir, hasUI: true, ui: {
    select: async (_title: string, options: string[]) => {
      assert.ok(options.every((s) => !s.includes("private-token")));
      const prefix = selections.shift()!;
      if (prefix === "API token:") assert.equal(readSettings().apiToken, undefined);
      return options.find((s) => s.startsWith(prefix));
    },
    input: async (title: string, prefill: unknown) => { inputs.push({ title, prefill }); return values.shift(); },
    notify: () => {},
  } };
  await command.handler("settings", ctx);
  assert.equal(readSettings().apiBaseUrl, "http://127.0.0.1:8008");
  assert.equal(readSettings().apiToken, "new-private-token");
  assert.equal(readSettings().model, "kev-latest");
  assert.equal(inputs.find((i) => i.title.startsWith("API token"))?.prefill, undefined);
  selections.push("TypeSafe API base URL:", "Done");
  values.push("");
  await command.handler("settings", ctx);
  assert.equal(readSettings().apiBaseUrl, undefined);
  assert.equal(readSettings().apiToken, undefined);
}));
