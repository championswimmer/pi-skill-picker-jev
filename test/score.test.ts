import assert from "node:assert/strict";
import { test } from "node:test";
import type { Skill } from "@earendil-works/pi-coding-agent";
import { rankSkills } from "../src/picker.ts";
import { DEFAULT_SETTINGS } from "../src/settings.ts";
import { ADDITION_ENTRY, formatHistorySkill, groupHistoryByTurn, restoreHistory } from "../src/history.ts";

const skill = (name: string): Skill => ({ name, description: name, filePath: `/skills/${name}/SKILL.md`, baseDir: `/skills/${name}`, disableModelInvocation: false,
  sourceInfo: { path: `/skills/${name}/SKILL.md`, source: "test", scope: "project", origin: "top-level", baseDir: `/skills/${name}` } });

test("Score normalizes levels, includes the default boundary, and ignores confidence", async () => {
  const answers = [
    { type: "score", score: 4, confidence: 0 },
    { type: "score", score: 2.5, confidence: 0.1 },
    { type: "score", score: 2.49999, confidence: 1 },
    { type: "score", score: 0 },
  ];
  const candidates = answers.map((_, i) => skill(`skill-${i}`));
  let request: any;
  const fetcher = (async (_url, init) => {
    request = JSON.parse(init!.body as string);
    return new Response(JSON.stringify({ answers: Object.fromEntries(answers.map((answer, i) => [`s${i}`, answer])) }));
  }) as typeof fetch;
  assert.equal(DEFAULT_SETTINGS.threshold, 0.625);
  const ranked = await rankSkills("task", candidates, [], { apiKey: "test", fetcher });
  assert.deepEqual(ranked.map((r) => r.score), [1, 0.625]);
  assert.equal(request.questions.s0.type, "score");
  assert.equal(request.questions.s0.criteria.length, 5);
  assert.match(request.questions.s0.criteria[0], /Unrelated/);
  assert.match(request.questions.s0.criteria[4], /Essential/);
  const all = await rankSkills("task", candidates, [], { apiKey: "test", fetcher, threshold: 0 });
  assert.equal(all.length, 4);
  assert.equal(all[3].score, 0);
  const savedCutoff = await rankSkills("task", candidates, [], { apiKey: "test", fetcher, threshold: 0.75 });
  assert.equal(savedCutoff.length, 1, "explicit/saved thresholds are not replaced by the new default");
});

test("Score fails closed for missing, malformed, out-of-range, and legacy Noul answers", async () => {
  const answers = [null, {}, { type: "score" }, { type: "score", score: "4" },
    { type: "score", score: -0.1 }, { type: "score", score: 4.1 }, { type: "noul", noul: 1 },
    { type: "noul", score: 4 }, { score: 4 }];
  const ranked = await rankSkills("task", answers.map((_, i) => skill(`${i}`)), [], {
    apiKey: "test", threshold: 0,
    fetcher: (async () => new Response(JSON.stringify({ answers: Object.fromEntries(answers.map((a, i) => [`s${i}`, a])) }))) as typeof fetch,
  });
  assert.deepEqual(ranked, []);
  for (const score of [NaN, Infinity, -Infinity]) {
    const result = await rankSkills("task", [skill("one")], [], { apiKey: "test", threshold: 0,
      fetcher: (async () => ({ ok: true, json: async () => ({ answers: { s0: { type: "score", score } } }) })) as unknown as typeof fetch });
    assert.deepEqual(result, []);
  }
});

test("Score history keeps its rating marker through restoration/grouping; legacy records remain probabilities", () => {
  const history = restoreHistory([
    { type: "custom", customType: ADDITION_ENTRY, data: { turn: 1, step: 1, threshold: 0.75, skills: [{ name: "old", score: 0.9 }] } },
    { type: "custom", customType: ADDITION_ENTRY, data: { turn: 1, step: 2, threshold: 0.625, scoreType: "score", skills: [{ name: "new", score: 0.8 }] } },
  ]);
  assert.equal(history.additions[0].scoreType, undefined);
  assert.equal(history.additions[1].scoreType, "score");
  assert.equal(groupHistoryByTurn(history.additions)[0].skills[1].scoreType, "score");
  const text = groupHistoryByTurn(history.additions)[0].skills.map((skill) => formatHistorySkill(1, skill)).join("\n");
  assert.match(text, /old \(Noul probability 0\.900/);
  assert.match(text, /new \(rating 0\.800/);
});
