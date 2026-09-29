# Record the skill picker demo

The VHS tape at [`demo/skill-picker.tape`](../demo/skill-picker.tape) records a fresh Pi session in the [20-skill storefront](../demo/README.md). It asks for a read-only low-stock plan, then opens `/skill-picker history` so the selected skills are visible.

## Before recording

1. Install [VHS](https://github.com/charmbracelet/vhs) and its required dependencies (including `ffmpeg` and `ttyd`); confirm `vhs --version` works.
2. Install Pi 0.87.1+ and configure a working model for the answer. Configure Pi's **OpenRouter** authentication for the decision request (`pi auth check --provider openrouter`), or set up a compatible decision server in the picker settings. A decision-service key alone does not provide a model for Pi's answer.
3. From the repository root, run `npm install` if this checkout has not been set up yet. The tape explicitly loads `src/extension.ts`, so a published extension is not required.
4. Use a profile with no project Always allowed skills if you want the history to show automatic picks. The tape uses `--approve` to trust the demo's checked-in project files without a prompt; review them first if you have modified the demo.

## Record

From the **repository root** (the tape's paths are relative to this directory):

```bash
vhs demo/skill-picker.tape
```

The resulting GIF is `demo/skill-picker.gif`. The tape uses `--no-session` and `--no-tools`: it starts with an empty history each time, and Pi cannot edit the demo while recording. It disables automatically discovered extensions but explicitly loads this checkout's extension. No API keys are written into the tape; Pi uses your existing authentication. Review the GIF before sharing it in case your local Pi UI displays private account or project information.

The `Sleep 45s` after the prompt is a fixed wait, not a completion detector. If the decision service or model is still responding when `/skill-picker history` is typed, increase that delay in the tape and rerun. If history shows no additions, check credentials, the picker's threshold and Always allowed settings, and the Pi model connection. The exact picked skills and wording can vary between runs.
