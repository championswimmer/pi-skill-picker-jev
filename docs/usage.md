# Skill Picker usage guide

The [README](../README.md) covers installation and the basics. This guide covers the options you can change in Pi.

## Tune the picker

Run `/skill-picker settings`:

| Setting | Default | What it does |
| --- | --- | --- |
| Threshold | `0.625` | Minimum normalized usefulness rating (0–1). Lower values show more skills; higher values are more selective. |
| Max new skills | `6` | Maximum skills added per decision (0–100). |
| When to pick | Prompt + tool results | **Prompt only** makes fewer requests. **Every changed request** checks more often. |
| Always allowed skills | None | Keep selected skills available in this project, even when the decision server does not select them. |

The default rechecks when tools return new text, so skills can be added as a task develops. Larger catalogs cost more and take longer to rank: the picker sends one request per 50 candidate skills, with up to six requests running at once. Choose **Prompt only** if speed or cost matters. Skills already selected are not removed during the session.

Ratings are not probabilities. Jev scores each skill from unrelated (0) to essential (4); the picker normalizes the score to 0–1. The default threshold of `0.625` sits between optional support (2) and directly useful (3). Existing saved thresholds are not reset by an update. History distinguishes older Noul probabilities from newer Score ratings.

## Keep skills always available

Open **Always allowed skills** from `/skill-picker settings`. Type to fuzzy-search in the A-Z tab, then press Down to enter the list. Space toggles a skill; Enter expands its description. Esc returns to search; press it again to close. Ctrl+S saves without closing, and a yellow dot by Save means you have unsaved changes. Closing without saving discards those changes.

Tab switches between **A-Z** and **Relevance**. In Relevance, Ctrl+R ranks the search text against skills (or ranks by general importance if the search is empty). These rankings use your configured decision server and may incur OpenRouter charges. Results are cached while the editor is open; Ctrl+R requests fresh results. A-Z still works if ranking is unavailable.

Your choices are stored in the project's `.pi/skill-picker-jev.json`. Only skills currently available to Pi can be shown; removed or disabled skills won't appear just because they were saved here.

## Use a different decision server

The default is OpenRouter's Jev Decisions API, using Pi's OpenRouter authentication (including `OPENROUTER_API_KEY`). You can instead connect to an already-running TypeSafe-compatible server such as local Kev. The extension does not start or stop that server.

In `/skill-picker settings`, set:

1. **TypeSafe API base URL** to the server root, such as `http://127.0.0.1:8008` for local Kev 4B or `http://127.0.0.1:8009` for 9B. A root ending in `/v1` also works; the picker calls `/v1/systemone`. Clear this field to return to OpenRouter.
2. **API token** if the server requires one. Local unauthenticated servers can leave it blank. A custom server never receives your Pi OpenRouter key. Changing the URL clears the saved token, so set the URL first.
3. **Decision model** if needed (for Kev, `kev-latest`). When blank, `PI_SKILL_PICKER_MODEL` takes precedence over the endpoint's default: `jev-latest` for custom servers and `typesafe/jev-1.13` for OpenRouter. Clear an incompatible model when switching servers.

A token entered here overrides Pi's OpenRouter authentication if you return to OpenRouter. It is saved in plaintext in your Pi agent settings file (`pi-skill-picker-jev.json`, usually under `~/.pi/agent/`), with file permissions `0600`. The input is visible while typing but is not prefilled when you reopen settings. Use HTTPS for remote servers.

If you have `kev-local` checked out next to this repository, run these commands from this repository's root to start or stop Kev. Use the port printed by the start command as the base URL in settings:

```bash
../kev-local/scripts/kev_ctl.sh 4b start  # prints its port; use 9b for the larger model
../kev-local/scripts/kev_ctl.sh 4b stop
```

To try a local checkout of this extension without installing it, start Pi from a project containing Pi skills with `pi --extension /absolute/path/to/pi-skill-picker-jev/src/extension.ts`.
