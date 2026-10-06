import assert from "node:assert/strict";
import { test } from "node:test";
import { previousTag, updateChangelog } from "../scripts/update-changelog.ts";

const original = "# Changelog\n\n## 0.3.0\n\n### Features\n\n- Handwritten summary.\n\n## 0.1.1\n\n- Older notes.\n";
const notes = "## What's Changed\n* Feature in https://github.com/example/repo/pull/1\n\n**Full Changelog**: compare/link";

test("uses preceding stable ancestor tag, not the latest tag or release", () => {
  assert.equal(previousTag("v0.3.0", ["v0.4.0", "v0.3.0", "v0.3.0-beta.1", "v0.2.0", "v0.1.1"]), "v0.2.0");
  assert.equal(previousTag("v0.2.0", ["v0.2.0", "unrelated", "v0.1.1"]), "v0.1.1");
  assert.equal(previousTag("v0.1.1", ["v0.1.1"]), undefined);
  assert.throws(() => previousTag("v0.3.0", ["v0.2.0"]), /not found/);
  assert.throws(() => previousTag("--evil", []), /stable release tag/);
});

test("preserves handwritten notes and nests GitHub headings", () => {
  const result = updateChangelog(original, "v0.3.0", notes);
  assert.ok(result.includes("- Handwritten summary."));
  assert.ok(result.includes("### What's Changed"));
  assert.ok(result.endsWith("## 0.1.1\n\n- Older notes.\n"));
  assert.equal(updateChangelog(result, "v0.3.0", notes), result);
  const refreshed = updateChangelog(result, "v0.3.0", "New notes");
  assert.ok(refreshed.includes("New notes"));
  assert.ok(!refreshed.includes("compare/link"));
  assert.equal(refreshed.match(/## 0\.3\.0/g)?.length, 1);
});

test("inserts historical and new releases in numeric version order", () => {
  const backfilled = updateChangelog(original, "v0.2.0", notes);
  assert.ok(backfilled.indexOf("## 0.3.0") < backfilled.indexOf("## 0.2.0"));
  assert.ok(backfilled.indexOf("## 0.2.0") < backfilled.indexOf("## 0.1.1"));
  assert.equal(updateChangelog(backfilled, "v0.2.0", notes), backfilled);
  const future = updateChangelog(backfilled, "v0.10.0", notes);
  assert.ok(future.indexOf("## 0.10.0") < future.indexOf("## 0.3.0"));
  assert.ok(updateChangelog("# Changelog\n", "v0.1.0", notes).startsWith("# Changelog\n\n## 0.1.0"));
});

test("rejects malformed blocks and unsafe tags", () => {
  assert.throws(() => updateChangelog(original + "<!-- generated-release-notes:start -->", "v0.1.1", notes), /Malformed/);
  assert.throws(() => updateChangelog(original, "v0.3.0; echo unsafe", notes), /stable release tag/);
});
