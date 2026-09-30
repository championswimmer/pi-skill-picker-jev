# Changelog

## 0.1.1

### Docs

- Clarified everyday setup and first-run guidance in the README.
- Added explicit mode-selection guidance for Hosted OpenRouter / Jev, Pi classifier, and custom HTTP / Kev setups.
- Added dedicated troubleshooting and implementation notes.
- Added links to related Pi extensions from the README.

### Packaging

- Added package metadata and publish-time validation helpers for npm releases.

## 0.1.0

First public release.

### Features

- Automatically narrows Pi's visible skill catalog to the skills most relevant to the current task.
- Supports three ranking backends:
  - Hosted OpenRouter / Jev
  - Custom TypeSafe-compatible HTTP endpoint
  - Pi classifier mode
- Adds `/skill-picker`, `/skill-picker settings`, `/skill-picker history`, and quick `/skill-picker on|off` controls.
- Supports per-project **Always allowed** skills.
- Restores selected skills from session history on the active branch.
- Logs priced hosted decisions to Pi usage reporting and a JSONL sidecar when available.

### Docs

- Reworked the README around installation, first-run flow, real prompts, and privacy.
- Split deeper details into dedicated usage, troubleshooting, and implementation docs.
