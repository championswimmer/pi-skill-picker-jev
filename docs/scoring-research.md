# Score selection, Noul comparison, and local Kev validation

## Decision: use Score to measure usefulness

On rechecking the [TypeSafe Score docs](https://docs.typesafe.ai/primitives/score), a graded **how useful is this skill?** question is a better match for the product's goal than a strict yes/no admission decision. The docs recommend Score for a “spectrum with a clear rubric,” Noul for yes/no, and caution against vague/overlapping levels or mixing dimensions.

The earlier recommendation to retain Noul assumed a precision-first binary gate and treated extra selections as failures. That was an unnecessarily strict objective: useful supporting skills are acceptable here, and `maxNew` separately limits added context. Score measures *degree of usefulness*, whereas Noul measures *probability of the yes proposition*. Neither is inherently a universally better ranker. The [re-ranking cookbook](https://docs.typesafe.ai/cookbooks/rerank_typesafe) uses Noul, which remains valid for a binary relevance formulation; it does not require Noul for all ranking.

References: [Noul](https://docs.typesafe.ai/primitives/noul), [Score](https://docs.typesafe.ai/primitives/score), [JavaScript SDK](https://docs.typesafe.ai/sdk/javascript), [SDK v0.6.0 types](https://github.com/typesafe-ai/typesafe-sdk-js/blob/v0.6.0/src/types.ts), and [SDK client](https://github.com/typesafe-ai/typesafe-sdk-js/blob/v0.6.0/src/client.ts).

| | Noul | Score |
| --- | --- | --- |
| Meaning | Probability the yes/no proposition is true | Expected rating on an ordered rubric |
| Criteria | `{ true, false }` | Ordered descriptions, lowest first, at least two levels |
| Output | `noul` in [0,1] | `score` in [0,K−1], level `probabilities`, and `confidence` |
| Aggregation | Probability of inclusion | Probability-weighted mean: Σ i·P(level=i) |

Score's confidence measures distribution concentration, not usefulness or correctness. We do **not** multiply by it. Different level distributions can produce the same expected rating. A normalized Score is not a probability and does not magically inherit Noul calibration.

## Implemented rubric and threshold

Production task selection now asks Score with five independently described levels:

0. Unrelated; no help with the task.
1. Topically adjacent but no actionable help.
2. Optional supporting help, not directly needed.
3. Directly useful for a concrete part of the task.
4. Essential to the central requested work.

Topic search and global importance use separate five-level rubrics for their respective dimensions. `rankSkills` divides the returned score by `(criteria.length - 1)`, sorts descending, applies the normalized threshold, then caps new skills. Only finite, in-range answers explicitly typed `score` are accepted; missing/invalid/legacy Noul answers cannot expose skills.

The new default is **0.625**, corresponding to raw **2.5**, halfway between optional support and directly useful. This is a transparent rubric-derived starting point, **not an empirically optimized threshold**. Raise it to 0.75 for a directly-useful-or-better expected rating; lower it to 0.5 to admit optional support. A score can be fractional because it is an expectation.

Valid saved thresholds are preserved, not silently overwritten. Existing users wanting the new default should set `/skill-picker settings` → Threshold to `0.625`. Old history entries remain labeled **Noul probability**. New entries persist `scoreType: "score"` and display **rating**, so historical numbers are not retroactively reinterpreted.

## Validation and initial comparison

The initial six-task comparison used six synthetic candidate descriptions: four clear single-skill tasks, one overlapping security task, and one no-op. Both primitives ranked the obvious matches first (4/4 for each of Kev 4B and 9B). At the old 0.75 cutoff, normalized Score admitted eight additional candidates on 9B across the clear tasks/no-op; Noul did not. That demonstrates different selection behavior, not that the supporting skills are necessarily harmful. This tiny fixture set does not establish general accuracy or calibrate either model.

After switching production to Score, the complete suite passed against **Kev 4B without auth** and **Kev 9B with token authentication** (51 tests each). Checks include actual extension/settings wiring, sorted ratings, batching, threshold/maxNew, global/topic rubrics, preservation of non-skill prompt metadata, failed-auth behavior, and no OpenRouter credential fallback. Unit tests cover boundary ratings, malformed results, legacy history, and saved thresholds. Both local servers were stopped afterward.

For speed, use the separate **[paired benchmark report](../.agents/plans/score-noul-benchmark.md)**, not the initial one-shot comparison. It includes hosted Jev, both local Kev models, realistic 50-candidate batches, warmups, counterbalanced request order, raw samples, and limitations.

## Endpoint/auth compatibility

TypeSafe and Kev use `POST /v1/systemone` with `model`, `state`, and `questions`. OpenRouter uses `/api/alpha/decisions` with the same question shape. Native fetch is retained without adding an SDK dependency.

Settings `apiBaseUrl`, `apiToken`, and `model` select the server. An explicit token overrides Pi's OpenRouter authentication (including its environment-backed key). Custom endpoints never inherit that key; blank token permits unauthenticated local serving. Endpoint changes clear tokens in the settings UI. Invalid persisted URLs fail closed; redirects are rejected. Tokens are saved only in the mode-0600 agent settings file, not sessions/history/usage.

## Reproduce local integration

```bash
npm run typecheck
npm test
```

In a separate shell (so the cleanup trap fires), run one model at a time:

```bash
set -e
CTL=../kev-local/scripts/kev_ctl.sh
SIZE=4b                              # repeat with 9b
if "$CTL" "$SIZE" status; then
  echo "Already running; stop your own server first" >&2
  exit 1
fi
trap '"$CTL" "$SIZE" stop' EXIT
PORT=$(KEV_API_KEY=kev-picker-integration-only "$CTL" "$SIZE" start)
KEV_TEST_BASE_URL="http://127.0.0.1:$PORT" \
KEV_TEST_API_TOKEN=kev-picker-integration-only \
KEV_TEST_SIZE="kev-$SIZE" \
KEV_TEST_REPORT="/tmp/kev-$SIZE-picker-report.json" npm test
```

Omit both token variables for an unauthenticated server. The live test sends only synthetic tasks and skill descriptions; optional reports contain per-skill Noul/normalized Score values and timings. Other tests intentionally retain fake fetchers for deterministic error/deadline/boundary coverage; not every unit test calls the real model.
