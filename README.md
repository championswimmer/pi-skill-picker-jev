# pi-skill-picker-jev

A [Pi](https://github.com/badlogic/pi-mono) extension that uses OpenRouter's **Jev Decisions API** to keep unrelated skill titles and descriptions out of the model's context.

At the start of each user turn, the skills **Pi itself discovered for the current working directory/session** are filtered down to only those Jev selects for the user's request. Before subsequent model requests (including those after tools), Jev reviews the recent conversation and the unsent skills and can add newly relevant skills. Already selected skills remain available for the session. While Jev is deciding which skills to add, Pi shows “Picking Skills” in its built-in Working indicator. Before the first model turn starts, an animated row above the input fills in until that indicator is available. Both clear when the decision finishes or fails. The full `SKILL.md` body is **not** injected: as in Pi's normal skill workflow, the model uses `read` on a selected skill's path when needed.

## Setup

```bash
# Requires Pi 0.87.1+ and OpenRouter credentials in Pi (or OPENROUTER_API_KEY).
cd ~/Development/championswimmer/pi-skill-picker-jev
npm install
pi auth check --provider openrouter
pi install .
cd ~/Development/railwayapp/mono
pi
```

Alternatively, try it without installing:

```bash
cd /path/to/your/project
pi --extension /path/to/pi-skill-picker-jev/src/extension.ts
```

The extension **does not scan for skills** or accept a skill-root setting. Its only candidates are the skills Pi would normally list for the session, including skills it discovered for the directory from which you start Pi. If you want the skills from `mono`, start Pi inside `mono` (or configure those skills in Pi itself). Duplicate names and `disable-model-invocation: true` skills are excluded from Jev ranking.

> **Privacy:** Jev receives the user's request, a bounded window of recent user/assistant/tool text, the names of already selected skills, and the names/descriptions of candidate skills. Do not enable this extension for sensitive prompts or skill descriptions unless sending them to OpenRouter is acceptable.

## Configuration

Run **`/skill-picker settings`** in Pi to open a TUI menu. Choose a setting, enter a new value, and select **Done** when finished:

| TUI setting | Default | Range | Purpose |
| --- | --- | --- | --- |
| Threshold | `0.75` | 0–1 | Minimum Jev probability to include a skill. |
| Max new skills | `6` | 0–100 (whole number) | Maximum newly added skills per ranking pass. |

Changes take effect immediately and persist across Pi sessions in `~/.pi/agent/pi-skill-picker-jev.json` (or the configured Pi agent directory). The old `PI_SKILL_PICKER_THRESHOLD` and `PI_SKILL_PICKER_MAX_NEW` environment variables are no longer used.

Run **`/skill-picker history`** to open a two-level history UI. First select a **turn**; the second list shows each added skill with Jev's relevance score (0–1), the threshold used for that decision, and whether it was added on the initial or a follow-up request. Press **Enter** on a skill to expand or collapse its description inline; press **Esc** to return to turns. Descriptions are resolved *live* from Pi's registered skills and **never stored in the session history**. If a skill is no longer loaded, its description is unavailable. Older history entries without stored scores display “score unavailable”. The scored history survives reloads and follows the active branch when you fork or navigate the session tree. Run **`/skill-picker`** without a subcommand to choose between settings and history.

OpenRouter credentials are resolved through Pi's provider authentication (`ctx.modelRegistry.getApiKeyForProvider("openrouter")`). Configure them through Pi auth, `models.json`, or `OPENROUTER_API_KEY`; without credentials, skills stay hidden (fail closed). The optional `PI_SKILL_PICKER_MODEL` variable still selects the OpenRouter Decisions model (default: `typesafe/jev-1.13`).

Pi's `pi-ai` model calls use chat/stream APIs, not Jev's dedicated Decisions endpoint. The extension therefore still sends HTTP requests to the [Decisions API](https://openrouter.ai/docs/api/reference/decisions), but obtains the OpenRouter key from **Pi's own provider authentication** rather than reading it from `process.env`. Ranking uses only Pi's loaded skill metadata and runs in batches of 40. This means a very large catalog makes each model request slower and incurs API costs. If a decision request fails, the existing selection is retained and **the full catalog is never exposed**. Selection is reconstructed from the session's scored addition history on reload; a new session starts over. Manual `/skill:name` invocation remains Pi's responsibility; it still works for skills Pi discovered.

## Usage and cost in pi-stats

Every successful Jev Decisions API batch with reported usage is recorded as **one model invocation**, even if no new skills were selected. The extension appends Pi session usage (when supported) and a `usage.jsonl` sidecar at `<Pi agent dir>/skill-picker-jev/usage.jsonl`, following the same convention as `pi-context-prune`. **pi-stats** shows these as `typesafe/jev-… (jev decision)` model calls with their OpenRouter token counts and USD cost. It does not create synthetic tool calls. The usage records contain only counts, cost, model, and session identifiers—not prompts, skill descriptions, or API keys. Failed requests or responses without a reported cost are not counted as priced model invocations.

## Development

```bash
npm run typecheck
npm test
```

The tests cover using only Pi's skill list, Jev response gating, fail-closed behavior, initial/incremental prompt-section selection, TUI settings persistence, and branch-aware session history. Requires Node 22+ for the test runner and native TypeScript stripping.
