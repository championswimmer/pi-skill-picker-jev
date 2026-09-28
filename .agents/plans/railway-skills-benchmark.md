# Railway skill inventory: Noul versus Score benchmark

Measured **2026-09-28** against hosted **Jev 1.13**, local **Kev 4B**, and local **Kev 9B**. This repeats the [synthetic benchmark](score-noul-benchmark.md) with the actual skill inventory from `Development/railwayapp/mono`, and adds a full-catalog workload.

## Summary

Using all **263 unique, model-invocable skills**, in six concurrent batches:

| Model | Noul mean wall time | Score mean wall time | Score overhead |
| --- | ---: | ---: | ---: |
| Jev 1.13 / OpenRouter | **0.361 s** | **0.525 s** | **45.4%** |
| Kev 4B / local | **42.419 s** | **50.203 s** | **18.4%** |
| Kev 9B / local | **70.875 s** | **82.382 s** | **16.2%** |

**Important:** these are completed measurements using a **120-second per-request measurement timeout**, not successful production picker timings. With the extension's current **30-second per-batch timeout**, the concurrent full-catalog local workload exceeds its deadline: **20 of 24 measured batches per primitive** exceeded 30 seconds on **each Kev model**. None exceeded it on Jev. The current production fail-closed behavior would prevent using those late results; simply switching to local Kev is not sufficient for this inventory at the present concurrency/deadline settings.

Single 50-candidate requests stayed below 30 seconds on both local models. Their much longer full-catalog times indicate substantial queueing/contention when six batches target one local model. Benchmark success under the longer timeout must not be confused with production readiness.

## Inventory and privacy

- Canonical inventory: the source project's `.agents/skills`, loaded directly with Pi's `loadSkillsFromDir`.
- `.claude/skills` is a symlink to that inventory. The five `.cursor/skills` entries have identical names/descriptions to entries already present, so neither source adds candidates.
- **263 eligible skills**; no loader diagnostics, disabled skills, duplicate canonical names, or out-of-project targets.
- Description lengths: **25–1,021 characters**, mean **394.74**. None hit the production 1,200-character description truncation limit.
- Loaded skills stayed in memory. Only names/descriptions were included in model questions; full skill bodies, references, instructions from skill bodies, and skill file paths were not sent. Hosted Jev received the names/descriptions as required for this benchmark.
- **No Railway skills were copied into this repository.** The temporary runner, logs, and incomplete trial remain outside the repo under `/tmp/railway-skill-benchmark/`.
- The three versioned JSON results contain only allowlisted aggregate fields, numeric samples, fixed model/workload labels, timestamps, and a single aggregate inventory SHA-256. They contain no skill names, descriptions, per-skill answers, prompts, tokens, or skill paths. The hash verifies identical metadata across models without listing it.
- Before export, a separate in-memory audit checked every JSON key and textual value against a whitelist, verified complete runs and identical inventory hashes, and rejected any exact skill name, description, or file path. The final Markdown was also checked for source skill names/descriptions/paths. Only this report and the three sanitized result files were added to the repo; no code or skill files changed.

## Methodology

### Questions and tasks

Score payloads are captured from the existing production `rankSkills` function without sending the capture request. They use the current five-level task-usefulness rubric and actual candidate metadata. Noul receives the same state/candidate sets, with the earlier binary usefulness question and true/false criteria. The longer Score rubric is intentionally part of the comparison; input token counts are **not** equalized.

Tasks remain the same six generic synthetic task templates used by the previous benchmark, with numbered scenarios. No real Railway conversations, tickets, code, or task text are used. This measures request latency on real skill metadata, **not relevance accuracy or task success**. The 0.625 Score threshold versus 0.75 Noul threshold does not affect which candidate questions are sent, and no selection-quality comparison is made.

### Candidate sampling

Sort unique candidate names by JavaScript codepoint comparison, then Fisher–Yates shuffle using seed **20260928** and the LCG `state = (1664525 * state + 1013904223) mod 2^32`. For each workload round, take a circular window starting at `(round + warmupPairs) * 23 mod 263`. Both primitives and all three models use identical windows and state.

| Workload | Candidates per run | HTTP requests per run | Concurrent requests | Excluded warmup pairs | Measured pairs | Distinct candidates in measured windows |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Serial small | 6 | 1 | 1 | 2 | 12 | 72 |
| Serial production-size batch | 50 | 1 | 1 | 2 | 12 | 263 |
| Full catalog | 263 | 6 (50, 50, 50, 50, 50, 13) | 6 | 1 | 4 | 263 |

A pair means one Noul run and one Score run. Order alternates Noul→Score and Score→Noul. All local measurements use the existing Strix Halo/ROCm setup in `../kev-local`, with one checkpoint loaded at a time. Hosted hardware and cache behavior are not controlled.

### Timing and accounting

- Batch timing uses a monotonic clock around HTTP fetch through full JSON parsing; typed answer validation follows that timer.
- Reported run wall time covers dispatch of all batches through completion/validation of all responses. For full-catalog runs, it is **not** the sum or average of six batch times.
- Payload construction, credential lookup, model startup, report writing, and warmups are excluded from measured summary statistics.
- No application retries. Each batch uses the 120-second measurement timeout, while separately recording whether it exceeded the production 30-second deadline.
- Means are arithmetic; medians and p95 use nearest rank. With only 12 serial observations or four full-catalog observations per primitive, **p95 is the maximum** and is not a reliable tail estimate.
- **116 valid HTTP requests per completed model run; 348 total**, including warmups. All completed-run responses had the expected primitive type and finite, in-range values for every requested question.

## Detailed latency results

All times are **seconds**, measured per run, with warmups excluded.

| Model | Workload | Noul mean | Score mean | Noul median | Score median | Noul p95 | Score p95 | Mean Score/Noul |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Jev 1.13 | 6 candidates, serial | 0.254 | 0.258 | 0.239 | 0.241 | 0.303 | 0.388 | 1.015× |
| Jev 1.13 | 50 candidates, serial | 0.274 | 0.381 | 0.272 | 0.328 | 0.303 | 0.648 | 1.390× |
| Jev 1.13 | 263 candidates, concurrent | 0.361 | 0.525 | 0.336 | 0.477 | 0.437 | 0.673 | 1.454× |
| Kev 4B | 6 candidates, serial | 0.895 | 1.091 | 0.822 | 1.071 | 1.215 | 1.336 | 1.218× |
| Kev 4B | 50 candidates, serial | 8.271 | 9.831 | 8.124 | 9.739 | 9.895 | 11.065 | 1.189× |
| Kev 4B | 263 candidates, concurrent | 42.419 | 50.203 | 41.690 | 50.303 | 43.422 | 51.162 | 1.184× |
| Kev 9B | 6 candidates, serial | 1.507 | 1.776 | 1.473 | 1.867 | 1.906 | 2.025 | 1.178× |
| Kev 9B | 50 candidates, serial | 13.432 | 15.800 | 13.841 | 16.074 | 14.973 | 16.988 | 1.176× |
| Kev 9B | 263 candidates, concurrent | 70.875 | 82.382 | 70.942 | 82.823 | 71.297 | 82.996 | 1.162× |

### Production-deadline observations

Counts below are measured HTTP batches exceeding 30 seconds; warmups excluded.

| Model | Serial workloads, Noul / Score | Full catalog, Noul / Score |
| --- | --- | --- |
| Jev 1.13 | 0 / 0 | 0 of 24 / 0 of 24 |
| Kev 4B | 0 / 0 | **20 of 24 / 20 of 24** |
| Kev 9B | 0 / 0 | **20 of 24 / 20 of 24** |

These are observations under a longer measurement deadline, not direct timeout/recovery tests of the extension. Potential mitigations—such as lower local concurrency, a larger deadline, or smaller inventories—need their own measurements. No production settings or implementation were changed by this benchmark.

## Comparison with the synthetic run

Real descriptions are substantially longer than the earlier synthetic ones. At 50 candidates, local mean request times grew roughly **2.5–3.1×** across model/primitive combinations relative to the earlier short-description benchmark. Score's *percentage* overhead narrowed locally, but its *absolute* overhead increased to approximately **1.56 s on 4B** and **2.37 s on 9B** per 50-candidate request.

Hosted Jev remained sub-second, but this rerun shows a clear Score overhead at 50 candidates (~**107 ms** mean, ~**56 ms** median). The previous synthetic run's apparent mean advantage for Score was driven by a Noul outlier; it should not be generalized. Different payload lengths, candidate windows, provider conditions, and cache behavior mean this is not a controlled measurement of description length alone.

## Raw results, cost, and cleanup

| Model | Result file | Completed UTC window |
| --- | --- | --- |
| Jev 1.13 | [railway-skills-jev.json](railway-skills-jev.json) | 20:48:35–20:48:56 |
| Kev 4B | [railway-skills-kev-4b.json](railway-skills-kev-4b.json) | 20:48:57–21:01:23 |
| Kev 9B | [railway-skills-kev-9b.json](railway-skills-kev-9b.json) | 21:09:47–21:30:09 |

Jev reported **$0.036026466** for all 116 requests, including warmups. Local API cost is reported as zero; hardware/electricity are not free. Benchmark usage is captured in these files rather than appended to normal Pi skill-selection usage logs.

The first combined local command hit its 1,200-second wrapper limit after the completed 4B run and partway through 9B. Cleanup stopped the model. The incomplete 9B trial (52 saved request samples, not included in the 348 completed-run total) was retained only in `/tmp` and **excluded from all reported statistics**. 9B was restarted and rerun from scratch with fresh warmups and a longer wrapper limit; the final results contain only that complete rerun.

Both local models were stopped after benchmarking, and their processes/listeners on ports 8008/8009 were verified absent. The benchmark runner and audit code were temporary external files, deliberately not added to this repo. Repeating this experiment requires access to the original skill inventory; the JSON's aggregate metadata hash, seed, sampling method, question construction, and workload configuration document the inputs without redistributing the skills.

## Limitations

This is one local machine, one measurement window, six synthetic task templates, 12 measured serial pairs and four full-catalog pairs per model. Provider/prefix caches, connection warming, scheduling, and network conditions were not disabled or isolated. Queueing contributes heavily to local concurrent measurements. Hosted and local hardware are not comparable. Longer Score prompts and richer responses confound any claim about the primitive alone. The results establish observed latency/timeout risk for this catalog, not generalized accuracy, calibrated relevance, statistical significance, or a validated concurrency optimization.
