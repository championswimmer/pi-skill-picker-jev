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
    const answers = Object.fromEntries(Object.entries(body.questions).map(([id, q]: [string, any]) => [id, { noul: q.instructions.includes("review") ? 0.93 : 0.12 }]));
    return new Response(JSON.stringify({ model: "typesafe/jev-1.13-20260917", usage: {
      input_tokens: 100, output_tokens: 5, cost: 0.00003 }, answers }), { status: 200 });
  };
  const ranked = await rankSkills("Review my PR", [skill("review"), skill("docker"), skill("deploy")], [],
    { apiKey: "test", batchSize: 2, fetcher: fetcher as typeof fetch, onUsage: (usage) => usageCalls.push(usage) });
  assert.deepEqual(ranked.map(({ skill, probability }) => [skill.name, probability]), [["review", 0.93]]);
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

test("filters only Pi's loaded skills and adds newly relevant Pi skills", async () => {
  const oldKey = process.env.OPENROUTER_API_KEY;
  const oldFetch = globalThis.fetch;
  try {
    delete process.env.OPENROUTER_API_KEY;
    globalThis.fetch = (async (_url: unknown, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      const answers = Object.fromEntries(Object.entries(body.questions).map(([id, q]: [string, any]) => {
        const name = q.instructions.match(/Name: (\w+)/)?.[1];
        return [id, { noul: name === "external" || body.state.task.toLowerCase().includes(name) ? 0.97 : 0.02 }];
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
      { role: "assistant", content: [{ type: "text", text: "Now deploy the change" }] }] }, ctx);
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
