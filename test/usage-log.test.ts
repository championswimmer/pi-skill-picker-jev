import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendUsageLog, reportDecisionUsage, type UsageLogRecord } from "../src/usage-log.ts";

const decision = { model: "typesafe/jev-1.13-20260917", input: 142, output: 7, cost: 0.000032 };

test("each Jev batch emits Pi session usage and a pi-stats-compatible sidecar row", () => {
  const dir = mkdtempSync(join(tmpdir(), "jev-usage-"));
  const entries: unknown[][] = [];
  const session = { getSessionId: () => "session-123",
    appendUsage: (...args: unknown[]) => {
      entries.push(args);
      return { id: `entry-${entries.length}`, timestamp: `2026-01-01T00:00:0${entries.length}.000Z` };
    } };
  try {
    const writeLog = (record: UsageLogRecord) => appendUsageLog(record, dir);
    reportDecisionUsage(session as any, decision, (error) => { throw error; }, writeLog);
    reportDecisionUsage(session as any, decision, (error) => { throw error; }, writeLog);
    assert.equal(entries.length, 2);
    assert.deepEqual(entries[0].slice(0, 3), ["skill_picker_jev", "openrouter", decision.model]);
    assert.deepEqual(entries[0][3], {
      input: 142, output: 7, cacheRead: 0, cacheWrite: 0, totalTokens: 149,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.000032 },
    });
    const path = join(dir, "usage.jsonl");
    const rows = readFileSync(path, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((r) => r.id), ["session-123:entry-1", "session-123:entry-2"]);
    assert.deepEqual(rows[0], {
      v: 1, id: "session-123:entry-1", ts: "2026-01-01T00:00:01.000Z",
      source: "skill-picker-jev", label: "jev decision", provider: "openrouter", model: decision.model,
      usage: { input: 142, output: 7, cacheRead: 0, cacheWrite: 0, reasoning: 0, cost: 0.000032 },
      sessionId: "session-123", usageEntryId: "entry-1", kind: "skill_picker_jev",
    });
    assert.equal((statSync(path).mode & 0o777), 0o600);
    assert.doesNotMatch(readFileSync(path, "utf8"), /task|description|apiKey/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("Pi session usage failure still writes a uniquely identified sidecar model call", () => {
  const dir = mkdtempSync(join(tmpdir(), "jev-usage-fallback-"));
  const errors: unknown[] = [];
  const session = { getSessionId: () => "session-123", appendUsage: () => { throw new Error("session not persisted"); } };
  try {
    reportDecisionUsage(session as any, decision, (error) => errors.push(error),
      (record) => appendUsageLog(record, dir));
    assert.equal(errors.length, 1);
    const rows = readFileSync(join(dir, "usage.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(rows.length, 1);
    assert.match(rows[0].id, /^[0-9a-f-]{36}$/);
    assert.equal(rows[0].usage.cost, decision.cost);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
