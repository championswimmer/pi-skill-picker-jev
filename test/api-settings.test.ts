import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Skill } from "@earendil-works/pi-coding-agent";
import { DEFAULT_SETTINGS, parseApiBaseUrl, readSettings, writeSettings } from "../src/settings.ts";
import { rankSkills } from "../src/picker.ts";

const candidate: Skill = { name: "review", description: "Review source code", filePath: "/skills/review/SKILL.md", baseDir: "/skills/review", disableModelInvocation: false,
  sourceInfo: { path: "/skills/review/SKILL.md", source: "test", scope: "project", origin: "top-level", baseDir: "/skills/review" } };

test("classifier settings persist privately and infer legacy mode defaults", () => {
  const dir = mkdtempSync(join(tmpdir(), "picker-api-"));
  const path = join(dir, "settings.json");
  try {
    assert.deepEqual(readSettings(path), DEFAULT_SETTINGS);
    const settings = { ...DEFAULT_SETTINGS, mode: "custom-http" as const, apiBaseUrl: "http://127.0.0.1:8008", apiToken: "local-test-token", model: "kev-latest" };
    writeSettings(settings, path);
    assert.deepEqual(readSettings(path), settings);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.equal(JSON.parse(readFileSync(path, "utf8")).apiToken, "local-test-token");
    writeSettings(DEFAULT_SETTINGS, path);
    assert.deepEqual(readSettings(path), DEFAULT_SETTINGS);
    writeFileSync(path, JSON.stringify({ apiBaseUrl: "not-a-url", apiToken: "private" }));
    assert.equal(readSettings(path).mode, "custom-http");
    assert.equal(readSettings(path).apiBaseUrl, "not-a-url", "invalid endpoint must not fall back to OpenRouter");
    writeFileSync(path, JSON.stringify({ apiToken: "private" }));
    assert.equal(readSettings(path).mode, "custom-http");
    for (const apiBaseUrl of ["", null, 123, {}]) {
      writeFileSync(path, JSON.stringify({ apiBaseUrl, apiToken: "private" }));
      assert.equal(readSettings(path).mode, "custom-http");
      assert.notEqual(readSettings(path).apiBaseUrl, undefined, "malformed endpoint must not enable OpenRouter fallback");
    }
    assert.throws(() => writeSettings(settingsWithUrl("file:///tmp/api"), path));
    assert.throws(() => writeSettings({ ...DEFAULT_SETTINGS, apiToken: "bad\nheader" }, path));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

function settingsWithUrl(apiBaseUrl: string) { return { ...DEFAULT_SETTINGS, apiBaseUrl }; }

test("base URL parser rejects credentials, fragments, queries, and non-HTTP URLs", () => {
  assert.equal(parseApiBaseUrl(" http://localhost:8008/ "), "http://localhost:8008");
  for (const value of ["", "garbage", "file:///api", "https://user:secret@host", "https://host?token=secret", "https://host#fragment"]) {
    assert.equal(parseApiBaseUrl(value), undefined);
  }
});

for (const suffix of ["", "/", "/v1", "/v1/"]) {
  test(`TypeSafe base URL ${suffix || "root"} uses systemone, optional auth and default model`, async () => {
    let calls = 0;
    const ranked = await rankSkills("Review code", [candidate], [], {
      apiKey: "", apiBaseUrl: `http://127.0.0.1:8008${suffix}`,
      fetcher: (async (url, init) => {
        calls++;
        assert.equal(url, "http://127.0.0.1:8008/v1/systemone");
        assert.equal(init?.redirect, "error");
        assert.equal(new Headers(init?.headers).has("Authorization"), false);
        const request = JSON.parse(init?.body as string);
        assert.equal(request.model, "jev-latest");
        const id = Object.keys(request.questions)[0];
        return new Response(JSON.stringify({ answers: { [id]: { type: "score", score: 3.8 } } }));
      }) as typeof fetch,
    });
    assert.equal(calls, 1);
    assert.equal(ranked[0]?.skill.name, "review");
  });
}

test("custom API token and model are sent only to the selected endpoint", async () => {
  await rankSkills("Review code", [candidate], [], {
    apiKey: "override", apiBaseUrl: "https://example.test", model: "kev-latest",
    fetcher: (async (url, init) => {
      assert.equal(url, "https://example.test/v1/systemone");
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer override");
      assert.equal(JSON.parse(init?.body as string).model, "kev-latest");
      return new Response(JSON.stringify({ answers: {} }));
    }) as typeof fetch,
  });
});

test("invalid custom endpoint fails before network access; HTTP failures do not select skills", async () => {
  let calls = 0;
  const fetcher = (async () => { calls++; return new Response("no", { status: 401 }); }) as typeof fetch;
  await assert.rejects(rankSkills("Review code", [candidate], [], { apiKey: "secret", apiBaseUrl: "invalid", fetcher }), /Invalid TypeSafe API base URL/);
  assert.equal(calls, 0);
  await assert.rejects(rankSkills("Review code", [candidate], [], { apiKey: "secret", apiBaseUrl: "http://localhost:8008", fetcher }), /TypeSafe API returned 401/);
  assert.equal(calls, 1);
});
