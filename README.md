# pi-skill-picker-jev

A [Pi](https://github.com/badlogic/pi-mono) extension that shows the model only the skills relevant to its current task. It asks OpenRouter's Jev Decisions API (or a configured TypeSafe-compatible server, including local Kev) to pick from the skills Pi has already discovered, instead of putting the whole skill catalog in the model's context. Selected skills remain available for the session; Pi's normal `read` workflow loads a full `SKILL.md` only when needed.

## Install

Requires Pi 0.87.1+ and either an OpenRouter API key configured in Pi (or `OPENROUTER_API_KEY`), or a TypeSafe-compatible server configured below.

```bash
pi install git:github.com/championswimmer/pi-skill-picker-jev
pi auth check --provider openrouter
```

Start Pi in the project whose skills you want to use. The picker only sees skills Pi discovers for that session; it does not search for skills on its own. To try a local checkout without installing it, run `pi --extension /path/to/pi-skill-picker-jev/src/extension.ts` from your project directory.

> **Privacy:** The Decisions API receives your request, recent user/assistant/tool text, selected skill names, and candidate skill names and descriptions. Do not use the picker with sensitive material unless you are comfortable sending it to your configured decision server (OpenRouter by default). Full skill files are not sent by the picker.

## Use it well

Just work in Pi as usual. The picker runs on each new prompt; while it runs, Pi displays **Picking Skills**. Use `/skill-picker settings` to tune it:

| Setting | Default | When to change it |
| --- | --- | --- |
| Threshold | `0.625` | Normalized usefulness rating cutoff (0–1). Lower includes more skills; higher is more selective. |
| Max new skills | `6` | Limit how many skills one decision can add (0–100). |
| When to pick | Prompt + tool results | Choose **Prompt only** for fewer API calls, or **Every changed request** to react more often. |
| Always allowed skills | None | Open the project skill picker to keep chosen skills available on every request. |

The default also rechecks after new textual tool results, so a skill discovered to be relevant partway through a task can be added. **Prompt only** skips those follow-up checks; **Every changed request** rechecks whenever the recent conversation changes. Large skill catalogs take longer and cost more to rank (one Jev request per 50 candidates, up to six at a time). If speed or cost matters, start with Prompt only. Already Jev-selected skills are not removed during a session. In **Always allowed skills**, type to fuzzy-search in A-Z, press Down to enter the list (Space toggles a skill; Enter expands its description), and Esc to return to search (again to close). Tab switches A-Z/Relevance; in Relevance, Ctrl+R ranks skills for the search text (or by global importance if empty). Ctrl+S saves without closing; a yellow dot before Save marks unsaved changes. Esc closes without saving further changes. The Jev ranking is cached while the picker is open: switching tabs does not repeat requests, but Ctrl+R does. Relevance sorting uses the same decision-server settings (and makes paid requests when using OpenRouter); if unavailable, alphabetical sorting still works. The allowlist is stored as skill names in the current project's `.pi/skill-picker-jev.json`. Removed or disabled skills are never loaded from stale allowlist entries.

Use `/skill-picker history` to see which skills were added, when, and their Jev scores. `/skill-picker` opens a menu for settings or history. You can still invoke Pi-discovered skills manually with `/skill:name`.

Selection uses TypeSafe **Score**, rating skills from unrelated (0) through optional support (2) to essential (4), then normalizing by 4. The default cutoff is halfway between optional support and directly useful (3). These are ratings, not probabilities. Saved thresholds are preserved; set yours to `0.625` to adopt the new default. History labels old values as Noul probabilities and new values as ratings.

Settings persist across sessions in the Pi agent directory. Without a configured server or OpenRouter credentials, or if a decision fails, the picker keeps existing selections and **does not expose the full catalog**. A new session starts with a fresh Jev selection; project always-allowed skills remain available.

## Local Kev / TypeSafe server

In `/skill-picker settings`, configure:

- **TypeSafe API base URL:** e.g. `http://127.0.0.1:8008` for local Kev 4B, or `http://127.0.0.1:8009` for 9B. The extension calls `/v1/systemone`; a base ending in `/v1` also works. Blank restores OpenRouter.
- **API token:** overrides Pi's OpenRouter authentication (including `OPENROUTER_API_KEY`). Leave blank for an unauthenticated local server. Custom URLs **never** inherit your OpenRouter key. Changing the URL clears the saved token; set the URL first, then its token.
- **Decision model:** use `kev-latest` for Kev. Blank uses `PI_SKILL_PICKER_MODEL` if set, otherwise `jev-latest` for custom servers or `typesafe/jev-1.13` for OpenRouter.

The extension connects to an already-running server; it does not launch or stop models. Optional settings are stored as `apiBaseUrl`, `apiToken`, and `model` in the agent settings file. Tokens are stored in plaintext with file permissions `0600`, never shown in the settings menu or prefilled, but **visible while typing**. Use HTTPS for remote servers. Clear a custom model when switching providers if it is not supported there.

For the local setup in `../kev-local`:

```bash
../kev-local/scripts/kev_ctl.sh 4b start   # prints its port; use 9b for the larger model
# Set the corresponding base URL in /skill-picker settings, then use Pi normally.
../kev-local/scripts/kev_ctl.sh 4b stop
```

## For contributors

See [AGENTS.md](AGENTS.md) for code paths, persistence formats, and compatibility notes, and [the scoring research](docs/scoring-research.md) for the Noul/Score comparison and live Kev test instructions. From a checkout, run `npm install`, `npm run typecheck`, and `npm test` (Node 22+).
