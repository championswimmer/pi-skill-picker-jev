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
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("Authorization"), expectedAuth);
    if (expectedUrl.includes("openrouter.ai")) {
      assert.equal(headers.get("User-Agent"), "pi-coding-agent (pi-skill-picker-jev)");
      assert.equal(headers.get("X-Title"), "Pi Coding Agent");
    } else {
      assert.equal(headers.has("User-Agent"), false);
      assert.equal(headers.has("X-Title"), false);
    }
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

test("API settings UI keeps custom-http mode, labels, and saved values coherent", async () => isolated(async (dir) => {
  let command: any;
  writeSettings({ ...DEFAULT_SETTINGS, apiToken: "old-private-token" });
  skillPicker({ on: () => {}, registerCommand: (_name: string, options: any) => { command = options; } } as any);
  const values = ["http://127.0.0.1:8008/", "new-private-token", "kev-latest", "second-private-token", "http://127.0.0.1:9000/"];
  const inputs: { title: string; prefill: unknown }[] = [];
  const selectPlans: Array<{ title: string; pick: (options: string[]) => string | undefined }> = [
    {
      title: "Skill picker settings",
      pick: (options) => {
        assert.ok(options.every((s) => !s.includes("private-token")));
        assert.ok(options.includes("Classifier mode: Hosted OpenRouter / Jev"));
        assert.ok(options.includes("Custom HTTP base URL (used by Custom HTTP endpoint mode): not set"));
        assert.ok(options.includes("Custom HTTP token (used by Custom HTTP endpoint mode): configured (hidden)"));
        return options.find((s) => s.startsWith("Custom HTTP base URL (used by Custom HTTP endpoint mode):"));
      },
    },
    {
      title: "Skill picker settings",
      pick: (options) => {
        assert.ok(options.includes("Classifier mode: Custom HTTP endpoint"));
        assert.ok(options.includes("Custom HTTP base URL: http://127.0.0.1:8008"));
        assert.ok(options.includes("Custom HTTP token: not set"));
        return options.find((s) => s.startsWith("Custom HTTP token:"));
      },
    },
    {
      title: "Skill picker settings",
      pick: (options) => options.find((s) => s.startsWith("Decision model:")),
    },
    { title: "Skill picker settings", pick: () => "Done" },
    {
      title: "Skill picker settings",
      pick: (options) => options.find((s) => s.startsWith("Classifier mode:")),
    },
    {
      title: "Classifier mode",
      pick: (options) => options.find((s) => s === "Pi classifier"),
    },
    {
      title: "Skill picker settings",
      pick: (options) => {
        assert.ok(options.includes("Classifier mode: Pi classifier"));
        assert.ok(options.includes("Custom HTTP base URL (used by Custom HTTP endpoint mode): not set"));
        assert.ok(options.includes("Custom HTTP token (used by Custom HTTP endpoint mode): not set"));
        return options.find((s) => s.startsWith("Custom HTTP token (used by Custom HTTP endpoint mode):"));
      },
    },
    {
      title: "Skill picker settings",
      pick: (options) => {
        assert.ok(options.includes("Classifier mode: Custom HTTP endpoint"));
        assert.ok(options.includes("Custom HTTP token: configured (hidden)"));
        return "Done";
      },
    },
    {
      title: "Skill picker settings",
      pick: (options) => {
        assert.ok(options.includes("Custom HTTP token: configured (hidden)"));
        return options.find((s) => s.startsWith("Custom HTTP base URL:"));
      },
    },
    { title: "Skill picker settings", pick: () => "Done" },
  ];
  const ctx = { cwd: dir, hasUI: true, ui: {
    select: async (title: string, options: string[]) => {
      const plan = selectPlans.shift();
      assert.ok(plan, `unexpected select: ${title}`);
      assert.equal(title, plan.title);
      return plan.pick(options);
    },
    input: async (title: string, prefill: unknown) => {
      inputs.push({ title, prefill });
      if (title.startsWith("Custom HTTP token")) assert.equal(prefill, undefined);
      return values.shift();
    },
    notify: () => {},
  } };
  await command.handler("settings", ctx);
  assert.deepEqual(readSettings(), {
    ...DEFAULT_SETTINGS,
    mode: "custom-http",
    apiBaseUrl: "http://127.0.0.1:8008",
    apiToken: "new-private-token",
    model: "kev-latest",
  });
  await command.handler("settings", ctx);
  assert.deepEqual(readSettings(), {
    ...DEFAULT_SETTINGS,
    mode: "custom-http",
    apiToken: "second-private-token",
    model: "kev-latest",
  });
  await command.handler("settings", ctx);
  assert.deepEqual(readSettings(), {
    ...DEFAULT_SETTINGS,
    mode: "custom-http",
    apiBaseUrl: "http://127.0.0.1:9000",
    model: "kev-latest",
  });
  assert.deepEqual(inputs, [
    { title: "Custom TypeSafe-compatible server root URL for Custom HTTP endpoint mode (blank = clear)", prefill: undefined },
    { title: "Custom HTTP token for Custom HTTP endpoint mode (blank = clear; never prefilled)", prefill: undefined },
    { title: "Decision model (blank = default)", prefill: undefined },
    { title: "Custom HTTP token for Custom HTTP endpoint mode (blank = clear; never prefilled)", prefill: undefined },
    { title: "Custom TypeSafe-compatible server root URL for Custom HTTP endpoint mode (blank = clear)", prefill: undefined },
  ]);
  assert.equal(selectPlans.length, 0);
  assert.equal(values.length, 0);
}));
