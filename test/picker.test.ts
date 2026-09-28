import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverSkills, rankSkills, transcriptText, uniqueSkills, type Skill } from "../src/picker.ts";
import skillPicker, { renderSkills } from "../src/extension.ts";

function skill(name: string): Skill {
  return { name, description: `${name} expertise`, filePath: `/skills/${name}/SKILL.md`, baseDir: `/skills/${name}`,
    disableModelInvocation: false, sourceInfo: { path: `/skills/${name}/SKILL.md`, source: "test", scope: "project", origin: "top-level", baseDir: `/skills/${name}` } };
}

test("discovers only frontmatter; ignores dependencies, disabled and duplicate skills", () => {
  const root = mkdtempSync(join(tmpdir(), "jev-skills-"));
  try {
    for (const dir of ["real", "node_modules/fake", "another", "hidden"]) mkdirSync(join(root, dir), { recursive: true });
    writeFileSync(join(root, "real/SKILL.md"), "---\nname: review\ndescription: |\n  Reviews pull requests\n  and diffs.\n---\nHuge body");
    writeFileSync(join(root, "node_modules/fake/SKILL.md"), "---\nname: fake\ndescription: unwanted\n---");
    writeFileSync(join(root, "another/SKILL.md"), "---\nname: review\ndescription: Duplicate\n---");
    writeFileSync(join(root, "hidden/SKILL.md"), "---\nname: hidden\ndescription: Hidden\ndisable-model-invocation: true\n---");
    const found = discoverSkills(root);
    assert.equal(found.length, 3);
    assert.match(found.find((s) => s.description.startsWith("Reviews"))!.description, /and diffs/);
    assert.deepEqual(uniqueSkills(found).map((s) => s.name), ["review"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("Jev batches questions, selects only threshold matches and fails closed", async () => {
  const requested: string[] = [];
  const fetcher = async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    requested.push(...Object.values(body.questions).map((q: any) => q.instructions));
    const answers = Object.fromEntries(Object.entries(body.questions).map(([id, q]: [string, any]) => [id, { noul: q.instructions.includes("review") ? 0.93 : 0.12 }]));
    return new Response(JSON.stringify({ answers }), { status: 200 });
  };
  const ranked = await rankSkills("Review my PR", [skill("review"), skill("docker"), skill("deploy")], [], { apiKey: "test", batchSize: 2, fetcher: fetcher as typeof fetch });
  assert.deepEqual(ranked.map((s) => s.name), ["review"]);
  assert.equal(requested.length, 3);
  assert.deepEqual(await rankSkills("task", [skill("docker")], [], { apiKey: "" }), []);
  assert.match(renderSkills(ranked), /<name>review<\/name>/);
  assert.doesNotMatch(renderSkills(ranked), /docker/);
});

test("ranks initial prompt then adds newly needed skills before the next model request", async () => {
  const root = mkdtempSync(join(tmpdir(), "jev-extension-"));
  const oldRoot = process.env.PI_SKILL_PICKER_ROOT;
  const oldKey = process.env.OPENROUTER_API_KEY;
  const oldFetch = globalThis.fetch;
  try {
    process.env.PI_SKILL_PICKER_ROOT = root;
    process.env.OPENROUTER_API_KEY = "test";
    for (const name of ["review", "deploy", "irrelevant"]) {
      mkdirSync(join(root, name));
      writeFileSync(join(root, name, "SKILL.md"), `---\nname: ${name}\ndescription: ${name} expertise\n---\n`);
    }
    globalThis.fetch = (async (_url: unknown, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      const answers = Object.fromEntries(Object.entries(body.questions).map(([id, q]: [string, any]) => {
        const name = q.instructions.match(/Name: (\w+)/)?.[1];
        return [id, { noul: body.state.task.toLowerCase().includes(name) ? 0.97 : 0.02 }];
      }));
      return new Response(JSON.stringify({ answers }), { status: 200 });
    }) as typeof fetch;
    const handlers = new Map<string, Function>();
    skillPicker({ on: (name: string, handler: Function) => handlers.set(name, handler) } as any);
    await handlers.get("session_start")!();
    const event = { prompt: "Review this change", systemPromptOptions: { skills: [skill("legacy")] } };
    await handlers.get("before_agent_start")!(event, { cwd: root });
    assert.deepEqual(event.systemPromptOptions.skills.map((s) => s.name), ["review"]);
    const messages = [{ role: "system", content: "Pi", sections: { skills: "ALL SKILLS" } },
      { role: "user", content: [{ type: "text", text: "Review this change" }] }];
    assert.equal(await handlers.get("context_with_system")!({ messages }), undefined);
    const second = await handlers.get("context_with_system")!({ messages: [...messages,
      { role: "assistant", content: [{ type: "text", text: "Now deploy the change" }] }] });
    assert.deepEqual(second.messages.at(-1).role, "system");
    assert.match(second.messages.at(-1).sections.skills, /<name>deploy<\/name>/);
    assert.doesNotMatch(second.messages.at(-1).sections.skills, /irrelevant|legacy/);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldRoot === undefined) delete process.env.PI_SKILL_PICKER_ROOT; else process.env.PI_SKILL_PICKER_ROOT = oldRoot;
    if (oldKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = oldKey;
    rmSync(root, { recursive: true, force: true });
  }
});

test("transcript selection excludes system prompt and non-text blocks", () => {
  const context = transcriptText([{ role: "system", content: "SECRET" },
    { role: "assistant", content: [{ type: "text", text: "Start deploying" }, { type: "image", data: "image" }] }]);
  assert.match(context, /Start deploying/);
  assert.doesNotMatch(context, /SECRET|image/);
});
