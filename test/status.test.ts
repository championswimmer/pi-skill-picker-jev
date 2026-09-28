import assert from "node:assert/strict";
import { test } from "node:test";
import { withPickerStatus } from "../src/status.ts";

test("shows an animated skill-picking footer while decisions run, then clears it", async () => {
  const updates: Array<{ key: string; text: string | undefined }> = [];
  const ctx = { hasUI: true, ui: { setStatus: (key: string, text: string | undefined) => updates.push({ key, text }) } };
  const result = await withPickerStatus(ctx, async () => {
    assert.match(updates[0]?.text ?? "", /Picking the right skills/);
    await new Promise((resolve) => setTimeout(resolve, 220));
    return "selected";
  });
  assert.equal(result, "selected");
  assert.ok(updates.length >= 3, "spinner should advance while the request is pending");
  assert.notEqual(updates[0].text, updates[1].text);
  assert.deepEqual(updates.at(-1), { key: "skill-picker", text: undefined });
});

test("clears the loader after failures and skips status changes without an interactive UI", async () => {
  const updates: Array<string | undefined> = [];
  const ctx = { hasUI: true, ui: { setStatus: (_key: string, text: string | undefined) => updates.push(text) } };
  await assert.rejects(withPickerStatus(ctx, async () => { throw new Error("Jev unavailable"); }), /Jev unavailable/);
  assert.equal(updates.at(-1), undefined);
  const noUI = { ...ctx, hasUI: false };
  assert.equal(await withPickerStatus(noUI, async () => 42), 42);
  assert.equal(updates.length, 2);
});
