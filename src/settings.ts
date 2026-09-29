import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export const TRIGGER_MODES = ["prompt-only", "prompt-and-tools", "every-request"] as const;
export type TriggerMode = typeof TRIGGER_MODES[number];

export const TRIGGER_LABELS: Record<TriggerMode, string> = {
  "prompt-only": "Prompt only",
  "prompt-and-tools": "Prompt + tool results",
  "every-request": "Every changed request",
};

export interface PickerSettings {
  enabled: boolean;
  threshold: number;
  maxNew: number;
  triggerMode: TriggerMode;
  /** TypeSafe-compatible server root (without /v1/systemone). Unset uses OpenRouter. */
  apiBaseUrl?: string;
  /** Overrides Pi's OpenRouter credentials; never sent to a different endpoint implicitly. */
  apiToken?: string;
  model?: string;
}

export const DEFAULT_SETTINGS: PickerSettings = { enabled: true, threshold: 0.625, maxNew: 6, triggerMode: "prompt-and-tools" };

export function isTriggerMode(value: unknown): value is TriggerMode {
  return TRIGGER_MODES.some((mode) => mode === value);
}

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

export function parseApiBaseUrl(value: string): string | undefined {
  try {
    const url = new URL(value.trim());
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) return undefined;
    return url.toString().replace(/\/+$/, "");
  } catch { return undefined; }
}

export function readSettings(path = getSettingsPath()): PickerSettings {
  try {
    const data: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!data || typeof data !== "object") return { ...DEFAULT_SETTINGS };
    const { enabled, threshold, maxNew, triggerMode, apiBaseUrl, apiToken, model } = data as Record<string, unknown>;
    // Keep invalid endpoints: request validation must fail closed, not
    // silently send a custom server's token/task to OpenRouter.
    const optional = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : undefined;
    return {
      enabled: typeof enabled === "boolean" ? enabled : DEFAULT_SETTINGS.enabled,
      threshold: typeof threshold === "number" ? parseThreshold(String(threshold)) ?? DEFAULT_SETTINGS.threshold : DEFAULT_SETTINGS.threshold,
      maxNew: typeof maxNew === "number" ? parseMaxNew(String(maxNew)) ?? DEFAULT_SETTINGS.maxNew : DEFAULT_SETTINGS.maxNew,
      triggerMode: isTriggerMode(triggerMode) ? triggerMode : DEFAULT_SETTINGS.triggerMode,
      ...(apiBaseUrl !== undefined ? { apiBaseUrl: typeof apiBaseUrl === "string" ? apiBaseUrl.trim() : "invalid:base-url" } : {}),
      ...(optional(apiToken) ? { apiToken: optional(apiToken) } : {}),
      ...(optional(model) ? { model: optional(model) } : {}),
    };
  } catch { return { ...DEFAULT_SETTINGS }; }
}

export function writeSettings(settings: PickerSettings, path = getSettingsPath()): void {
  if (typeof settings.enabled !== "boolean" || parseThreshold(String(settings.threshold)) === undefined || parseMaxNew(String(settings.maxNew)) === undefined ||
    !isTriggerMode(settings.triggerMode) ||
    (settings.apiBaseUrl !== undefined && !parseApiBaseUrl(settings.apiBaseUrl)) ||
    [settings.apiToken, settings.model].some((value) => value !== undefined &&
      (typeof value !== "string" || !value.trim() || /[\r\n]/.test(value)))) {
    throw new Error("Invalid skill picker settings");
  }
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(settings, null, 2) + "\n", { mode: 0o600 });
  renameSync(temporary, path);
}
