import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import type { Skill } from "@earendil-works/pi-coding-agent";
import { getSettingsPath } from "./settings.ts";

export type AllowlistScope = "global" | "project";

/** Project skills come from the project; everything else (user, temporary) is global. */
export function skillScope(skill: Pick<Skill, "sourceInfo">): AllowlistScope {
  return skill.sourceInfo?.scope === "project" ? "project" : "global";
}

const names = (value: unknown): Set<string> => Array.isArray(value)
  ? new Set(value.filter((name): name is string => typeof name === "string" && !!name.trim()))
  : new Set();

const validated = (input: Iterable<string>): string[] => {
  const unique = [...new Set(input)];
  if (unique.some((name) => typeof name !== "string" || !name.trim())) throw new Error("Invalid skill name");
  return unique.sort();
};

const writeJson = (path: string, data: unknown) => {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
  renameSync(temporary, path);
};

const readObject = (path: string): Record<string, unknown> | undefined => {
  try {
    const data: unknown = JSON.parse(readFileSync(path, "utf8"));
    return data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : undefined;
  } catch { return undefined; }
};

/** Names only: paths and descriptions belong to Pi's current project inventory. */
export function allowlistPath(cwd: string): string {
  return join(cwd, ".pi", "skill-picker-jev.json");
}

/** Project allowlist: applies only to project-scoped skills. */
export function readAllowlist(cwd: string): Set<string> {
  try { return names(readObject(allowlistPath(cwd))?.alwaysAllowed); } catch { return new Set(); }
}

export function writeAllowlist(cwd: string, input: Iterable<string>): void {
  writeJson(allowlistPath(cwd), { alwaysAllowed: validated(input) });
}

/** Global allowlist lives in the global settings file; applies only to non-project skills. */
export function readGlobalAllowlist(path = getSettingsPath()): Set<string> {
  return names(readObject(path)?.alwaysAllowed);
}

/** Read-modify-write so other (possibly invalid, fail-closed) settings are preserved verbatim. */
export function writeGlobalAllowlist(input: Iterable<string>, path = getSettingsPath()): void {
  writeJson(path, { ...readObject(path), alwaysAllowed: validated(input) });
}

/** A skill is always allowed only by the allowlist matching its own scope. */
export function isAlwaysAllowed(skill: Skill, project: Set<string>, global: Set<string>): boolean {
  return (skillScope(skill) === "project" ? project : global).has(skill.name);
}
