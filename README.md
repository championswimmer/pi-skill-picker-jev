# pi-skill-picker-jev

A [Pi](https://github.com/badlogic/pi-mono) extension that uses OpenRouter's **Jev Decisions API** to keep unrelated skill titles and descriptions out of the model's context.

At the start of each user turn, Pi's full skill catalog is replaced with only the skills Jev selects for the user's request. Before subsequent model requests (including those after tools), Jev reviews the recent conversation and the unsent skills and can add newly relevant skills. Already selected skills remain available for the session. The full `SKILL.md` body is **not** injected: as in Pi's normal skill workflow, the model uses `read` on a selected skill's path when needed.

## Setup

```bash
# Requires Pi 0.87.1+ and OpenRouter credentials in Pi (or OPENROUTER_API_KEY).
cd ~/Development/championswimmer/pi-skill-picker-jev
npm install
pi auth check --provider openrouter
export PI_SKILL_PICKER_ROOT=~/Development/railwayapp/mono
pi install .
```

Alternatively, try it without installing:

```bash
PI_SKILL_PICKER_ROOT=/path/to/mono pi --extension ./src/extension.ts
```

The extension recursively finds `SKILL.md` files under `PI_SKILL_PICKER_ROOT`, ignoring `node_modules`, `.git`, generated artifacts, and symlinked directories. If unset, it scans `./mono` if present, otherwise the current working directory. Skills Pi already discovered are included first; duplicate skill names and `disable-model-invocation: true` skills are excluded. External skills selected from the monorepo are given absolute paths so Pi can read them even when you run it outside that monorepo.

> **Privacy:** Jev receives the user's request, a bounded window of recent user/assistant/tool text, the names of already selected skills, and the names/descriptions of candidate skills. Do not enable this extension for sensitive prompts or skill descriptions unless sending them to OpenRouter is acceptable.

## Configuration

| Environment variable | Default | Purpose |
| --- | --- | --- |
| OpenRouter credentials in Pi | — | Resolved via `ctx.modelRegistry.getApiKeyForProvider("openrouter")`. Configure through Pi auth, `models.json`, or `OPENROUTER_API_KEY`; without credentials, skills stay hidden (fail closed). |
| `PI_SKILL_PICKER_ROOT` | `./mono` if it exists, else `.` | Root of the skill monorepo. |
| `PI_SKILL_PICKER_MODEL` | `typesafe/jev-1.13` | OpenRouter Decisions model. |
| `PI_SKILL_PICKER_THRESHOLD` | `0.75` | Minimum Jev probability to include a skill. |
| `PI_SKILL_PICKER_MAX_NEW` | `6` | Maximum newly added skills per ranking pass. |

Pi's `pi-ai` model calls use chat/stream APIs, not Jev's dedicated Decisions endpoint. The extension therefore still sends HTTP requests to the [Decisions API](https://openrouter.ai/docs/api/reference/decisions), but obtains the OpenRouter key from **Pi's own provider authentication** rather than reading it from `process.env`. Ranking runs in batches of 40. This means a very large catalog makes each model request slower and incurs API costs. If a decision request fails, the existing selection is retained and **the full catalog is never exposed**. Selection is in-memory per Pi session; starting/reloading a session starts over. Manual `/skill:name` invocation remains Pi's responsibility (only skills Pi discovered natively can be invoked this way); use `read` for selected skills from an external monorepo.

## Development

```bash
npm run typecheck
npm test
```

The tests cover YAML discovery, Jev response gating, fail-closed behavior, and initial/incremental prompt-section selection. Requires Node 22+ for the test runner and native TypeScript stripping.
