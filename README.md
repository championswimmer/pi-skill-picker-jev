# pi-skill-picker-jev

A [Pi](https://github.com/badlogic/pi-mono) extension that uses OpenRouter's **Jev Decisions API** to keep unrelated skill titles and descriptions out of the model's context.

At the start of each user turn, the skills **Pi itself discovered for the current working directory/session** are filtered down to only those Jev selects for the user's request. Before subsequent model requests (including those after tools), Jev reviews the recent conversation and the unsent skills and can add newly relevant skills. Already selected skills remain available for the session. The full `SKILL.md` body is **not** injected: as in Pi's normal skill workflow, the model uses `read` on a selected skill's path when needed.

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

| Environment variable | Default | Purpose |
| --- | --- | --- |
| OpenRouter credentials in Pi | — | Resolved via `ctx.modelRegistry.getApiKeyForProvider("openrouter")`. Configure through Pi auth, `models.json`, or `OPENROUTER_API_KEY`; without credentials, skills stay hidden (fail closed). |
| `PI_SKILL_PICKER_MODEL` | `typesafe/jev-1.13` | OpenRouter Decisions model. |
| `PI_SKILL_PICKER_THRESHOLD` | `0.75` | Minimum Jev probability to include a skill. |
| `PI_SKILL_PICKER_MAX_NEW` | `6` | Maximum newly added skills per ranking pass. |

Pi's `pi-ai` model calls use chat/stream APIs, not Jev's dedicated Decisions endpoint. The extension therefore still sends HTTP requests to the [Decisions API](https://openrouter.ai/docs/api/reference/decisions), but obtains the OpenRouter key from **Pi's own provider authentication** rather than reading it from `process.env`. Ranking uses only Pi's loaded skill metadata and runs in batches of 40. This means a very large catalog makes each model request slower and incurs API costs. If a decision request fails, the existing selection is retained and **the full catalog is never exposed**. Selection is in-memory per Pi session; starting/reloading a session starts over. Manual `/skill:name` invocation remains Pi's responsibility; it still works for skills Pi discovered.

## Development

```bash
npm run typecheck
npm test
```

The tests cover using only Pi's skill list, Jev response gating, fail-closed behavior, and initial/incremental prompt-section selection. Requires Node 22+ for the test runner and native TypeScript stripping.
