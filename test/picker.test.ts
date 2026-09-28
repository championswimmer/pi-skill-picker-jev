import assert from "node:assert/strict";
import { test } from "node:test";
import type { Skill } from "@earendil-works/pi-coding-agent";
import { rankSkills, transcriptText, type DecisionCallUsage } from "../src/picker.ts";
import skillPicker, { renderSkills } from "../src/extension.ts";

function skill(name: string): Skill {
  return { name, description: `${name} expertise`, filePath: `/skills/${name}/SKILL.md`, baseDir: `/skills/${name}`,
    disableModelInvocation: false, sourceInfo: { path: `/skills/${name}/SKILL.md`, source: "test", scope: "project", origin: "top-level", baseDir: `/skills/${name}` } };
}

test("Jev batches Pi skills, selects only threshold matches and fails closed", async () => {
  const requested: string[] = [];
  const usageCalls: DecisionCallUsage[] = [];
  const fetcher = async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    requested.push(...Object.values(body.questions).map((q: any) => q.instructions));
    const answers = Object.fromEntries(Object.entries(body.questions).map(([id, q]: [string, any]) => [id, { type: "score", score: q.instructions.includes("review") ? 3.72 : 0.48 }]));
    return new Response(JSON.stringify({ model: "typesafe/jev-1.13-20260917", usage: {
      input_tokens: 100, output_tokens: 5, cost: 0.00003 }, answers }), { status: 200 });
  };
  const ranked = await rankSkills("Review my PR", [skill("review"), skill("docker"), skill("deploy")], [],
    { apiKey: "test", batchSize: 2, fetcher: fetcher as typeof fetch, onUsage: (usage) => usageCalls.push(usage) });
  assert.deepEqual(ranked.map(({ skill, score }) => [skill.name, score]), [["review", 0.93]]);
  assert.equal(requested.length, 3);
  assert.deepEqual(usageCalls, [
    { model: "typesafe/jev-1.13-20260917", input: 100, output: 5, cost: 0.00003 },
    { model: "typesafe/jev-1.13-20260917", input: 100, output: 5, cost: 0.00003 },
  ]); // both batches count, even when the second batch selected nothing
  assert.deepEqual(await rankSkills("task", [skill("docker")], [], { apiKey: "" }), []);
  const originalError = console.error;
  try {
    console.error = () => {}; // intentional usage logger failure must not affect a decision
    const stillSelected = await rankSkills("Review my PR", [skill("review")], [], {
      apiKey: "test", fetcher: fetcher as typeof fetch, onUsage: () => { throw new Error("log unwritable"); },
    });
    assert.deepEqual(stillSelected.map(({ skill }) => skill.name), ["review"]);
  } finally { console.error = originalError; }
  assert.match(renderSkills(ranked.map(({ skill }) => skill)), /<name>review<\/name>/);
  assert.doesNotMatch(renderSkills(ranked.map(({ skill }) => skill)), /docker/);
});

test("Jev defaults to 50 candidates per batch", async () => {
  const sizes: number[] = [];
  const fetcher = async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    sizes.push(Object.keys(body.questions).length);
    return new Response(JSON.stringify({ answers: {} }), { status: 200 });
  };
  await rankSkills("task", Array.from({ length: 101 }, (_, i) => skill(`skill${i}`)), [],
    { apiKey: "test", fetcher: fetcher as typeof fetch });
  assert.deepEqual(sizes, [50, 50, 1]);
});

test("Jev batches run concurrently with a limit of six and preserve ranking order", async () => {
  const releases: Array<() => void> = [];
  let active = 0;
  let peak = 0;
  const fetcher = async (_url: unknown, init: RequestInit) => {
    active++;
    peak = Math.max(peak, active);
    const body = JSON.parse(init.body as string);
    await new Promise<void>((resolve) => releases.push(resolve));
    active--;
    return new Response(JSON.stringify({ answers: { s0: { type: "score", score: 3.6 } } }), { status: 200 });
  };
  const ranking = rankSkills("task", Array.from({ length: 8 }, (_, i) => skill(`skill${i}`)), [],
    { apiKey: "test", batchSize: 1, maxNew: 8, fetcher: fetcher as typeof fetch });
  assert.equal(releases.length, 6);
  assert.equal(peak, 6);
  releases[2](); // A later batch finishes before an earlier one.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(releases.length, 7);
  assert.equal(peak, 6);
  releases[6]();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(releases.length, 8);
  releases[7]();
  releases[5]();
  releases[4]();
  releases[3]();
  releases[1]();
  releases[0]();
  assert.deepEqual((await ranking).map(({ skill }) => skill.name),
    Array.from({ length: 8 }, (_, i) => `skill${i}`));
});

test("a failed batch waits for in-flight batches and does not start more or return partial selections", async () => {
  const releases: Array<() => void> = [];
  let completed = 0;
  let started = 0;
  const fetcher = async () => {
    const index = started++;
    if (index === 0) return new Response("unavailable", { status: 503 });
    await new Promise<void>((resolve) => { releases.push(resolve); });
    completed++;
    return new Response(JSON.stringify({ answers: { s0: { type: "score", score: 3.96 } } }));
  };
  const ranking = rankSkills("task", Array.from({ length: 8 }, (_, i) => skill(`skill${i}`)), [],
    { apiKey: "test", batchSize: 1, fetcher: fetcher as typeof fetch });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(started, 6);
  releases.forEach((release) => release());
  await assert.rejects(ranking, /503/);
  assert.equal(completed, 5);
  assert.equal(started, 6);
});

test("a shared ranking deadline aborts in-flight Jev batches and skips queued batches", async () => {
  const controller = new AbortController();
  let started = 0;
  const fetcher = async (_url: unknown, init: RequestInit) => {
    started++;
    return new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
    });
  };
  const ranking = rankSkills("task", Array.from({ length: 8 }, (_, i) => skill(`skill${i}`)), [],
    { apiKey: "test", batchSize: 1, fetcher: fetcher as typeof fetch, signal: controller.signal });
  assert.equal(started, 6);
  controller.abort(new Error("ranking timed out"));
  await assert.rejects(ranking, /ranking timed out/);
  assert.equal(started, 6);
});

test("filters only Pi's loaded skills and adds newly relevant Pi skills", async () => {
  const oldKey = process.env.OPENROUTER_API_KEY;
  const oldFetch = globalThis.fetch;
  try {
    delete process.env.OPENROUTER_API_KEY;
    globalThis.fetch = (async (_url: unknown, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      const answers = Object.fromEntries(Object.entries(body.questions).map(([id, q]: [string, any]) => {
        const name = q.instructions.match(/Name: (\w+)/)?.[1];
        return [id, { type: "score", score: name === "external" || body.state.task.toLowerCase().includes(name) ? 3.88 : 0.08 }];
      }));
      return new Response(JSON.stringify({ answers }), { status: 200 });
    }) as typeof fetch;
    const handlers = new Map<string, Function>();
    const branch: Array<{ type: string; customType: string; data: unknown }> = [];
    skillPicker({ on: (name: string, handler: Function) => handlers.set(name, handler), registerCommand: () => {},
      appendEntry: (customType: string, data: unknown) => branch.push({ type: "custom", customType, data }) } as any);
    let authCalls = 0;
    const ctx = { cwd: "/tmp", sessionManager: { getBranch: () => branch }, modelRegistry: { getApiKeyForProvider: async (provider: string) => {
      assert.equal(provider, "openrouter");
      authCalls++;
      return "pi-stored-key";
    } } };
    await handlers.get("session_start")!({}, ctx);
    const disabled = { ...skill("manual"), disableModelInvocation: true };
    const event = { prompt: "Review this change", systemPromptOptions: { skills: [skill("review"), skill("deploy"), disabled, skill("review")] } };
    await handlers.get("before_agent_start")!(event, ctx);
    assert.deepEqual(event.systemPromptOptions.skills.map((s) => s.name), ["review"]);
    const messages = [{ role: "system", content: "Pi", sections: { skills: "ALL SKILLS" } },
      { role: "user", content: [{ type: "text", text: "Review this change" }] }];
    assert.equal(await handlers.get("context_with_system")!({ messages }, ctx), undefined);
    const second = await handlers.get("context_with_system")!({ messages: [...messages,
      { role: "toolResult", toolCallId: "call-deploy", content: [{ type: "text", text: "Now deploy the change" }] }] }, ctx);
    assert.equal(authCalls, 2);
    assert.equal(second.messages.at(-1).role, "system");
    assert.match(second.messages.at(-1).sections.skills, /<name>deploy<\/name>/);
    assert.doesNotMatch(second.messages.at(-1).sections.skills, /external|manual/);
    // If Pi's inventory changes, previously selected skills that Pi no longer
    // supplies must disappear instead of leaking into subsequent prompts.
    const next = { prompt: "Unrelated task", systemPromptOptions: { skills: [skill("drawing")] } };
    await handlers.get("before_agent_start")!(next, ctx);
    assert.deepEqual(next.systemPromptOptions.skills, []);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = oldKey;
  }
});

test("transcript selection excludes system prompt and non-text blocks", () => {
  const context = transcriptText([{ role: "system", content: "SECRET" },
    { role: "assistant", content: [{ type: "text", text: "Start deploying" }, { type: "image", data: "image" }] }]);
  assert.match(context, /Start deploying/);
  assert.doesNotMatch(context, /SECRET|image/);
});
