import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";

/** Names only: paths and descriptions belong to Pi's current project inventory. */
export function allowlistPath(cwd: string): string {
  return join(cwd, ".pi", "skill-picker-jev.json");
}

export function readAllowlist(cwd: string): Set<string> {
  try {
    const data: unknown = JSON.parse(readFileSync(allowlistPath(cwd), "utf8"));
    if (!data || typeof data !== "object" || !Array.isArray((data as { alwaysAllowed?: unknown }).alwaysAllowed)) return new Set();
    return new Set((data as { alwaysAllowed: unknown[] }).alwaysAllowed.filter((name): name is string => typeof name === "string" && !!name.trim()));
  } catch { return new Set(); }
}

export function writeAllowlist(cwd: string, names: Iterable<string>): void {
  const path = allowlistPath(cwd);
  const unique = [...new Set(names)];
  if (unique.some((name) => typeof name !== "string" || !name.trim())) throw new Error("Invalid skill name");
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify({ alwaysAllowed: unique.sort() }, null, 2) + "\n", { mode: 0o600 });
  renameSync(temporary, path);
}
