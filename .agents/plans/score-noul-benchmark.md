# Score versus Noul latency: Kev 4B, Kev 9B, and hosted Jev

Measured 2026-09-28. This report accompanies the switch to rubric-based Score selection and the new default normalized threshold of 0.625. See [semantic research](../../docs/scoring-research.md) for why Score is a better fit for graded usefulness; speed and semantics are separate decisions.

## Summary

- **Local Kev pays a measurable Score overhead**: approximately **28–43%** higher mean request latency with the production five-level rubric versus binary Noul.
- At the production batch size of 50, Score costs an extra **0.91 s on 4B** and **1.87 s on 9B** per serial request in this setup.
- **Hosted Jev is much less affected in absolute latency**: about **27 ms** additional mean latency for six candidates. At 50 candidates, Score's median is ~27 ms slower, but its mean is lower because one Noul request took ~1.07 s. Do **not** interpret this as evidence that Score makes Jev faster.
- All **168 HTTP requests succeeded** with valid typed answers: 56 per model, including warmups. Both Kev servers were stopped afterward; ports 8008/8009 and model processes were checked clear.

## Method

Runnable implementation: [`scripts/benchmark-decisions.ts`](../../scripts/benchmark-decisions.ts).

- **Models/endpoints:** local `kev-latest` alias served from the separate `kev-4b` and `kev-9b` checkpoints using the existing `../kev-local` scripts, and `typesafe/jev-1.13` through OpenRouter `/api/alpha/decisions`.
- **Hardware:** local AMD Strix Halo setup documented in `../kev-local` (same ROCm/PyTorch configuration; one loaded model at a time). Hosted hardware/provider scheduling is not controlled.
- **Payload:** synthetic tasks and skill descriptions only; no user conversation, filesystem content, or secrets. Six topic templates, 6 or 50 candidates per request. Larger batches repeat topical families with uniquely named synthetic modules, not a diverse real-world catalog.
- **Score:** captures the exact production task-selection payload from `rankSkills`, with its descriptive five-level rubric. **Noul:** same state/candidates, binary usefulness wording and the previous true/false criteria. Score's longer rubric is intentionally included: this measures actual proposed request cost, not a token-length-controlled primitive microbenchmark.
- **Sampling:** two warmup pairs per batch size excluded from statistics; 12 measured pairs per size/model. Order alternates Noul→Score and Score→Noul. Each pair has identical state/candidates. Task/scenario varies across pairs. Execution is serial (concurrency 1), with no application retries. Each type has 12 measurements per table row.
- **Timer:** monotonic wall-clock around `fetch` through complete JSON parsing. Includes HTTP/network, queueing, inference, response transfer/parsing; excludes model startup, credential lookup, and payload construction. Answer validation occurs after timing. This is not GPU kernel time or time-to-first-token.
- **Stats:** arithmetic mean, nearest-rank median/p95, and paired mean Score−Noul delta. With only 12 observations, nearest-rank p95 is the maximum: tail estimates are very noisy. Raw samples preserve timing, byte counts, HTTP status, served model, and reported token/cost usage.

## Results (milliseconds)

| Model | Candidates | Noul mean | Score mean | Noul median | Score median | Noul p95 | Score p95 | Mean ratio Score/Noul | Paired mean delta |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Kev 4B | 6 | 340.8 | 437.7 | 303.6 | 404.4 | 403.7 | 482.7 | 1.284× | +96.9 |
| Kev 4B | 50 | 2635.2 | 3544.3 | 2601.0 | 3521.2 | 2685.9 | 3588.5 | 1.345× | +909.1 |
| Kev 9B | 6 | 637.0 | 881.1 | 563.5 | 810.3 | 719.4 | 963.7 | 1.383× | +244.1 |
| Kev 9B | 50 | 4355.7 | 6229.2 | 4288.3 | 6161.6 | 4442.6 | 6313.2 | 1.430× | +1873.4 |
| Jev 1.13 / OpenRouter | 6 | 237.3 | 264.7 | 230.9 | 261.4 | 265.5 | 312.6 | 1.115× | +27.4 |
| Jev 1.13 / OpenRouter | 50 | 337.2 | 320.6 | 271.0 | 297.6 | 1071.9 | 489.0 | 0.951× | −16.6 |

Raw records, including full per-type summaries and paired median deltas:

- [Kev 4B](score-noul-kev-4b.json), 20:24:20–20:25:58 UTC
- [Kev 9B](score-noul-kev-9b.json), 20:26:46–20:29:35 UTC
- [Jev 1.13](score-noul-jev.json), 20:23:00–20:23:17 UTC

Hosted usage reported **$0.008408904** total for the 56 benchmark requests, including warmups. Local API-reported cost is zero; that is not a claim that electricity/hardware are free. Benchmark calls are separate from Pi session-usage reporting and their cost is captured here, not appended as normal skill-selection usage.

## Interpretation and limitations

The semantic change has a real local latency cost, especially on 9B and full 50-question batches. The five-level rubric is substantially longer than two short binary criteria, and Score returns more fields. This benchmark cannot isolate how much overhead comes from input length, primitive/model internals, or response size. No artificial equal-length padding or cache disabling was applied.

Counterbalancing reduces systematic order bias but does not eliminate provider/prefix caches, warmed connections, local scheduling, or hosted network noise. The hosted means are particularly sensitive to a single Noul outlier. This is one machine and one short measurement window, not a universal model comparison or statistically robust tail benchmark. Local and hosted times are not apples-to-apples hardware measurements.

The production picker can send six batches concurrently. These measurements use one request at a time; they do **not** predict whole-turn latency for hundreds of skills or concurrent GPU contention. They also do not measure accuracy, context bloat, or downstream task quality. The threshold influences which returned ratings pass, not how many candidate questions are sent, so changing it does not by itself reduce inference latency for the same inventory.

**Decision:** retain Score for graded usefulness as requested. Keep `maxNew` to bound added context, prefer 4B over 9B when local latency matters, and use Prompt only mode to reduce request frequency. Tune the cutoff based on desired breadth rather than treating 0.625 as a probability. A shorter equally clear rubric, different batch sizing, and repeated/cold-cache/parallel trials are possible future experiments, not validated improvements here.

## Reproduce

Hosted Jev uses Pi's provider authentication (including its environment-backed OpenRouter credentials); it never prints the key:

```bash
node --experimental-strip-types scripts/benchmark-decisions.ts \
  jev-1.13 /tmp/score-noul-jev.json
```

Run the local block in its own shell. Check ownership and always clean up:

```bash
set -e
CTL=../kev-local/scripts/kev_ctl.sh
SIZE=4b                              # repeat with 9b
if "$CTL" "$SIZE" status; then
  echo 'Already running; do not stop a server owned by another session' >&2
  exit 1
fi
trap '"$CTL" "$SIZE" stop' EXIT
PORT=$(KEV_API_KEY=benchmark-local-only "$CTL" "$SIZE" start)
BENCH_API_TOKEN=benchmark-local-only \
node --experimental-strip-types scripts/benchmark-decisions.ts \
  "kev-$SIZE" "/tmp/score-noul-kev-$SIZE.json" "http://127.0.0.1:$PORT"
```

Default `BENCH_ROUNDS=12`; increase for a longer trial (2–100 supported). Server-token variables can both be omitted for unauthenticated local serving. The capture-only fetch used to build payloads makes no network requests; all timed calls use the real endpoint. Custom benchmark endpoints must be loopback. Output is saved after each request, including failures, so an incomplete report must not be mistaken for a completed run (check `summary`/`finishedAt`).
