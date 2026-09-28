import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export interface PickerSettings {
  threshold: number;
  maxNew: number;
}

export const DEFAULT_SETTINGS: PickerSettings = { threshold: 0.75, maxNew: 6 };

export function getSettingsPath(): string {
  return join(getAgentDir(), "pi-skill-picker-jev.json");
}

export function parseThreshold(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : undefined;
}

export function parseMaxNew(value: string): number | undefined {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  const n = Number(trimmed);
  return Number.isSafeInteger(n) && n <= 100 ? n : undefined;
}

export function readSettings(path = getSettingsPath()): PickerSettings {
  try {
    const data: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!data || typeof data !== "object") return { ...DEFAULT_SETTINGS };
    const { threshold, maxNew } = data as Record<string, unknown>;
    return {
      threshold: typeof threshold === "number" ? parseThreshold(String(threshold)) ?? DEFAULT_SETTINGS.threshold : DEFAULT_SETTINGS.threshold,
      maxNew: typeof maxNew === "number" ? parseMaxNew(String(maxNew)) ?? DEFAULT_SETTINGS.maxNew : DEFAULT_SETTINGS.maxNew,
    };
  } catch { return { ...DEFAULT_SETTINGS }; }
}

export function writeSettings(settings: PickerSettings, path = getSettingsPath()): void {
  if (parseThreshold(String(settings.threshold)) === undefined || parseMaxNew(String(settings.maxNew)) === undefined) {
    throw new Error("Invalid skill picker settings");
  }
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(settings, null, 2) + "\n", { mode: 0o600 });
  renameSync(temporary, path);
}
