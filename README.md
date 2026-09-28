# pi-skill-picker-jev

A [Pi](https://github.com/badlogic/pi-mono) extension that shows the model only the skills relevant to its current task. It asks OpenRouter's Jev Decisions API to pick from the skills Pi has already discovered, instead of putting the whole skill catalog in the model's context. Selected skills remain available for the session; Pi's normal `read` workflow loads a full `SKILL.md` only when needed.

## Install

Requires Pi 0.87.1+ and an OpenRouter API key configured in Pi (or `OPENROUTER_API_KEY`).

```bash
pi install git:github.com/championswimmer/pi-skill-picker-jev
pi auth check --provider openrouter
```

Start Pi in the project whose skills you want to use. The picker only sees skills Pi discovers for that session; it does not search for skills on its own. To try a local checkout without installing it, run `pi --extension /path/to/pi-skill-picker-jev/src/extension.ts` from your project directory.

> **Privacy:** The Decisions API receives your request, recent user/assistant/tool text, selected skill names, and candidate skill names and descriptions. Do not use the picker with sensitive material unless you are comfortable sending it to OpenRouter. Full skill files are not sent by the picker.

## Use it well

Just work in Pi as usual. The picker runs on each new prompt; while it runs, Pi displays **Picking Skills**. Use `/skill-picker settings` to tune it:

| Setting | Default | When to change it |
| --- | --- | --- |
| Threshold | `0.75` | Lower it to include more skills; raise it to be more selective (0–1). |
| Max new skills | `6` | Limit how many skills one decision can add (0–100). |
| When to pick | Prompt + tool results | Choose **Prompt only** for fewer API calls, or **Every changed request** to react more often. |
| Always allowed skills | None | Open the project skill picker to keep chosen skills available on every request. |

The default also rechecks after new textual tool results, so a skill discovered to be relevant partway through a task can be added. **Prompt only** skips those follow-up checks; **Every changed request** rechecks whenever the recent conversation changes. Large skill catalogs take longer and cost more to rank (one Jev request per 40 candidates, up to three at a time). If speed or cost matters, start with Prompt only. Already Jev-selected skills are not removed during a session. In **Always allowed skills**, press Enter to toggle, Ctrl+O to view a description, Ctrl+F to search names/descriptions, Tab to switch alphabetical/Jev global-importance sorting, Ctrl+R to refresh the Jev ranking, and Ctrl+S to save (Esc cancels). The Jev ranking is cached while the picker is open: switching tabs does not repeat requests, but Ctrl+R does. Relevance sorting makes paid Decisions requests and requires OpenRouter authentication; without it, alphabetical sorting still works. The allowlist is stored as skill names in the current project's `.pi/skill-picker-jev.json`. Removed or disabled skills are never loaded from stale allowlist entries.

Use `/skill-picker history` to see which skills were added, when, and their Jev scores. `/skill-picker` opens a menu for settings or history. You can still invoke Pi-discovered skills manually with `/skill:name`.

Settings persist across sessions in the Pi agent directory. With no OpenRouter credentials, or if a decision fails, the picker keeps existing selections and **does not expose the full catalog**. A new session starts with a fresh Jev selection; project always-allowed skills remain available.

## For contributors

See [AGENTS.md](AGENTS.md) for code paths, persistence formats, and compatibility notes. From a checkout, run `npm install`, `npm run typecheck`, and `npm test` (Node 22+).
