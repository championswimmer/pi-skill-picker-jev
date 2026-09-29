# Jev question-format research

Date: 2026-09-29. The measurements below were collected before changing production.

**Adoption:** Following review, the short task rubric was promoted to production with the original question wording. Other rubrics, scoring, thresholds, and settings are unchanged; other question formats remain experimental. The benchmark now freezes the original full rubric as its control.

## Recommendation

**Shorten the five rubric descriptions, but keep the original question wording.** This is the best conservative candidate from these experiments, not yet a proven drop-in equivalent.

- Demo confirmation: **316 → 284 ms mean** (10% lower), **17% fewer input tokens**.
- Long demo histories: **325 → 274 ms mean** (16% lower), **10% fewer input tokens**.
- Railway catalog, 263 skills / six concurrent batches: **505.5 → 440.0 ms mean** (13% lower), **12% fewer input tokens**.
- No labeled required-skill misses or forbidden selections for the short rubric in any demo run. These are **partial labels on a small synthetic suite**, not evidence of general accuracy equivalence.
- Exact selected-set agreement with baseline: **80%** in short demo confirmation, **100%** with long demo histories, **89%** on the large catalog. Optional/borderline selections can still change.

**Sharing one rubric in `state` is a more aggressive alternative:** large-catalog mean **505.5 → 399.7 ms** (21% lower) and 21% fewer input tokens, but only **67%** exact selected-set agreement. It saved more tokens without consistently beating the short rubric on demo latency. Defer this until borderline ranking changes have been evaluated with human labels.

**Do not adopt the tested terse question.** `Usefulness for state.task? …` saved only 3.5% of input tokens by itself and missed `returns-policy` in both repeats of a follow-up task. Combining it with the shorter rubric had the same miss. This is a concrete reason not to optimize on tokens/latency alone.

Full numeric results, including p50/p95, paired bootstrap intervals, selection overlap, threshold crossings, and costs: [generated tables](question-format-results.md). Total: **692 successful HTTP calls**, **$0.184589** reported cost, including warmups.

## What changed in each format

Everything still uses the hosted OpenRouter Decisions endpoint and `typesafe/jev-1.13`, `type: "score"`, five criteria, normalized `score / 4`, cutoff 0.625, and a global top-six cap. No binary Noul substitution, confidence multiplication, skill-description truncation, or model swap.

At measurement time the baseline was captured directly from production `rankSkills` with a mock fetcher. The runner still captures task bounding, `already_available`, batch splitting, and skill metadata, but now restores the original full rubric as the baseline so adoption does not collapse the comparison. Each candidate body is a deep copy.

| Format | Question | Criteria / state |
|---|---|---|
| baseline | `How useful would this skill be for the current task? Name: … Description: …` | Original five full rubric descriptions |
| short-question | `Usefulness for state.task? … Description: …` | Original rubric |
| short-rubric | Original question | Five shorter descriptions below |
| compact | Short question | Short rubric |
| shared-catalog | `How useful is state.skills.skill_N for state.task?` | Skill metadata moved into `state.skills`; short rubric |
| shared-rubric | Original question + `Apply state.usefulness_rubric.` | Original full rubric stored once in state; question criteria are `Unrelated`, `Adjacent`, `Supporting`, `Directly useful`, `Essential` |

The proposed short rubric is:

```ts
[
  "Unrelated; no help for this task.",
  "Related topic; no actionable help.",
  "Optional support; not directly needed.",
  "Directly useful for a concrete part of the task.",
  "Essential to the task's central work.",
]
```

These remain distinct usefulness levels rather than yes/no relevance. However, compression removes some qualifications from the original text and can change calibration. Keeping the same cutoff is a controlled comparison, not a guarantee that its semantics are identical.

Moving the catalog into shared state did not provide a convincing advantage in the pilot: 12% fewer input tokens, but worse median latency than baseline and only 50% exact set agreement. It also makes each question depend on a reference lookup. Do not promote that variant on this evidence.

## Experimental sequence

1. **Demo pilot first:** the 20 skills in `demo/.pi/skills`, ten handcrafted tasks, two passes, five formats (20 measured selections per format). Included pricing/tests, migrations, accessibility/copy, incidents, privacy/email, shipping/tax, stock/performance, docs/release, an unrelated astronomy question, and a follow-up with already-selected skills.
2. **Demo confirmation:** same ten fixtures, five passes, baseline / short rubric / shared rubric (50 selections per format).
3. **Scale check only after the demo looked promising:** Pi's loader found 263 invocable unique skills in `~/Development/railwayapp/mono/.agents/skills`. Six generic tasks, three passes (18 selections per format); six concurrent batches of at most 50 questions, matching production limits. The metric is full-selection wall time, not the sum of batch times. Only names/descriptions were sent, not skill bodies. Saved skill names are anonymized; descriptions and local paths are not persisted in results.
4. **Long-history stress check:** four demo follow-ups, five passes (20 selections per format), with synthetic completed checkout work and repetitive test output preceding the current request. Tasks are 10,287–10,408 characters, within the production 12,000-character bound. Two skills are already available, leaving 18 candidates. This is intentionally synthetic context stress, not a real transcript benchmark.

Runs were sequential, not overlapping. Each run has two excluded warmup rounds per format; measured variant order rotates and reverses across fixture cycles. No automatic retries. HTTP redirect rejection and a 30-second timeout are retained. Successful responses must contain a valid score for every question.

The runner records request/body hashes, request/response sizes, header and full-response timing, returned scores, eligible/selected sets, and reported usage. API keys come from Pi's provider auth; no credentials are written to artifacts. Research calls do not emit production session usage entries.

## Quality and latency interpretation

- The ten short demo fixtures have 18 required and 27 forbidden checks per pass. The long fixtures have five required and nine forbidden checks per pass. These labels were specified before those runs; they deliberately leave plausible supporting skills unlabeled. Exact agreement with baseline is **not** a correctness measure.
- The terse question's two pilot misses are both the follow-up fixture: the request asks for returns/refunds after pricing work is complete. The original wording and short rubric retain `returns-policy`.
- Short/shared rubrics both pass all demo required/forbidden checks, but choose different optional skills. Large-catalog tasks have **no manually labeled gold selections**. Their `0/0` checks must not be reported as perfect recall/precision. All three formats selected nothing for the unrelated large-catalog task.
- Reported output tokens are identical across formats within each run. These experiments reduce input work; they do not produce a shorter response. Request-byte reductions are larger than token reductions and should not be substituted for them.
- Hosted timing includes networking, service queues, and response handling. In the 50-round confirmation, the short-rubric paired mean delta is −32 ms, but the round-bootstrap 95% interval **[−70.52, +5.90] ms crosses zero**. Do not promise a universal 10% speedup. Median improvement is about 16 ms.
- The large-catalog short-rubric delta is −65.5 ms, round CI **[−115.20, −16.56] ms**; shared-rubric delta is −105.8 ms, CI **[−147.91, −61.45] ms**. Both show a clearer improvement in this run. The fixtures are few, and repeated requests are not new independent quality examples.
- CIs are seeded percentile bootstraps of paired rounds; a separate interval resamples per-fixture mean deltas. Neither establishes accuracy equivalence or covers provider conditions on other days. Pilot outliers particularly distort means.
- Identical payloads repeat naturally. We did not inject nonce text or disable provider caching, so this is a repeated-session workload, not a guaranteed cold-cache inference benchmark. Token usage alone does not identify server internals.
- This research covers **task usefulness only**, not topic relevance, global-importance scoring, local Kev models, endpoint changes, or batch-size tuning.

## Reproduce

Node 22+, installed dependencies, Python 3, and Pi OpenRouter authentication are required. These commands make paid network requests and send the specified skill metadata to OpenRouter. The Railway command needs that local checkout; the saved metadata fingerprint documents the inventory used here.

```bash
# Pilot (explicit list: the runner now also knows about shared-rubric)
BENCH_ROUNDS=20 \
BENCH_FORMATS=baseline,short-question,short-rubric,compact,shared-catalog \
node --experimental-strip-types scripts/benchmark-question-formats.ts \
  /tmp/question-format-demo-pilot.json

BENCH_ROUNDS=50 BENCH_FORMATS=baseline,short-rubric,shared-rubric \
node --experimental-strip-types scripts/benchmark-question-formats.ts \
  /tmp/question-format-demo-confirm.json

BENCH_ROUNDS=20 BENCH_FORMATS=baseline,short-rubric,shared-rubric \
BENCH_FIXTURES=.agents/plans/question-format-long-fixtures.json \
node --experimental-strip-types scripts/benchmark-question-formats.ts \
  /tmp/question-format-demo-long.json

BENCH_ROUNDS=18 BENCH_FORMATS=baseline,short-rubric,shared-rubric \
BENCH_REDACT=1 BENCH_FIXTURES=.agents/plans/question-format-large-fixtures.json \
node --experimental-strip-types scripts/benchmark-question-formats.ts \
  /tmp/question-format-large.json \
  ~/Development/railwayapp/mono/.agents/skills

python3 scripts/analyze-question-formats.py --markdown \
  /tmp/question-format-demo-pilot.json /tmp/question-format-demo-confirm.json \
  /tmp/question-format-demo-long.json /tmp/question-format-large.json
```

Tracked raw measurements use the same basenames under `.agents/plans/`; `question-format-analysis.json` holds derived machine-readable statistics. The TS runner captures production request construction but freezes the pre-optimization full task rubric as its baseline. Future changes to other production request fields still affect its baseline. Review transformations if the baseline question changes (the runner rejects an unexpected prefix).

## Follow-up after adoption

Only the short task rubric was adopted. Continue reviewing changed optional selections, add more human-labeled borderline/follow-up tasks, and repeat hosted measurements on another occasion. Preserve the current question, five levels, privacy boundaries, and fail-closed behavior. Keep the shared-rubric optimization experimental until its larger top-six ranking drift is understood.
