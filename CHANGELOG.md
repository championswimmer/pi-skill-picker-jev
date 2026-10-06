# Changelog

## 0.3.0

### Features

- Separate global and project always-allowed skill lists, respecting each skill's scope.
- Add distinct global and project allowlist editors and show where each list is saved.
- Preserve global allowlist selections when saving other settings.

<!-- generated-release-notes:start -->
### What's Changed
* Separate global and project allowlists; release 0.3.0 by @championswimmer in https://github.com/championswimmer/pi-skill-picker-jev/pull/1

### New Contributors
* @championswimmer made their first contribution in https://github.com/championswimmer/pi-skill-picker-jev/pull/1

**Full Changelog**: https://github.com/championswimmer/pi-skill-picker-jev/compare/v0.2.0...v0.3.0
<!-- generated-release-notes:end -->

## 0.2.0

### Features

- Skip filtering when fewer than 30 eligible Pi-loaded skills are available, leaving Pi's original skills list intact. Configure `minSkills` or set it to `0` to disable the gate.
- Show custom endpoint URL and token settings only in Custom HTTP mode.

### Docs and releases

- Clarify skill-selection timing and required extension ordering.
- Improve and validate the how-it-works diagrams.
- Publish tagged releases to npm through GitHub Actions using trusted publishing.

<!-- generated-release-notes:start -->
**Full Changelog**: https://github.com/championswimmer/pi-skill-picker-jev/compare/v0.1.1...v0.2.0
<!-- generated-release-notes:end -->

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
