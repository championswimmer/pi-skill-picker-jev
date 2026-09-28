import { randomUUID } from "node:crypto";
import { appendFileSync, chmodSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir, type SessionManager } from "@earendil-works/pi-coding-agent";
import type { DecisionCallUsage } from "./picker.ts";

const MAX_USAGE_LOG_BYTES = 16 * 1024 * 1024;

type UsageSession = Pick<SessionManager, "getSessionId"> & Partial<Pick<SessionManager, "appendUsage">>;

export interface UsageLogRecord {
  v: 1;
  id: string;
  ts: string;
  source: "skill-picker-jev";
  label: "decision";
  provider: "openrouter";
  model: string;
  usage: { input: number; output: number; cacheRead: 0; cacheWrite: 0; reasoning: 0; cost: number };
  sessionId: string;
  usageEntryId?: string;
  kind: "skill_picker_jev";
}

/** pi-stats scans <agentDir>/<extension>/usage.jsonl and its .1 rotation. */
export function appendUsageLog(record: UsageLogRecord, directory = join(getAgentDir(), "skill-picker-jev")): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const path = join(directory, "usage.jsonl");
  const line = JSON.stringify(record) + "\n";
  let size = 0;
  try { size = statSync(path).size; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (size + Buffer.byteLength(line) > MAX_USAGE_LOG_BYTES && size > 0) renameSync(path, `${path}.1`);
  appendFileSync(path, line, { encoding: "utf8", mode: 0o600 });
  chmodSync(path, 0o600);
}

/** Each successful Decisions API batch is one model invocation, including empty selections. */
export function reportDecisionUsage(
  session: UsageSession,
  decision: DecisionCallUsage,
  notifyError: (error: unknown) => void = (error) => console.error("[pi-skill-picker-jev] Usage reporting failed:", error),
  writeLog: (record: UsageLogRecord) => void = appendUsageLog,
): void {
  const usage: Parameters<SessionManager["appendUsage"]>[3] = {
    input: decision.input, output: decision.output, cacheRead: 0, cacheWrite: 0,
    totalTokens: decision.input + decision.output,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: decision.cost },
  };
  let entry: ReturnType<SessionManager["appendUsage"]> | undefined;
  let sessionId = "";
  try {
    sessionId = session.getSessionId();
    if (typeof session.appendUsage === "function") {
      entry = session.appendUsage("skill_picker_jev", "openrouter", decision.model, usage, "Jev skill relevance decision");
    }
  } catch (error) { notifyError(error); }
  try {
    writeLog({
      v: 1, id: entry ? `${sessionId}:${entry.id}` : randomUUID(), ts: entry?.timestamp ?? new Date().toISOString(),
      source: "skill-picker-jev", label: "decision", provider: "openrouter", model: decision.model,
      usage: { input: decision.input, output: decision.output, cacheRead: 0, cacheWrite: 0, reasoning: 0, cost: decision.cost },
      sessionId, ...(entry ? { usageEntryId: entry.id } : {}), kind: "skill_picker_jev",
    });
  } catch (error) { notifyError(error); }
}
