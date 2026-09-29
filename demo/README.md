# Skill picker demo: tiny storefront

This is a standalone sample project with **20 project-local Pi skills** in `.pi/skills/`. The skills cover different parts of a small storefront, so the picker can surface a few relevant ones without advertising all 20 to the model. No install or external service is needed to run the sample tests.

From this directory:

```bash
cd demo
npm test
pi --extension ../src/extension.ts
```

Alternatively, install the published extension in Pi and just run `pi` here. Configure Pi's OpenRouter authentication (or a compatible decision server) first; see the root README. Pi discovers `.pi/skills/` from this working directory. Run Pi **from `demo/`**, not the extension repository root. Do not set any skills to Always allowed if you want to see automatic selection clearly.

Try these prompts in separate fresh Pi sessions (`/new`), then inspect `/skill-picker history`:

- “Add a low-stock report for the catalog and test the reorder threshold.” (inventory + testing)
- “Add a coupon code to the checkout total and explain the rounding policy.” (pricing + checkout)
- “Write an accessible cart-empty state and update the storefront copy.” (accessibility + copy)
- “Draft a migration plan for changing the product JSON format.” (catalog + migrations)
- “Add an incident runbook for checkout failures and a release checklist.” (incident response + releases)

To record an animated terminal demo, follow the [VHS recording guide](../docs/record-demo.md).

The files under `src/` and `data/` are deliberately small, so demo prompts can lead to actual edits. The skills are instructions, not executable plugins; selection depends on the task and decision service. `npm test` verifies the starter app, not the ranking service.
