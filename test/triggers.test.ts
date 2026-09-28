import assert from "node:assert/strict";
import { test } from "node:test";
import { TriggerTracker } from "../src/triggers.ts";

const initial = [{ role: "user", content: [{ type: "text", text: "Review a PR" }] }];
const tool = { role: "toolResult", toolCallId: "call-1", content: [{ type: "text", text: "Deploy is the next step" }] };

test("prompt-only never repicks on follow-up requests", () => {
  const tracker = new TriggerTracker();
  tracker.snapshot(initial, "Review a PR");
  assert.equal(tracker.shouldRank("prompt-only", [...initial, tool], "Review a PR"), false);
  assert.equal(tracker.shouldRank("prompt-only", [...initial, tool,
    { role: "assistant", content: [{ type: "text", text: "Now deploy" }] }], "Review a PR"), false);
});

test("prompt + tool results repicks only after a new textual completed tool result", () => {
  const tracker = new TriggerTracker();
  tracker.snapshot(initial, "Review a PR");
  const thinking = { role: "assistant", content: [{ type: "thinking", thinking: "I should deploy" }] };
  assert.equal(tracker.shouldRank("prompt-and-tools", [...initial, thinking], "Review a PR"), false);
  assert.equal(tracker.shouldRank("prompt-and-tools", [...initial,
    { role: "assistant", content: [{ type: "text", text: "Let's deploy" }] }], "Review a PR"), false);
  assert.equal(tracker.shouldRank("prompt-and-tools", [...initial, tool], "Review a PR"), true);
  assert.equal(tracker.shouldRank("prompt-and-tools", [...initial, tool], "Review a PR"), false); // retries
  assert.equal(tracker.shouldRank("prompt-and-tools", [tool], "Review a PR"), false); // compaction
  const second = { role: "toolResult", toolCallId: "call-2", content: [{ type: "text", text: "Implement tests" }] };
  assert.equal(tracker.shouldRank("prompt-and-tools", [tool, second], "Review a PR"), true);
  assert.equal(tracker.shouldRank("prompt-and-tools", [tool, second,
    { role: "toolResult", toolCallId: "call-3", content: [{ type: "image", data: "..." }] }], "Review a PR"), false);
  tracker.reset();
  tracker.snapshot(initial, "Review a PR");
  assert.equal(tracker.shouldRank("prompt-and-tools", [...initial, tool], "Review a PR"), true);
});

test("every changed request includes assistant text but not thinking-only or unchanged retries", () => {
  const tracker = new TriggerTracker();
  tracker.snapshot(initial, "Review a PR");
  const thinking = [...initial, { role: "assistant", content: [{ type: "thinking", thinking: "Deploy next" }] }];
  assert.equal(tracker.shouldRank("every-request", thinking, "Review a PR"), false);
  const text = [...thinking, { role: "assistant", content: [{ type: "text", text: "Deploy next" }] }];
  assert.equal(tracker.shouldRank("every-request", text, "Review a PR"), true);
  assert.equal(tracker.shouldRank("every-request", text, "Review a PR"), false);
  assert.equal(tracker.shouldRank("every-request", [...text, tool], "Review a PR"), true);
});
