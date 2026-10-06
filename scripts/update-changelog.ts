import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const TAG = /^v\d+\.\d+\.\d+$/;
const START = "<!-- generated-release-notes:start -->";
const END = "<!-- generated-release-notes:end -->";

export function previousTag(tag: string, sortedAncestorTags: string[]): string | undefined {
  if (!TAG.test(tag)) throw new Error("Expected a stable release tag such as v0.3.0");
  const tags = sortedAncestorTags.filter((value) => TAG.test(value));
  const index = tags.indexOf(tag);
  if (index < 0) throw new Error(`Tag not found: ${tag}`);
  return tags[index + 1];
}

/** Preserve handwritten notes; replace only the generated block on reruns. */
export function updateChangelog(changelog: string, tag: string, notes: string): string {
  if (!TAG.test(tag)) throw new Error("Expected a stable release tag");
  const version = tag.slice(1);
  // GitHub's level-two headings must be nested under our release heading.
  const nested = notes.trim().replace(/^(#{1,5}) /gm, "$1# ");
  const block = `${START}\n${nested}\n${END}`;
  const sections = [...changelog.matchAll(/^## (\d+\.\d+\.\d+)(?:[^\n]*)$/gm)];
  const existing = sections.findIndex((match) => match[1] === version);
  if (existing >= 0) {
    const start = sections[existing].index!;
    const end = sections[existing + 1]?.index ?? changelog.length;
    const section = changelog.slice(start, end);
    const begin = section.indexOf(START);
    const finish = section.indexOf(END);
    if ((begin >= 0) !== (finish >= 0) || (begin >= 0 && finish < begin)) {
      throw new Error("Malformed generated release notes block");
    }
    const updated = begin >= 0
      ? section.slice(0, begin) + block + section.slice(finish + END.length)
      : `${section.trimEnd()}\n\n${block}\n\n`;
    return changelog.slice(0, start) + updated + changelog.slice(end);
  }
  const newer = (other: string) => {
    const a = version.split(".").map(Number);
    const b = other.split(".").map(Number);
    for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
    return false;
  };
  const insertAt = sections.find((match) => newer(match[1]))?.index ?? changelog.length;
  const prefix = changelog.slice(0, insertAt).trimEnd();
  return `${prefix}\n\n## ${version}\n\n${block}\n\n${changelog.slice(insertAt)}`;
}

export function main(): void {
  const tag = process.env.RELEASE_TAG;
  const repository = process.env.GITHUB_REPOSITORY;
  if (!tag || !TAG.test(tag)) throw new Error("RELEASE_TAG must be a stable vX.Y.Z tag");
  if (!repository || !/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error("Missing GITHUB_REPOSITORY");
  const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();
  // Do not write release notes for tags outside the checked-out default branch.
  git("merge-base", "--is-ancestor", tag, "HEAD");
  const previous = previousTag(tag, git("tag", "--merged", tag, "--sort=-version:refname").split("\n"));
  const args = ["api", "--method", "POST", `repos/${repository}/releases/generate-notes`, "-f", `tag_name=${tag}`];
  if (previous) args.push("-f", `previous_tag_name=${previous}`);
  const { body } = JSON.parse(execFileSync("gh", args, { encoding: "utf8" })) as { body: unknown };
  if (typeof body !== "string" || !body.trim()) throw new Error("GitHub returned no release notes");
  const path = "CHANGELOG.md";
  writeFileSync(path, updateChangelog(readFileSync(path, "utf8"), tag, body));
  console.log(`Updated ${path} for ${tag} (since ${previous ?? "initial release"})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
