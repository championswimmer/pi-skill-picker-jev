// Opt-in, synthetic-data-only integration tests: KEV_TEST_BASE_URL=http://127.0.0.1:8008 npm test
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Skill } from "@earendil-works/pi-coding-agent";
import skillPicker from "../src/extension.ts";
import { rankSkills } from "../src/picker.ts";
import { DEFAULT_SETTINGS, writeSettings } from "../src/settings.ts";

const base = process.env.KEV_TEST_BASE_URL;
const token = process.env.KEV_TEST_API_TOKEN ?? "";
const model = "kev-latest";
const candidates: Skill[] = [
  ["postgres-migrations", "Create PostgreSQL schema migrations, indexes and SQL query performance fixes."],
  ["react-accessibility", "Build React forms with accessible labels, keyboard navigation and screen reader support."],
  ["kubernetes-deploy", "Deploy containerized services to Kubernetes with Helm, probes and rolling updates."],
  ["python-pytest", "Write Python unit tests and pytest fixtures, parametrization and test mocking."],
  ["security-review", "Review code for SQL injection, XSS, authentication flaws and unsafe handling of secrets."],
  ["brand-copy", "Write marketing slogans, product taglines and brand voice guidelines."],
].map(([name, description]) => ({ name, description, filePath: `/synthetic/${name}/SKILL.md`, baseDir: `/synthetic/${name}`, disableModelInvocation: false,
  sourceInfo: { path: `/synthetic/${name}/SKILL.md`, source: "test", scope: "project", origin: "top-level", baseDir: `/synthetic/${name}` } }));
const cases = [
  { task: "Create a PostgreSQL migration adding a composite index to speed up customer order queries.", relevant: ["postgres-migrations"] },
  { task: "Fix keyboard navigation and missing screen reader labels in a React signup form.", relevant: ["react-accessibility"] },
  { task: "Deploy our containerized service to Kubernetes using Helm with readiness probes and rolling updates.", relevant: ["kubernetes-deploy"] },
  { task: "Write pytest unit tests and fixtures for this Python parser, mocking filesystem calls.", relevant: ["python-pytest"] },
  { task: "Audit a React login form and PostgreSQL query builder for XSS and SQL injection vulnerabilities.", relevant: ["security-review", "react-accessibility", "postgres-migrations"] },
  { task: "Reply with the single word hello. Do not do anything else.", relevant: [] },
];

// One serial test keeps env/global fetch isolation straightforward and limits GPU load.
test("live Kev: picker, extension settings, fail-closed auth and Noul/Score comparison", { skip: !base, timeout: 300_000 }, async (t) => {
  const url = new URL(base!);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname), "live fixtures only target loopback");
  const reports: unknown[] = [];
  const realFetch = globalThis.fetch;
  const options = { apiKey: token, apiBaseUrl: base, model, threshold: 0, maxNew: 100 };
  await t.test("Noul versus five-level Score on fixed synthetic tasks", async () => {
    for (const fixture of cases) {
      let request: any;
      const startScore = performance.now();
      const scored = await rankSkills(fixture.task, candidates, [], { ...options,
        fetcher: (async (url, init) => { request = JSON.parse(init!.body as string); return realFetch(url, init); }) as typeof fetch,
      });
      const scoreMs = performance.now() - startScore;
      assert.equal(scored.length, candidates.length);
      const questions = Object.fromEntries(Object.entries(request.questions).map(([id, q]: [string, any]) => [id, {
        type: "noul", instructions: q.instructions.replace("How useful would this skill be", "Would this skill be directly useful"),
        criteria: { true: "Directly useful for this task; include its description in the agent context.", false: "Not needed now; omit it from the agent context." },
      }]));
      const startNoul = performance.now();
      const response = await realFetch(`${base}/v1/systemone`, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(30_000),
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ ...request, questions }),
      });
      assert.equal(response.status, 200);
      const result: any = await response.json();
      const noulMs = performance.now() - startNoul;
      const rows = candidates.map((skill, i) => {
        const answer = result.answers[`s${i}`];
        assert.ok(Number.isFinite(answer.noul) && answer.noul >= 0 && answer.noul <= 1);
        return { skill: skill.name, labeledRelevant: fixture.relevant.includes(skill.name),
          noul: answer.noul, normalizedScore: scored.find((r) => r.skill.name === skill.name)!.score };
      });
      reports.push({ ...fixture, noulMs, scoreMs, rows });
      // Clear single-purpose fixtures should at least rank the directly matching skill first.
      if (fixture.relevant.length === 1) assert.equal(scored[0].skill.name, fixture.relevant[0]);
    }
  });
  await t.test("real concurrent batches honor threshold and maxNew", async () => {
    const ranked = await rankSkills(cases[0].task, candidates, [], { ...options, batchSize: 2, threshold: DEFAULT_SETTINGS.threshold, maxNew: 1 });
    assert.equal(ranked.length, 1);
    assert.equal(ranked[0].skill.name, "postgres-migrations");
    assert.ok(ranked[0].score >= DEFAULT_SETTINGS.threshold);
  });
  await t.test("allowlist global importance and topic search work against Kev", async () => {
    for (const mode of [{ globalImportance: true }, { topicSearch: true }]) {
      const ranked = await rankSkills("PostgreSQL migrations", candidates, [], { ...options, ...mode });
      assert.equal(ranked.length, candidates.length);
    }
  });
  await t.test("persisted local endpoint bypasses OpenRouter auth; actual extension hides the catalog", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kev-live-"));
    const oldDir = process.env.PI_CODING_AGENT_DIR;
    try {
      process.env.PI_CODING_AGENT_DIR = dir;
      writeSettings({ ...DEFAULT_SETTINGS, mode: "custom-http", apiBaseUrl: base, apiToken: token || undefined, model, maxNew: 1, minSkills: 0 });
      const handlers = new Map<string, Function>();
      const pi = { on: (name: string, handler: Function) => handlers.set(name, handler), registerCommand: () => {}, appendEntry: () => {} };
      skillPicker(pi as any);
      const ctx = { cwd: dir, hasUI: false, sessionManager: { getBranch: () => [], getSessionId: () => "synthetic-kev-live" },
        modelRegistry: { getApiKeyForProvider: async () => { throw new Error("Must not ask for OpenRouter credentials"); } }, ui: {} };
      await handlers.get("session_start")!({}, ctx);
      const event = { prompt: cases[0].task, systemPromptOptions: { skills: candidates, tools: [], guidelines: ["Preserve this guideline"] } };
      await handlers.get("before_agent_start")!(event, ctx);
      assert.deepEqual(event.systemPromptOptions.skills.map((s) => s.name), ["postgres-migrations"]);
      assert.deepEqual(event.systemPromptOptions.guidelines, ["Preserve this guideline"]);
      if (token) {
        writeSettings({ ...DEFAULT_SETTINGS, mode: "custom-http", apiBaseUrl: base, apiToken: "deliberately-wrong-token", model, minSkills: 0 });
        const retry = { prompt: cases[1].task, systemPromptOptions: { skills: candidates } };
        await handlers.get("before_agent_start")!(retry, ctx);
        assert.deepEqual(retry.systemPromptOptions.skills.map((s) => s.name), ["postgres-migrations"], "failed auth must retain only already selected skills");
      }
    } finally {
      if (oldDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = oldDir;
      rmSync(dir, { recursive: true, force: true });
    }
  });
  if (process.env.KEV_TEST_REPORT) writeFileSync(process.env.KEV_TEST_REPORT, JSON.stringify({
    model: process.env.KEV_TEST_SIZE ?? model, testedAt: new Date().toISOString(), reports,
  }, null, 2) + "\n");
});
