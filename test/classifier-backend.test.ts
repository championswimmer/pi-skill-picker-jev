import assert from "node:assert/strict";
import { test } from "node:test";
import type { Skill } from "@earendil-works/pi-coding-agent";
import { rankSkillsWithClassifier } from "../src/classifier-backend.ts";

function skill(name: string, description = `${name} expertise`): Skill {
  return { name, description, filePath: `/skills/${name}/SKILL.md`, baseDir: `/skills/${name}`,
    disableModelInvocation: false, sourceInfo: { path: `/skills/${name}/SKILL.md`, source: "test", scope: "project", origin: "top-level", baseDir: `/skills/${name}` } };
}

test("Pi classifier backend reuses shared score semantics and maps Pi usage", async () => {
  const lookups: Array<[string, string, string]> = [];
  const calls: Array<{ model: unknown; context: any; options: { signal?: AbortSignal } }> = [];
  const usageCalls: any[] = [];
  const classifier = { provider: "typesafe", id: "jev-latest" };
  const ctx = { modelRegistry: {
    findOfType: (type: string, provider: string, modelId: string) => {
      lookups.push([type, provider, modelId]);
      return classifier as any;
    },
    classify: async (model: unknown, context: any, options: { signal?: AbortSignal }) => {
      calls.push({ model, context, options });
      return {
        stopReason: "stop",
        answers: {
          s0: { type: "score", score: 3.72 },
          s1: { type: "score", score: 2.5 },
        },
        usage: { input: 12, output: 4, totalTokens: 16, cost: { total: 0.0012 } },
      };
    },
  } };
  const ranked = await rankSkillsWithClassifier(ctx as any, "Review my PR", [skill("review"), skill("docker")], [skill("existing")], {
    onUsage: (usage) => usageCalls.push(usage),
  });
  assert.deepEqual(lookups, [["classifier", "typesafe", "jev-latest"]]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, classifier);
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  assert.equal(calls[0].options.signal.aborted, false);
  assert.deepEqual(calls[0].context.state, {
    task: "Review my PR",
    already_available: "existing: existing expertise",
  });
  assert.equal(calls[0].context.questions.s0.type, "score");
  assert.equal(calls[0].context.questions.s0.instructions,
    "How useful would this skill be for the current task? Name: review. Description: review expertise");
  assert.deepEqual(calls[0].context.questions.s0.criteria, [
    "Unrelated; no help for this task.",
    "Related topic; no actionable help.",
    "Optional support; not directly needed.",
    "Directly useful for a concrete part of the task.",
    "Essential to the task's central work.",
  ]);
  assert.deepEqual(ranked.map(({ skill, score }) => [skill.name, score]), [["review", 0.93], ["docker", 0.625]]);
  assert.deepEqual(usageCalls, [{ model: "typesafe/jev-latest", input: 12, output: 4, cost: 0.0012 }]);
});

test("Pi classifier backend resolves model defaults and explicit provider/model ids", async () => {
  const oldModel = process.env.PI_SKILL_PICKER_MODEL;
  try {
    const defaultLookups: Array<[string, string, string]> = [];
    await rankSkillsWithClassifier({ modelRegistry: {
      findOfType: (type: string, provider: string, modelId: string) => {
        defaultLookups.push([type, provider, modelId]);
        return { provider, id: modelId } as any;
      },
      classify: async () => ({ stopReason: "stop", answers: {} }),
    } } as any, "task", [skill("one")], [], { threshold: 0 });
    assert.deepEqual(defaultLookups, [["classifier", "typesafe", "jev-latest"]]);

    process.env.PI_SKILL_PICKER_MODEL = "acme/env-model";
    const envLookups: Array<[string, string, string]> = [];
    await rankSkillsWithClassifier({ modelRegistry: {
      findOfType: (type: string, provider: string, modelId: string) => {
        envLookups.push([type, provider, modelId]);
        return { provider, id: modelId } as any;
      },
      classify: async () => ({ stopReason: "stop", answers: {} }),
    } } as any, "task", [skill("one")], [], { threshold: 0 });
    assert.deepEqual(envLookups, [["classifier", "acme", "env-model"]]);

    const explicitLookups: Array<[string, string, string]> = [];
    await rankSkillsWithClassifier({ modelRegistry: {
      findOfType: (type: string, provider: string, modelId: string) => {
        explicitLookups.push([type, provider, modelId]);
        return { provider, id: modelId } as any;
      },
      classify: async () => ({ stopReason: "stop", answers: {} }),
    } } as any, "task", [skill("one")], [], { model: "custom/special-jev", threshold: 0 });
    assert.deepEqual(explicitLookups, [["classifier", "custom", "special-jev"]]);
  } finally {
    if (oldModel === undefined) delete process.env.PI_SKILL_PICKER_MODEL; else process.env.PI_SKILL_PICKER_MODEL = oldModel;
  }
});

test("Pi classifier backend fails closed for missing models, non-stop results, and cancellation", async () => {
  const classifier = { provider: "typesafe", id: "jev-latest" };
  await assert.rejects(
    rankSkillsWithClassifier({ modelRegistry: { findOfType: () => undefined } } as any, "task", [skill("one")], [], {}),
    /Pi classifier model not found: typesafe\/jev-latest/,
  );
  await assert.rejects(
    rankSkillsWithClassifier({ modelRegistry: {
      findOfType: () => classifier as any,
      classify: async () => ({ stopReason: "error", answers: {}, errorMessage: "classifier blew up" }),
    } } as any, "task", [skill("one")], [], {}),
    /classifier blew up/,
  );
  const controller = new AbortController();
  controller.abort(new Error("user cancelled"));
  await assert.rejects(
    rankSkillsWithClassifier({ modelRegistry: {
      findOfType: () => classifier as any,
      classify: async () => ({ stopReason: "aborted", answers: {}, errorMessage: "aborted" }),
    } } as any, "task", [skill("one")], [], { signal: controller.signal }),
    /user cancelled/,
  );
});
