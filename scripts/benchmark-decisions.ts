// Synthetic, serial paired benchmark. Never prints credentials or reads conversations.
// node --experimental-strip-types scripts/benchmark-decisions.ts LABEL OUTPUT [BASE_URL]
// Without BASE_URL, uses hosted Jev and Pi's OpenRouter authentication.
import { performance } from "node:perf_hooks";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { rankSkills } from "../src/picker.ts";
import type { Skill } from "@earendil-works/pi-coding-agent";

const [label, output, base] = process.argv.slice(2);
if (!label || !output) throw new Error("Usage: benchmark-decisions.ts LABEL OUTPUT [BASE_URL]");
if (base && !["localhost", "127.0.0.1", "[::1]"].includes(new URL(base).hostname)) throw new Error("Custom benchmark endpoints must be loopback");
const apiKey = base ? (process.env.BENCH_API_TOKEN ?? "") : await new ModelRegistry(await ModelRuntime.create({ refreshOnCreate: false })).getApiKeyForProvider("openrouter");
if (!base && !apiKey) throw new Error("Jev benchmark requires Pi OpenRouter authentication");
const endpoint = base ? `${base.replace(/\/$/, "")}/v1/systemone` : "https://openrouter.ai/api/alpha/decisions";
const model = base ? "kev-latest" : "typesafe/jev-1.13";
const rounds = Number(process.env.BENCH_ROUNDS ?? 12);
if (!Number.isInteger(rounds) || rounds < 2 || rounds > 100) throw new Error("BENCH_ROUNDS must be 2–100");
const topics = [
  ["postgres", "PostgreSQL migrations, indexes and query performance"],
  ["react", "React components, accessibility and keyboard navigation"],
  ["kubernetes", "Kubernetes deployments, readiness probes and Helm charts"],
  ["pytest", "Python pytest fixtures, unit testing and mocks"],
  ["security", "Code audits for SQL injection, XSS and authentication flaws"],
  ["copywriting", "Marketing slogans, product taglines and brand voice"],
];
const tasks = ["Add a PostgreSQL index to speed up customer order queries.", "Fix keyboard navigation in a React signup form.",
  "Deploy a service to Kubernetes with Helm and readiness probes.", "Write pytest fixtures for a Python parser.",
  "Audit a login form for XSS and SQL injection.", "Write a product tagline for a travel app."];
const samples: any[] = [];
const report: any = { label, model, endpoint, startedAt: new Date().toISOString(), node: process.version,
  rounds, warmupPairs: 2, batchSizes: [6, 50], concurrency: 1, samples };
mkdirSync(dirname(output), { recursive: true });
const save = () => writeFileSync(output, JSON.stringify(report, null, 2) + "\n");

async function payload(size: number, round: number) {
  const candidates: Skill[] = Array.from({ length: size }, (_, i) => {
    const [name, description] = topics[i % topics.length];
    const path = `/synthetic/${name}-${i}`;
    return { name: `${name}-${i}`, description: `${description}. Synthetic module ${i}.`, filePath: `${path}/SKILL.md`, baseDir: path, disableModelInvocation: false,
      sourceInfo: { path, source: "test", scope: "project", origin: "top-level", baseDir: path } };
  });
  let body: any;
  await rankSkills(`${tasks[(round + 2) % tasks.length]} Synthetic scenario ${round + 2}.`, candidates, [], {
    apiKey: "capture-only", model, threshold: 0,
    fetcher: (async (_url, init) => { body = JSON.parse(init!.body as string); return new Response(JSON.stringify({ answers: {} })); }) as typeof fetch,
  });
  return body;
}

try {
  for (const size of report.batchSizes) {
    for (let round = -2; round < rounds; round++) {
      const scoreBody = await payload(size, round);
      const noulBody = { ...scoreBody, questions: Object.fromEntries(Object.entries(scoreBody.questions).map(([id, q]: [string, any]) => [id, {
        type: "noul", instructions: q.instructions.replace("How useful would this skill be", "Would this skill be directly useful"),
        criteria: { true: "Directly useful for this task; include its description in the agent context.", false: "Not needed now; omit it from the agent context." },
      }])) };
      // Counterbalance first/second order to reduce warmup/cache/order bias.
      for (const type of round % 2 === 0 ? ["noul", "score"] : ["score", "noul"]) {
        const body = JSON.stringify(type === "score" ? scoreBody : noulBody);
        const start = performance.now();
        const response = await fetch(endpoint, { method: "POST", redirect: "error", signal: AbortSignal.timeout(90_000),
          headers: { "Content-Type": "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) }, body });
        const data: any = await response.json();
        const elapsedMs = performance.now() - start;
        const sample: any = { size, round, warmup: round < 0, type, elapsedMs, status: response.status,
          requestBytes: Buffer.byteLength(body), responseBytes: Buffer.byteLength(JSON.stringify(data)), servedModel: data.model,
          usage: data.usage ? { input_tokens: data.usage.input_tokens, output_tokens: data.usage.output_tokens, cost: data.usage.cost,
            input_tokens_details: data.usage.input_tokens_details } : undefined };
        samples.push(sample);
        save();
        if (!response.ok) throw new Error(`${label} ${type} returned HTTP ${response.status}`);
        for (const id of Object.keys(scoreBody.questions)) {
          const a = data.answers?.[id];
          const value = type === "score" ? a?.score : a?.noul;
          if (a?.type !== type || !Number.isFinite(value) || value < 0 || value > (type === "score" ? 4 : 1)) throw new Error(`Invalid ${type} answer for ${id}`);
        }
        console.log(`${label} batch=${size} round=${round} ${type}: ${elapsedMs.toFixed(1)} ms`);
      }
    }
  }
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const quantile = (xs: number[], q: number) => [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * q) - 1];
  report.summary = report.batchSizes.map((size: number) => {
    const measured = samples.filter((s) => s.size === size && !s.warmup);
    const stats = (type: string) => {
      const xs = measured.filter((s) => s.type === type).map((s) => s.elapsedMs);
      return { n: xs.length, meanMs: mean(xs), medianMs: quantile(xs, 0.5), p95Ms: quantile(xs, 0.95), minMs: Math.min(...xs), maxMs: Math.max(...xs) };
    };
    const deltas = Array.from({ length: rounds }, (_, round) => measured.find((s) => s.round === round && s.type === "score").elapsedMs - measured.find((s) => s.round === round && s.type === "noul").elapsedMs);
    const noul = stats("noul"), score = stats("score");
    return { size, noul, score, scoreToNoulMeanRatio: score.meanMs / noul.meanMs, pairedMeanDeltaMs: mean(deltas), pairedMedianDeltaMs: quantile(deltas, 0.5) };
  });
  report.finishedAt = new Date().toISOString();
} finally { save(); }
