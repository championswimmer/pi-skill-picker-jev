# Implementation notes

This file is for maintainers and curious adopters who want the architectural picture without digging through the source.

## What the extension does

`src/extension.ts` registers `/skill-picker`, watches the conversation at `before_agent_start` and `context_with_system`, and replaces only the skills section of Pi's system prompt.

Important behavior:

- candidate skills come from `event.systemPromptOptions.skills`,
- duplicate names are removed,
- skills with `disableModelInvocation` are excluded,
- Pi's other prompt sections stay intact,
- and failures do **not** reveal the full catalog.

## Main code map

- `src/extension.ts` — command registration, session state, prompt interception, UI wiring.
- `src/picker.ts` — ranking logic, batch handling, score normalization, backend-agnostic decision flow.
- `src/decision.ts` — routes requests to OpenRouter / Jev, a custom HTTP endpoint, or Pi classifier mode.
- `src/classifier-backend.ts` — Pi classifier integration.
- `src/settings.ts` — defaults, parsing, migration, and atomic settings writes.
- `src/always-allowed.ts` and `src/always-allowed-ui.ts` — project allowlist persistence and TUI editor.
- `src/history.ts` and `src/history-ui.ts` — session history restoration and display.
- `src/triggers.ts` — decides when a new ranking pass is needed.
- `src/usage-log.ts` — usage reporting and JSONL sidecar logging.
- `src/status.ts` — temporary "Picking Skills" status widget.

## Persistent data

### Personal settings

Stored in Pi's agent directory, usually:

- `~/.pi/agent/pi-skill-picker-jev.json`

Defaults:

- `enabled: true`
- `threshold: 0.625`
- `maxNew: 6`
- `triggerMode: "prompt-and-tools"`
- `mode: "openrouter-jev"`

Optional fields store classifier mode details such as `apiBaseUrl`, `apiToken`, and `model`.

### Project allowlist

Stored in the project at:

- `.pi/skill-picker-jev.json`

This keeps "always allowed" skills pinned for one project only.

### Session history

The extension stores custom Pi session entries so selected skills can be restored on the active branch. New records use normalized score history; legacy probability-style history is still understood.

### Usage sidecar

Successful priced hosted decisions can also be written to a JSONL sidecar under Pi's agent directory for `pi-stats`-style consumers.

## Ranking model notes

The picker uses score-style usefulness ratings, not probabilities.

- Hosted default: `typesafe/jev-1.13`
- Custom HTTP: endpoint default unless overridden
- Pi classifier: whichever classifier model Pi resolves from the configured name

Candidates are ranked in batches of 50, with up to six concurrent requests.

## Privacy and failure model

The extension sends bounded task/context text plus skill names and descriptions to the configured ranking backend. It never sends full skill files for ranking.

If ranking fails or credentials are missing, the extension keeps the full catalog hidden instead of falling back to "show everything".

## Packaging notes

This package is published as a Pi extension, not a general-purpose library.

Key package metadata:

- `pi.extensions` points at `./src/extension.ts`
- the package ships source-first TypeScript
- publish validation should at minimum run typecheck, tests, and `npm pack --dry-run`

## Related files

- [Usage guide](./usage.md)
- [Troubleshooting](./troubleshooting.md)
- `AGENTS.md` for the maintainer map used during development
- `docs/scoring-research.md` for the deeper ranking experiments
