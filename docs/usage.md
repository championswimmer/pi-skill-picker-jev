# Skill Picker usage guide

The [README](../README.md) covers installation and first-run usage. This guide covers the settings you are most likely to change once the extension is installed.

## Everyday controls

- `/skill-picker` opens the picker menu.
- `/skill-picker settings` changes how the picker behaves.
- `/skill-picker history` shows which skills were added this session and their ratings.
- `/skill-picker on` and `/skill-picker off` toggle the extension without uninstalling it.

## Tune how selective it is

Open `/skill-picker settings` and adjust these options:

| Setting | Default | Plain-English meaning |
| --- | --- | --- |
| Threshold | `0.625` | Minimum usefulness score before a skill is added. Lower = more skills, higher = fewer skills. |
| Max new skills | `6` | Maximum number of newly added skills per decision. |
| When to pick | Prompt + tool results | Re-rank only from your prompt, or also after tools produce new text. |
| Always allowed skills | None | Skills that should stay available in this project even if the ranker does not pick them. |

A good mental model:

- **Lower threshold** if the picker feels too conservative.
- **Higher threshold** if it keeps surfacing optional or distracting skills.
- **Prompt only** if you want fewer model calls.
- **Prompt + tool results** if tasks often change shape after running tools.
- **Every changed request** if you want the picker to react as aggressively as possible.

Skills already selected are not removed during the same Pi session.

## Keep a few skills always available

Open **Always allowed skills** from `/skill-picker settings` when there are project-specific skills you almost always want on hand.

Inside the editor:

- Type to fuzzy-search in the A-Z tab.
- Press **Down** to move into the results list.
- Press **Space** to toggle a skill.
- Press **Enter** to expand its description.
- Press **Ctrl+S** to save without closing.
- Press **Esc** to back out or close the editor.

There are two views:

- **A-Z** — browse alphabetically.
- **Relevance** — press **Ctrl+R** to rank skills against the current search text, or by general usefulness when the search is empty.

Your project-level allowlist is stored in `.pi/skill-picker-jev.json`.

## Choose a classifier mode

The extension supports three ways to rank skills. The easiest way to think about them is: **hosted service**, **Pi-managed classifier**, or **your own compatible endpoint**.

| Mode | Best when | What you must configure |
| --- | --- | --- |
| Hosted OpenRouter / Jev | You want the default setup with the fewest moving parts. | Give Pi working OpenRouter auth. Optional: override **Decision model**. |
| Pi classifier | You want the picker to use Pi's classifier registry instead of calling the hosted Decisions API directly. | Make sure Pi can resolve a classifier model, then optionally set **Decision model**. |
| Custom HTTP endpoint | You already run a TypeSafe-compatible service such as local Kev. | Set base URL, optional token, and usually a model name such as `kev-latest`. |

### 1. Hosted OpenRouter / Jev

This is the default mode.

Use it when:

- Pi already has OpenRouter authentication configured.
- You want the simplest setup.
- You are comfortable sending the bounded prompt/context payload described in the README.

How to use it:

1. Make sure Pi has working OpenRouter credentials:

   ```bash
   pi auth check --provider openrouter
   ```

2. Open `/skill-picker settings`.
3. Leave **Classifier mode** on **Hosted OpenRouter / Jev**.
4. Optionally set **Decision model** if you want something other than the default hosted model.
5. Ask Pi for help normally, then inspect `/skill-picker history` if you want to confirm what was added.

The default decision model is `typesafe/jev-1.13` unless you override it with the **Decision model** setting or `PI_SKILL_PICKER_MODEL`.

### 2. Pi classifier

Use **Pi classifier** mode when you want the extension to call a classifier model through Pi's model registry instead of the hosted Jev Decisions API.

Use it when:

- you already manage classifier models in Pi,
- you want to keep routing inside Pi,
- you want to use a classifier provider other than hosted OpenRouter,
- or you do not want this extension making direct OpenRouter Decisions API requests.

Important: this mode uses **Pi's classifier model registry**, not your current chat model. Classifier models do not show up in Pi's normal `/model` picker.

How to use it:

1. Make sure Pi can access at least one classifier model.
   - Easiest path: give Pi TypeSafe credentials (for example `TYPESAFE_API_KEY`) and use the default classifier model.
   - Alternative: configure another classifier-capable provider in Pi and reference it explicitly in **Decision model**.
   - Advanced: define or expose classifier models through Pi itself, for example via `models.json`, a compatible provider, or llama.cpp classification support.
2. Open `/skill-picker settings`.
3. Set **Classifier mode** to **Pi classifier**.
4. Optional: set **Decision model**.
   - Leave it blank to use the default `typesafe/jev-latest` classifier through Pi.
   - Set a provider-qualified model such as `openrouter/typesafe/jev-1.13` if you want Pi to route classifier requests through a different provider.
   - If you enter a model name without a provider prefix, the extension treats it as `typesafe/<name>`.
   - Minimal TypeSafe recipe: set `TYPESAFE_API_KEY`, switch to **Pi classifier**, and leave **Decision model** blank.
5. Ask Pi for help normally and review `/skill-picker history` to confirm the picker is adding skills.

If Pi cannot resolve the configured classifier model, the picker fails closed and does not reveal the whole skill catalog.

### 3. Custom HTTP endpoint

Use **Custom HTTP endpoint** mode when you already have a TypeSafe-compatible ranking service running, such as a local Kev server.

How to use it:

1. Start your service and note its root URL.
2. Open `/skill-picker settings`.
3. Set **Classifier mode** to **Custom HTTP endpoint**.
4. Configure:
   1. **Custom HTTP base URL** — for example `http://127.0.0.1:8008`.
   2. **Custom HTTP token** — only if that endpoint requires one. Leave it blank for unauthenticated local servers.
   3. **Decision model** — optional; for Kev a common value is `kev-latest`.
5. Ask Pi for help normally, then inspect `/skill-picker history` if you want to verify picks.

Notes:

- A custom endpoint never inherits Pi's OpenRouter key.
- Changing the base URL clears the saved token so you do not accidentally reuse it.
- The base URL should be the server root; the extension adds `/v1/systemone` itself.
- If the endpoint is invalid or unavailable, the picker fails closed and keeps the full catalog hidden.

## Performance and cost notes

The picker ranks candidates in batches of 50 and can run up to six requests at once for large skill catalogs.

That means:

- larger skill inventories cost more to rank,
- `Prompt only` is the cheapest trigger mode,
- and `Every changed request` is the most eager.

Ratings are normalized usefulness scores, not probabilities. In practice, the default threshold `0.625` means “this skill looks directly useful, not just vaguely related.”

## Where settings live

Personal settings are stored in Pi's agent directory, usually:

- `~/.pi/agent/pi-skill-picker-jev.json`

Project allowlists are stored in:

- `<project>/.pi/skill-picker-jev.json`

If you enter an API token in the settings UI, it is saved only in the agent settings file and written with mode `0600`.

## Local development shortcut

If you want to try a local checkout of this extension without installing it first:

```bash
pi --extension /absolute/path/to/pi-skill-picker-jev/src/extension.ts
```

For maintainer-facing details about storage, history restoration, usage logging, and packaging, see [implementation notes](./implementation.md).
