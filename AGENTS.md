# Agent guide

Keep the README focused on installation and everyday use. This file is the maintainer map for behavior, code paths, and on-disk/session data. This is a Pi extension, not a standalone skill scanner: `package.json` declares `src/extension.ts` as the Pi entry point. Pi 0.87.1+ and Node 22+ are the development baseline.

## Code map

- `src/extension.ts`: registers `/skill-picker`, intercepts `before_agent_start` and `context_with_system`, maintains selected skills, and replaces only the skills system-prompt section. Candidate inventory comes **only** from `event.systemPromptOptions.skills`; exclude duplicate names and `disableModelInvocation` skills. Keep Pi's other prompt sections intact, and never fall back to the unfiltered list on failure. `session_start`/`session_tree` restore the active branch.
- `src/picker.ts`: `rankSkills` calls `https://openrouter.ai/api/alpha/decisions` with `typesafe/jev-1.13` by default (`PI_SKILL_PICKER_MODEL` overrides it). Batches default to 40 candidates (max three requests concurrently), sort by Jev `noul` probability, and cap newly added skills. No key, candidates, or task means no selection. `transcriptText` bounds the text sent to Jev; preserve this privacy/size boundary. `src/decision.ts` shares authentication, status, and usage logging between task ranking and global-importance scoring.
- `src/triggers.ts`: tracks model-request snapshots and completed textual tool results. Modes: `prompt-only`, `prompt-and-tools`, `every-request`. Do not treat streaming updates or unchanged retries as new decisions.
- `src/settings.ts`: defaults, parsing, and atomic settings writes; `src/always-allowed.ts`: project-scoped allowlist writes; `src/always-allowed-ui.ts`: searchable TUI editor with per-opening cached Jev importance scores and explicit refresh. `src/history.ts`: branch-aware addition restoration and grouping; `src/history-ui.ts`: TUI history display, looking up descriptions live rather than persisting them.
- `src/usage-log.ts`: reports each successful priced Decisions batch to Pi session usage where supported and to a pi-stats-compatible JSONL sidecar. `src/status.ts`: temporary Picking Skills UI, cleaned up in `finally`.
- `test/*.test.ts`: regression tests for these modules and extension integration; update relevant tests when changing prompt construction, triggers, persistence, or failures.

## Persistent and legacy data

- Settings: `<Pi agent dir>/pi-skill-picker-jev.json` (usually `~/.pi/agent/pi-skill-picker-jev.json`), with `threshold` (0–1), `maxNew` (integer 0–100), and `triggerMode` (`prompt-only` / `prompt-and-tools` / `every-request`). Missing/invalid values fall back individually to defaults `0.75`, `6`, and `prompt-and-tools`. Writes use a temporary file and rename. Old `PI_SKILL_PICKER_THRESHOLD` and `PI_SKILL_PICKER_MAX_NEW` env vars are **not** settings sources.
- Project allowlist: `<project cwd>/.pi/skill-picker-jev.json`, `{ "alwaysAllowed": ["skill-name"] }`, written atomically. Only currently loaded, model-invocable Pi skills may be injected; stale or disabled names never enter the system prompt. This file is local user data, gitignored here, but may be committed intentionally in other projects for a shared allowlist.
- Session history: Pi custom entries `skill-picker-turn` (`{turn}`) and `skill-picker-add` (`{turn, step, threshold, skills: [{name, score}]}`). `step === 1` means initial selection; later steps are follow-ups. Restore only from `ctx.sessionManager.getBranch()` so sibling branches do not leak selections. Legacy addition records may contain skill-name strings instead of scored objects and omit a valid threshold: accept them with `score: null`/`threshold: null`. Descriptions are never saved in these records. Restored names are matched back to the currently loaded Pi inventory; stale paths are dropped. A new session starts fresh.
- Usage: `<Pi agent dir>/skill-picker-jev/usage.jsonl`, rotated to `usage.jsonl.1` at 16 MiB. Records have `v: 1`, `source: "skill-picker-jev"`, `kind: "skill_picker_jev"`, `label: "decision"`, OpenRouter model, token counts, USD cost, session ID, and optional Pi usage-entry ID; no prompt text, skill descriptions, or secrets. A successful batch with reported cost is logged even when it selected nothing. Preserve the sidecar schema for pi-stats consumers.

## Development

```bash
npm install
npm run typecheck
npm test
```

For a local smoke test from a project containing Pi skills: `pi --extension /absolute/path/to/src/extension.ts`. OpenRouter credentials come from Pi provider authentication (`getApiKeyForProvider("openrouter")`, including Pi's environment-backed auth), not direct environment reads in this extension. A missing key or failed Jev call must leave the complete catalog hidden; only already selected skills may remain visible. Manual `/skill:name` remains Pi's responsibility.
