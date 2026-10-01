# Skill Picker for Pi

[![npm version](https://img.shields.io/npm/v/pi-skill-picker-jev)](https://www.npmjs.com/package/pi-skill-picker-jev)

Pi can discover a lot of skills, but most requests only need a few. **Skill Picker** asks a classifier which of your already-available skills fit the task, then shows Pi only that smaller set instead of the whole catalog.

It is meant for people who already use Pi skills and want less prompt bloat, cleaner skill selection, and a simple way to keep the right skills available.

## Check out my other Pi extensions

- [![pi-auto-theme](https://img.shields.io/badge/🎨_pi--auto--theme-blue?style=flat-square)](https://github.com/championswimmer/pi-auto-theme) — Auto-syncs Pi theme with OS dark/light mode.
- [![pi-cache-graph](https://img.shields.io/badge/📊_pi--cache--graph-orange?style=flat-square)](https://github.com/championswimmer/pi-cache-graph) — Real-time prompt cache hit rates and token metrics.
- [![pi-checklist](https://img.shields.io/badge/✅_pi--checklist-teal?style=flat-square)](https://github.com/championswimmer/pi-checklist) — Session task checklist with dependencies and a TUI renderer.
- [![pi-context-prune](https://img.shields.io/badge/✂️_pi--context--prune-green?style=flat-square)](https://github.com/championswimmer/pi-context-prune) — Prunes verbose tool outputs from context while preserving history.
- [![pi-context-usage](https://img.shields.io/badge/🪟_pi--context--usage-purple?style=flat-square)](https://github.com/championswimmer/pi-context-usage) — Dot-grid visualization of context window token usage.
- [![pi-gauge](https://img.shields.io/badge/⚡_pi--gauge-yellow?style=flat-square)](https://github.com/championswimmer/pi-gauge) — Live tokens/sec and TTFT in the status bar.
- [![pi-subscription-meter](https://img.shields.io/badge/💳_pi--subscription--meter-red?style=flat-square)](https://github.com/championswimmer/pi-subscription-meter) — Tracks subscription quotas and rate limits across AI providers.

## Why people install it

- **Smaller initial context** — Pi does not need to advertise every available skill up front.
- **Better focus** — relevant skills appear automatically for the task in front of you.
- **Fail-closed behavior** — if ranking is unavailable, the extension does not fall back to exposing the full catalog.
- **Manual control still works** — you can still invoke a skill yourself with `/skill:name`.

## Install

Requires **Pi 0.87.1+**.

### From npm

```bash
pi install pi-skill-picker-jev
```

### From this repository

```bash
pi install git:github.com/championswimmer/pi-skill-picker-jev
```

If you want the default hosted backend, make sure Pi already has OpenRouter credentials:

```bash
pi auth check --provider openrouter
```

You can also use the built-in **Pi classifier** mode or point the extension at your own TypeSafe-compatible HTTP endpoint.

### Extension order matters

**Place Skill Picker first in your Pi configuration—or at least before any other extension that reads or modifies context.** It needs to filter the skills catalog before those extensions see the context, so they work with the selected skills rather than the full catalog.

## First run

1. Start Pi inside a project that already contains Pi skills.
2. Ask for help normally.
3. Open `/skill-picker history` to see which skills were added.
4. Open `/skill-picker settings` if you want to make it more or less selective, or keep the picker off for small skill repos.

The extension uses the skills Pi has already discovered. It does **not** install or generate skills for you.

## Real prompts to try

These examples come from the repository's storefront demo project and are good sanity checks for a fresh install:

- `Add a low-stock report for the catalog and test the reorder threshold.`
- `Add a coupon code to the checkout total and explain the rounding policy.`
- `Write an accessible cart-empty state and update the storefront copy.`
- `Draft a migration plan for changing the product JSON format.`
- `Add an incident runbook for checkout failures and a release checklist.`

In each case, you should see a small, task-specific set of skills show up in `/skill-picker history` instead of the whole skill catalog being exposed up front.

## Everyday commands

- `/skill-picker` — open the picker menu.
- `/skill-picker settings` — tune threshold, max new skills, minimum repo skills, trigger timing, classifier mode, and project allowlist.
- `/skill-picker history` — inspect which skills were added during this session.
- `/skill-picker on` / `/skill-picker off` — enable or disable the extension quickly.
- `/skill:name` — manually invoke a skill if you want to bypass automatic selection.

Skills selected during a session stay available for the rest of that session. A new Pi session starts fresh.

By default, the picker only runs in repos where Pi has loaded at least `30` model-invocable skills after deduping by name. Set **Minimum repo skills** to `0` if you want it to run even in smaller skill catalogs.

## What gets sent

By default, the hosted OpenRouter / Jev mode sends:

- your current request,
- bounded recent conversation context,
- completed tool text (depending on trigger mode), and
- skill names and descriptions.

It does **not** send full skill files.

If that is too sensitive for your workflow, switch to the **Pi classifier** mode or configure your own trusted HTTP endpoint in settings.

## Learn more

- [Usage guide](https://github.com/championswimmer/pi-skill-picker-jev/blob/main/docs/usage.md)
- [Troubleshooting](https://github.com/championswimmer/pi-skill-picker-jev/blob/main/docs/troubleshooting.md)
- [Implementation notes](https://github.com/championswimmer/pi-skill-picker-jev/blob/main/docs/implementation.md)
- [Changelog](https://github.com/championswimmer/pi-skill-picker-jev/blob/main/CHANGELOG.md)
- [Storefront demo walkthrough](https://github.com/championswimmer/pi-skill-picker-jev/blob/main/demo/README.md)
