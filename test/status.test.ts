import assert from "node:assert/strict";
import { test } from "node:test";
import { withPickerStatus } from "../src/status.ts";

test("before streaming, shows animated widget above editor and sets the future Working message", async () => {
  const updates: Array<{ key: string; lines: string[] | undefined; placement?: string }> = [];
  const messages: Array<string | undefined> = [];
  const ctx = { hasUI: true, isIdle: () => true, ui: {
    setWidget: (key: string, lines: string[] | undefined, options?: { placement: "aboveEditor" }) => updates.push({ key, lines, placement: options?.placement }),
    setWorkingMessage: (message?: string) => messages.push(message),
  } };
  const result = await withPickerStatus(ctx, async () => {
    assert.equal(messages[0], "Picking Skills");
    assert.match(updates[0]?.lines?.[0] ?? "", /Picking Skills/);
    assert.equal(updates[0]?.placement, "aboveEditor");
    await new Promise((resolve) => setTimeout(resolve, 220));
    return "selected";
  });
  assert.equal(result, "selected");
  assert.ok(updates.length >= 3, "spinner should advance while the request is pending");
  assert.notEqual(updates[0].lines?.[0], updates[1].lines?.[0]);
  assert.deepEqual(updates.at(-1), { key: "skill-picker-loading", lines: undefined, placement: undefined });
  assert.deepEqual(messages, ["Picking Skills", undefined]);
});

test("during streaming, replaces the built-in Working row without adding a widget", async () => {
  const updates: Array<string[] | undefined> = [];
  const messages: Array<string | undefined> = [];
  const ctx = { hasUI: true, isIdle: () => false, ui: {
    setWidget: (_key: string, lines: string[] | undefined) => updates.push(lines),
    setWorkingMessage: (message?: string) => messages.push(message),
  } };
  await withPickerStatus(ctx, async () => {
    assert.deepEqual(messages, ["Picking Skills"]);
    assert.deepEqual(updates, []);
  });
  assert.deepEqual(messages, ["Picking Skills", undefined]);
  assert.deepEqual(updates, []);
});

test("restores Working after failures and does nothing without an interactive UI", async () => {
  const updates: Array<string[] | undefined> = [];
  const messages: Array<string | undefined> = [];
  const ctx = { hasUI: true, isIdle: () => false, ui: {
    setWidget: (_key: string, lines: string[] | undefined) => updates.push(lines),
    setWorkingMessage: (message?: string) => messages.push(message),
  } };
  await assert.rejects(withPickerStatus(ctx, async () => { throw new Error("Jev unavailable"); }), /Jev unavailable/);
  assert.deepEqual(messages, ["Picking Skills", undefined]);
  const noUI = { ...ctx, hasUI: false };
  assert.equal(await withPickerStatus(noUI, async () => 42), 42);
  assert.equal(messages.length, 2);
});
