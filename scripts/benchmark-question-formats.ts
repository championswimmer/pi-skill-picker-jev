// Research only: compares wire formats, without changing production selection.
// node --experimental-strip-types scripts/benchmark-question-formats.ts OUTPUT [SKILLS_DIR]
// BENCH_ROUNDS=20 BENCH_FORMATS=baseline,short-question,short-rubric,compact,shared-catalog,shared-rubric
// Optional BENCH_FIXTURES=path.json: [{id,task,required:[],forbidden:[],alreadyAvailable?:[]}].
// BENCH_REDACT=1 replaces skill names with stable corpus-index identifiers in output/logs.
// Sends bounded fixture tasks and skill metadata; never loads skill bodies into requests or real conversations.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { loadSkillsFromDir, ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { rankSkills } from "../src/picker.ts";

const [output, dir = "demo/.pi/skills"] = process.argv.slice(2);
if (!output) throw new Error("Usage: benchmark-question-formats.ts OUTPUT [SKILLS_DIR]");
const rounds = Number(process.env.BENCH_ROUNDS ?? 20);
if (!Number.isInteger(rounds) || rounds < 1 || rounds > 200) throw new Error("BENCH_ROUNDS must be 1–200");
const allFormats = ["baseline", "short-question", "short-rubric", "compact", "shared-catalog", "shared-rubric"];
const formats = (process.env.BENCH_FORMATS ?? allFormats.join(",")).split(",");
if (!formats.includes("baseline") || new Set(formats).size !== formats.length || formats.some(f => !allFormats.includes(f))) throw new Error("Invalid BENCH_FORMATS (must include baseline)");
const loaded = loadSkillsFromDir({ dir: resolve(dir), source: "benchmark" });
const seen = new Set<string>();
const skills = loaded.skills.filter(s => !s.disableModelInvocation && !seen.has(s.name) && !!seen.add(s.name)).sort((a, b) => a.name.localeCompare(b.name));
if (!skills.length) throw new Error("No invocable skills");
interface Fixture { id: string; task: string; required: string[]; forbidden: string[]; alreadyAvailable?: string[] }
const demoFixtures: Fixture[] = [
  { id: "price-tests", task: "Fix coupon rounding in the cart total and add regression tests for fractional prices. Do not change UI or API contracts.", required: ["pricing-rules", "storefront-tests"], forbidden: ["order-email", "shipping-policy", "tax-calculation"] },
  { id: "catalog-migration", task: "Rename the price field in data/products.json to unitPrice, safely migrate existing SKUs, and update the automated tests.", required: ["catalog-data", "catalog-migrations", "storefront-tests"], forbidden: ["shipping-policy", "order-email", "returns-policy"] },
  { id: "a11y-copy", task: "Fix keyboard access and screen-reader announcements in the cart UI, and rewrite the empty-cart message. No checkout business logic changes.", required: ["accessibility-review", "storefront-copy"], forbidden: ["tax-calculation", "catalog-migrations", "shipping-policy"] },
  { id: "incident", task: "Write a runbook to triage checkout outages using structured error logs and latency metrics, then describe recovery steps.", required: ["incident-response", "observability"], forbidden: ["returns-policy", "order-email", "storefront-copy"] },
  { id: "privacy-email", task: "Draft an order-confirmation email template and minimize the personal data retained in the order records.", required: ["order-email", "data-privacy"], forbidden: ["tax-calculation", "inventory-control", "performance-check"] },
  { id: "shipping-tax", task: "Implement location-based shipping fees and sales-tax calculation for checkout totals.", required: ["shipping-policy", "tax-calculation"], forbidden: ["order-email", "catalog-migrations", "returns-policy"] },
  { id: "stock-perf", task: "Optimize slow catalog lookups for a large inventory and add a low-stock reorder report.", required: ["performance-check", "inventory-control"], forbidden: ["order-email", "returns-policy", "tax-calculation"] },
  { id: "docs-release", task: "Write developer onboarding instructions and a release checklist including validation and rollback.", required: ["contributor-guide", "release-checklist"], forbidden: ["order-email", "shipping-policy", "tax-calculation"] },
  { id: "unrelated", task: "Explain the difference between a lunar eclipse and a solar eclipse. Do not modify or discuss the storefront.", required: [], forbidden: [] },
  { id: "followup", task: "user: Fix cart discounts.\nassistant: Pricing logic has been fixed and tested.\ntoolResult: All pricing tests pass.\nCurrent user request: Now only draft the returns and refunds policy; do not make further pricing changes.", alreadyAvailable: ["pricing-rules", "storefront-tests"], required: ["returns-policy"], forbidden: ["shipping-policy", "order-email", "tax-calculation"] },
];
const fixtures: Fixture[] = process.env.BENCH_FIXTURES ? JSON.parse(readFileSync(process.env.BENCH_FIXTURES, "utf8")) : demoFixtures;
if (!Array.isArray(fixtures) || !fixtures.length) throw new Error("No fixtures");
for (const f of fixtures) {
  if (!f.id || typeof f.task !== "string" || !f.task.trim() || !Array.isArray(f.required) || !Array.isArray(f.forbidden)) throw new Error("Invalid fixture");
  for (const name of [...f.required, ...f.forbidden, ...(f.alreadyAvailable ?? [])]) if (!seen.has(name)) throw new Error(`Unknown fixture skill: ${name}`);
}
const model = "typesafe/jev-1.13";
const endpoint = "https://openrouter.ai/api/alpha/decisions";
const apiKey = await new ModelRegistry(await ModelRuntime.create({ refreshOnCreate: false })).getApiKeyForProvider("openrouter");
if (!apiKey) throw new Error("Requires Pi OpenRouter authentication");
// Freeze the pre-optimization control now that production uses the short rubric.
const baselineRubric = [
  "Unrelated to the task; this skill would not help with any part of it.",
  "Shares the general topic but provides no actionable help for the requested work.",
  "Could provide optional supporting help, but is not directly needed to perform the task.",
  "Directly useful for performing a concrete part of the requested task.",
  "Essential to the central work explicitly requested in the task.",
];
const shortRubric = [
  "Unrelated; no help for this task.",
  "Related topic; no actionable help.",
  "Optional support; not directly needed.",
  "Directly useful for a concrete part of the task.",
  "Essential to the task's central work.",
];
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const samples: any[] = [];
const report: any = { version: 1, startedAt: new Date().toISOString(), node: process.version, model, endpoint,
  corpus: { count: skills.length, names: skills.map(s => s.name), metadataSha256: hash(skills.map(s => [s.name, s.description])), diagnostics: loaded.diagnostics.length },
  fixtures, formats, rounds, warmupRounds: 2, batchSize: 50, concurrency: 6, threshold: 0.625, maxNew: 6,
  baselineRubric, shortRubric, samples };
mkdirSync(dirname(output), { recursive: true });
const aliases = new Map(skills.map((s, i) => [s.name, `skill-${String(i).padStart(3, "0")}`]));
const redact = process.env.BENCH_REDACT === "1";
report.anonymizedSkillNames = redact;
const replacer = (_key: string, value: unknown) => redact && typeof value === "string" ? aliases.get(value) ?? value : value;
const save = () => writeFileSync(output, JSON.stringify(report, replacer, 2) + "\n");

async function baseline(f: Fixture): Promise<any[]> {
  const bodies: any[] = [];
  const available = skills.filter(s => f.alreadyAvailable?.includes(s.name));
  await rankSkills(f.task, skills.filter(s => !f.alreadyAvailable?.includes(s.name)), available, {
    apiKey: "capture-only", model,
    fetcher: (async (_url, init) => { bodies.push(JSON.parse(init!.body as string)); return new Response(JSON.stringify({ answers: {} })); }) as typeof fetch,
  });
  for (const body of bodies) {
    for (const question of Object.values(body.questions) as any[]) question.criteria = [...baselineRubric];
  }
  return bodies;
}
function transform(original: any, format: string) {
  const body = structuredClone(original);
  if (format === "shared-catalog") body.state.skills = {};
  if (format === "shared-rubric") body.state.usefulness_rubric = (Object.values(body.questions)[0] as any).criteria;
  for (const [id, q] of Object.entries(body.questions) as [string, any][]) {
    const prefix = "How useful would this skill be for the current task? Name: ";
    if (!q.instructions.startsWith(prefix)) throw new Error("Production question changed; review benchmark transformations");
    const metadata = q.instructions.slice(prefix.length);
    if (format === "short-question" || format === "compact") q.instructions = `Usefulness for state.task? ${metadata}`;
    if (format === "shared-catalog") {
      body.state.skills[id] = metadata;
      q.instructions = `How useful is state.skills.${id} for state.task?`;
    }
    if (["short-rubric", "compact", "shared-catalog"].includes(format)) q.criteria = shortRubric;
    if (format === "shared-rubric") {
      q.instructions += " Apply state.usefulness_rubric.";
      q.criteria = ["Unrelated", "Adjacent", "Supporting", "Directly useful", "Essential"];
    }
  }
  return body;
}
async function request(body: any, names: string[]) {
  const wire = JSON.stringify(body);
  const start = performance.now();
  const response = await fetch(endpoint, { method: "POST", redirect: "error", signal: AbortSignal.timeout(30_000),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}`, "User-Agent": "pi-coding-agent (pi-skill-picker-jev)", "X-Title": "Pi Coding Agent" }, body: wire });
  const headersMs = performance.now() - start;
  const text = await response.text();
  const elapsedMs = performance.now() - start;
  if (!response.ok) throw new Error(`HTTP ${response.status}`); // Do not log server text or secrets.
  const data = JSON.parse(text);
  const scores = Object.entries(body.questions).map(([id, q]: [string, any], i) => {
    const a = data.answers?.[id];
    if (a?.type !== "score" || !Number.isFinite(a.score) || a.score < 0 || a.score > q.criteria.length - 1) throw new Error(`Invalid score for ${id}`);
    return { name: names[i], score: a.score / (q.criteria.length - 1) };
  });
  const u = data.usage;
  return { elapsedMs, headersMs, status: response.status, requestBytes: Buffer.byteLength(wire), requestSha256: hash(body), responseBytes: Buffer.byteLength(text), servedModel: data.model,
    usage: u ? { input_tokens: u.input_tokens, output_tokens: u.output_tokens, cost: u.cost, input_tokens_details: u.input_tokens_details } : undefined, scores };
}
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = (xs: number[]) => { const s = [...xs].sort((a,b) => a-b); return (s[Math.floor((s.length - 1) / 2)] + s[Math.floor(s.length / 2)]) / 2; };
const p95 = (xs: number[]) => [...xs].sort((a,b) => a-b)[Math.ceil(xs.length * 0.95)-1];
try {
  for (let round = -2; round < rounds; round++) {
    const fixtureIndex = ((round % fixtures.length) + fixtures.length) % fixtures.length;
    const f = fixtures[fixtureIndex];
    const bodies = await baseline(f);
    const candidates = skills.filter(s => !f.alreadyAvailable?.includes(s.name));
    // Rotate within and across fixture cycles; reverse each cycle to limit order bias.
    const cycle = Math.floor(Math.max(0, round) / fixtures.length);
    const offset = (fixtureIndex + cycle) % formats.length;
    let order = [...formats.slice(offset), ...formats.slice(0, offset)];
    if (cycle % 2) order = order.reverse();
    for (const format of order) {
      const batches: any[] = new Array(bodies.length);
      let next = 0;
      const start = performance.now();
      await Promise.all(Array.from({ length: Math.min(6, bodies.length) }, async () => {
        while (next < bodies.length) {
          const i = next++;
          batches[i] = await request(transform(bodies[i], format), candidates.slice(i * 50, (i + 1) * 50).map(s => s.name));
        }
      }));
      const elapsedMs = performance.now() - start;
      const scores = batches.flatMap(b => b.scores);
      const eligible = scores.filter(s => s.score >= report.threshold).sort((a, b) => b.score - a.score);
      const selected = eligible.slice(0, report.maxNew).map(s => s.name);
      samples.push({ round, warmup: round < 0, fixture: f.id, format, elapsedMs, batches,
        eligible: eligible.map(s => s.name), selected, requiredHits: f.required.filter(n => selected.includes(n)),
        requiredMisses: f.required.filter(n => !selected.includes(n)), forbiddenHits: f.forbidden.filter(n => selected.includes(n)) });
      save();
      console.log(`round=${round} ${f.id} ${format}: ${elapsedMs.toFixed(1)}ms selected=${selected.map(n => redact ? aliases.get(n) : n).join(",")}`);
    }
  }
  report.summary = formats.map(format => {
    const rows = samples.filter(s => !s.warmup && s.format === format);
    const times = rows.map(s => s.elapsedMs);
    const deltas = rows.map(s => s.elapsedMs - samples.find(b => b.round === s.round && b.format === "baseline").elapsedMs);
    const batches = rows.flatMap(s => s.batches);
    return { format, n: rows.length, meanMs: mean(times), medianMs: median(times), p95Ms: p95(times), pairedMeanDeltaMs: mean(deltas), pairedMedianDeltaMs: median(deltas),
      meanRequestBytes: mean(rows.map(s => s.batches.reduce((n: number, b: any) => n + b.requestBytes, 0))),
      meanInputTokens: mean(rows.map(s => s.batches.reduce((n: number, b: any) => n + (b.usage?.input_tokens ?? NaN), 0))),
      meanOutputTokens: mean(rows.map(s => s.batches.reduce((n: number, b: any) => n + (b.usage?.output_tokens ?? NaN), 0))),
      measuredCost: batches.reduce((n, b) => n + (b.usage?.cost ?? 0), 0),
      requiredMisses: rows.reduce((n, s) => n + s.requiredMisses.length, 0), forbiddenHits: rows.reduce((n, s) => n + s.forbiddenHits.length, 0),
      selectionAgreement: mean(rows.map(s => JSON.stringify([...s.selected].sort()) === JSON.stringify([...samples.find(b => b.round === s.round && b.format === "baseline").selected].sort()) ? 1 : 0)),
    };
  });
  report.finishedAt = new Date().toISOString();
} catch (error) {
  report.failure = error instanceof Error ? error.message : "Benchmark failed";
  throw error;
} finally { save(); }
