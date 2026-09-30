# Troubleshooting

## Nothing happens when I ask Pi something

Check these first:

- Run `/skill-picker on` in case the extension was disabled.
- Open `/skill-picker settings` and confirm the classifier mode you expect.
- Make sure you are running Pi in a project that actually contains Pi skills.

If the extension has no candidate skills, there is nothing to rank.

## No new skills were added

That can be normal.

Possible reasons:

- Your current request does not strongly match any available skills.
- The **Threshold** is set too high.
- The relevant skills are already selected earlier in the same session.
- The classifier request failed.

Try lowering the threshold slightly, then ask again in a fresh session and inspect `/skill-picker history`.

## I expected Pi to see every skill when ranking failed

It will not.

This extension is intentionally **fail-closed**: if the ranking backend is unavailable or unauthenticated, it does not expose the entire skill catalog as a fallback. Already selected skills and project-level **Always allowed** skills remain available.

## OpenRouter mode is not working

Run:

```bash
pi auth check --provider openrouter
```

If Pi does not have working OpenRouter credentials, the default hosted mode cannot make ranking requests.

You can also switch to **Pi classifier** mode or **Custom HTTP endpoint** mode in `/skill-picker settings`.

## Custom HTTP mode says the base URL is invalid

The base URL must be a clean `http://` or `https://` root.

Good examples:

- `http://127.0.0.1:8008`
- `https://ranker.example.com`
- `https://ranker.example.com/v1`

Bad examples:

- `file:///tmp/ranker`
- URLs with usernames, passwords, query strings, or fragments

## My custom server token disappeared

That is expected when you change the configured base URL. The extension clears the saved token so credentials from one endpoint are not silently reused for another.

## The picker is using the wrong model

Open `/skill-picker settings` and check **Decision model**.

Model precedence is:

1. the saved **Decision model** setting,
2. `PI_SKILL_PICKER_MODEL`,
3. the mode's default.

Defaults:

- Hosted OpenRouter / Jev: `typesafe/jev-1.13`
- Custom HTTP endpoint: endpoint default, usually `jev-latest`
- Pi classifier: whatever classifier model name you configure through Pi

## I do not want prompt/context data sent to OpenRouter

Use one of these instead:

- **Pi classifier** mode
- **Custom HTTP endpoint** mode backed by infrastructure you trust

The hosted mode sends bounded task/context text and skill names/descriptions, but not full skill files.

## Where can I see what was picked?

Run:

```text
/skill-picker history
```

That view shows the skills added during the current session and their recorded ratings.
