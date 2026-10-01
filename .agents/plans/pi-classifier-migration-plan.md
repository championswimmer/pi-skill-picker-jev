# Pi 0.99.x classifier migration plan for `pi-skill-picker-jev`

## Conclusion

There **is** scope to move this extension toward Pi's new classifier path, but **not** as a clean one-shot replacement.

The realistic move is a **hybrid migration**:

- use Pi 0.99.x classifier APIs for the **default hosted Jev/OpenRouter path** when a matching classifier model is available in Pi, and
- keep the current direct HTTP decisions path for:
  - custom `apiBaseUrl`
  - explicit `apiToken`
  - older Pi versions
  - any case where classifier registration or score fidelity is missing

This preserves the extension's current product guarantees:

- fail closed
- keep non-selected skills hidden
- preserve Score-based rubrics and normalized thresholds
- preserve trigger behavior
- keep using the available OpenRouter credential through Pi (`ctx.modelRegistry.getApiKeyForProvider("openrouter")`) when no custom endpoint/token is configured

## What Pi 0.99.x added

Verified against local Pi 0.99.2 docs/examples/types.

### New classifier support in Pi

Pi now exposes classifier models as a first-class model type alongside chat and image models.

Relevant APIs and docs:

- `docs/custom-provider.md`
- `docs/virtual-models.md`
- `examples/extensions/jev-router.ts`
- `dist/core/model-registry.d.ts`

Key capabilities:

- `ctx.modelRegistry.findOfType("classifier", provider, modelId)`
- `ctx.modelRegistry.getModelsOfType("classifier", provider?)`
- `ctx.modelRegistry.getAvailableOfType("classifier", provider?)`
- `ctx.modelRegistry.classify(model, context, options)`

Observed type contract from `dist/core/model-registry.d.ts`:

- `classify(model, context, options)` returns a `ClassifierResult`
- `ClassifierResult` includes:
  - `answers`
  - `usage?`
  - `stopReason`
  - `errorMessage?`
- classifier questions support at least:
  - `choice`
  - `score`
  - `bool`

### Provider/model registration support

Pi can register classifier models through providers.

From `docs/custom-provider.md` and type definitions:

- provider models can include `type: "classifier"`
- provider implementations can expose a `classifiers` map keyed by `api`
- `pi.registerProvider(name, config)` can register classifier-capable providers

Important constraint:

- supplying `models` for an existing provider replaces that provider's extension-provided model list for chat/image/classifier operations
- because of that, registering classifier support under the existing `openrouter` provider is risky unless done very carefully

### Working example in Pi docs

`examples/extensions/jev-router.ts` shows the intended pattern:

- find a classifier model:
  - `ctx.modelRegistry.findOfType("classifier", "typesafe", "jev-latest")`
- call it via:
  - `ctx.modelRegistry.classify(...)`
- use the result to guide runtime behavior

That proves classifier APIs are real and usable in extensions.

## What this repo does today

### Candidate gathering and filtering

Main file:

- `src/extension.ts`

Current behavior:

- source of truth is `event.systemPromptOptions.skills`
- candidates are filtered to:
  - remove `disableModelInvocation`
  - dedupe by skill name
- selected skills are restored from session history and allowlist only if still present in the live Pi inventory
- the extension replaces only the skills section and **never** falls back to the full skill catalog on failure

### Current skill ranking/classification flow

Main files:

- `src/decision.ts`
- `src/picker.ts`
- `src/triggers.ts`
- `src/settings.ts`

#### Request path today

`src/decision.ts`:

1. read settings
2. resolve auth precedence:
   - `settings.apiToken`
   - else custom `settings.apiBaseUrl` (may be unauthenticated)
   - else `ctx.modelRegistry.getApiKeyForProvider("openrouter")`
3. call `rankSkills(...)`

`src/picker.ts`:

- builds batched Score questions
- sends requests to either:
  - `https://openrouter.ai/api/alpha/decisions`, or
  - `${apiBaseUrl}/v1/systemone`
- uses Score rubrics for:
  - task usefulness
  - topic search usefulness
  - global importance
- normalizes `score / (criteria.length - 1)`
- applies threshold
- sorts descending
- caps to `maxNew`
- fails closed on malformed answers or request failures

#### Triggering behavior

`src/triggers.ts`:

- reruns ranking only when configured trigger conditions are met
- modes:
  - `prompt-only`
  - `prompt-and-tools`
  - `every-request`
- ignores unchanged retries and streaming noise

#### Current auth/security behavior

`src/settings.ts` and `src/decision.ts` preserve an important rule:

- **never leak Pi/OpenRouter credentials to custom endpoints**

That is a requirement to preserve through any migration.

## Migration options assessed

### Option A — stay fully on direct HTTP

Pros:

- zero behavior change
- easiest to preserve auth precedence, batching, and custom endpoint support
- explicit control over headers, redirects, timeouts, and usage logging

Cons:

- does not adopt Pi classifier infrastructure
- duplicates logic Pi can now host centrally

### Option B — full rewrite to `modelRegistry.classify(...)`

Not recommended as the first step.

Why:

- this repo depends on current decisions semantics and performance:
  - Score rubrics
  - batched questions
  - thresholdable numeric results
  - auth override rules
  - custom `/v1/systemone` endpoint support
- Pi's classifier APIs are clearly present, but a full drop-in replacement is not yet proven for this exact extension behavior

Main unknowns to confirm before a full cutover:

- identical Score output semantics
- efficient multi-candidate batching at current sizes
- usage/cost data parity
- clean support for explicit token override and custom base URL

### Option C — hybrid backend selection

**Recommended.**

Behavior:

- use Pi classifier path when all of the following are true:
  - no custom `apiBaseUrl`
  - no explicit `apiToken`
  - Pi runtime exposes classifier APIs
  - desired classifier model is discoverable in Pi
- otherwise use today's direct HTTP path

Pros:

- preserves current extension behavior
- lets the default hosted Jev/OpenRouter path move closer to Pi-native classifier plumbing
- keeps custom TypeSafe-compatible endpoints working unchanged
- keeps fail-closed behavior intact

Cons:

- two code paths to test
- requires careful normalization so both backends behave identically

## Auth implications

## Can Pi classifier calls reuse Pi/OpenRouter auth?

**Yes, for the default hosted path** — if the classifier model is registered in Pi under a provider whose auth Pi already resolves.

That matches the user's desired behavior of continuing to use the available OpenRouter credential:

- Pi-managed auth
- environment-backed auth
- `OPENROUTER_API_KEY` where Pi resolves it

## Can Pi classifier calls preserve current auth precedence exactly?

**Not by themselves.**

The hard cases are:

- `settings.apiToken` must override Pi auth
- `settings.apiBaseUrl` may be custom and unauthenticated
- custom endpoints must never inherit Pi's OpenRouter credential

Because `modelRegistry.classify(...)` resolves auth through the model's provider registration, a pure classifier-only approach does **not** naturally preserve today's per-call direct auth override behavior.

## Practical recommendation on auth

Keep current auth routing in `src/decision.ts`:

- `apiBaseUrl` set -> use direct HTTP path
- `apiToken` set -> use direct HTTP path
- neither set -> prefer Pi classifier path
- if classifier model is unavailable -> fall back to today's direct OpenRouter decisions path using `ctx.modelRegistry.getApiKeyForProvider("openrouter")`

Also keep this rule:

- do **not** add direct OpenRouter env reads in the extension
- let Pi continue to own provider auth resolution for the default hosted path

## Recommended architecture

Introduce a backend/transport abstraction while keeping ranking semantics centralized.

### Shared semantics remain in `src/picker.ts`

Keep shared logic for:

- rubric definitions
- question construction
- answer validation
- score normalization
- thresholding
- sorting
- `maxNew`
- fail-closed filtering

### Backend selection moves to `src/decision.ts`

Add deterministic routing between:

- `direct-decisions`
- `pi-classifier`

### Proposed internal split

Possible structure:

- `src/picker.ts`
  - shared question builder + normalization helpers
- `src/decision.ts`
  - choose backend based on settings/runtime capabilities
- optional new file `src/classifier-backend.ts`
  - Pi classifier adapter
- optional new file `src/direct-backend.ts`
  - existing HTTP implementation extracted from `picker.ts`

The key design rule is:

- backend choice must **not** change the extension's meaning of scores

Both backends should normalize to the same internal shape, e.g.:

```ts
Record<string, { type: "score"; score: number }>
```

## Phased implementation plan

### Phase 0 — baseline/version prep

Files:

- `package.json`

Tasks:

- bump dev dependency baseline from `@earendil-works/pi-coding-agent@0.87.1` to a `0.99.x` line for local typechecking and tests
- keep runtime feature detection if backward compatibility still matters

Why:

- this repo currently develops against Pi 0.87.1, but classifier APIs being considered are from 0.99.x

### Phase 1 — prove classifier compatibility before changing defaults

Files:

- temporary spike code/tests only

Tasks:

- verify that the target classifier model can express the current 5-level Score rubrics
- verify result shape and usage metadata from `modelRegistry.classify(...)`
- verify batched multi-question behavior is acceptable for current skill counts
- verify latency/cost is acceptable relative to current direct decisions path

Decision gate:

- if Score fidelity or batching behavior is materially worse, stop here and keep direct HTTP as the canonical production path

### Phase 2 — isolate ranking semantics from transport

Files:

- `src/picker.ts`

Tasks:

- extract question/rubric builders from raw fetch logic
- extract answer validation/normalization from transport code
- preserve all current tests for normalization and fail-closed behavior

Goal:

- adding the classifier backend should not require re-deriving score semantics

### Phase 3 — add backend selection in `src/decision.ts`

Files:

- `src/decision.ts`

Tasks:

- select backend using this rule order:
  1. `apiBaseUrl` -> direct HTTP
  2. `apiToken` -> direct HTTP
  3. else if Pi classifier model available -> Pi classifier
  4. else -> direct OpenRouter decisions path via Pi-resolved OpenRouter key
- preserve current timeout and `requireKey` behavior
- preserve no-leak rule for custom endpoints

### Phase 4 — implement Pi classifier adapter

Files:

- new `src/classifier-backend.ts` or equivalent
- possibly `src/picker.ts`

Tasks:

- resolve classifier model from Pi:
  - likely with `ctx.modelRegistry.findOfType("classifier", provider, modelId)`
- call `ctx.modelRegistry.classify(...)`
- map its answers into the same normalized score contract used by the direct path
- preserve cancellation/abort handling
- capture usage data when Pi returns it

Important note:

- ship this only if it preserves Score semantics; otherwise keep it as an experimental or opt-in path

### Phase 5 — keep custom endpoint path unchanged

Files:

- `src/settings.ts`
- `src/decision.ts`
- maybe extracted direct backend file

Tasks:

- preserve `apiBaseUrl`, `apiToken`, and `model`
- preserve custom no-auth server behavior
- preserve redirect rejection and invalid URL fail-closed handling
- preserve the guarantee that Pi's OpenRouter credential is never sent to a custom endpoint

### Phase 6 — tests

Files:

- `test/api-wiring.test.ts`
- `test/picker.test.ts`
- `test/score.test.ts`
- `test/modes-integration.test.ts`
- `test/kev-live.test.ts`

Add or update tests for:

- backend selection rules
- classifier-available vs classifier-missing fallback
- explicit `apiToken` still bypasses Pi auth
- custom `apiBaseUrl` still never inherits Pi auth
- Score rubrics and normalized thresholds unchanged
- fail-closed behavior unchanged
- trigger behavior unchanged
- usage reporting still correct where available

### Phase 7 — docs and maintainers notes

Files:

- `README.md`
- `AGENTS.md`
- `docs/scoring-research.md`
- any settings/help text surfaced by `/skill-picker settings`

Tasks:

- document hybrid backend behavior
- document that default hosted ranking may use Pi classifier APIs on Pi 0.99.x+
- document that custom endpoint/token settings still force the direct decisions path
- document that auth still comes from Pi/OpenRouter when no explicit override is configured

## Risks and unknowns

1. **Score fidelity mismatch**
   - biggest risk
   - if classifier results do not match today's 5-level rubric behavior, a full migration is not acceptable

2. **Performance mismatch**
   - current code assumes large batched ranking
   - a per-skill classifier path would likely be too slow/costly

3. **Provider/model naming mismatch**
   - current defaults are `typesafe/jev-1.13` and `jev-latest`
   - Pi classifier provider IDs and model IDs may differ

4. **Usage accounting differences**
   - current direct path logs usage when the endpoint returns it
   - Pi classifier path may expose different or less detailed usage fields

5. **Version skew**
   - current dev baseline is `0.87.1`
   - new code may need feature detection or a deliberate minimum Pi version bump

6. **Provider-registration complexity**
   - a later fully Pi-native path for custom endpoints may require registering a dedicated classifier provider instead of using direct fetch
   - that is a larger step and should not block the first migration

## Recommendation

Implement the **hybrid migration**, not a full rewrite.

### Production recommendation

- keep direct HTTP as the compatibility path
- add Pi classifier as the preferred path only for the default hosted Jev/OpenRouter case
- preserve all current auth and fail-closed semantics

### Specific rule to keep

For the default hosted path, continue relying on:

- `ctx.modelRegistry.getApiKeyForProvider("openrouter")`

rather than reading `OPENROUTER_API_KEY` directly in the extension.

That keeps provider auth inside Pi, while still allowing environment-backed OpenRouter auth to work.

## Files most likely to change

Primary:

- `package.json`
- `src/decision.ts`
- `src/picker.ts`
- `src/settings.ts`
- `test/api-wiring.test.ts`

Likely additional updates:

- `test/picker.test.ts`
- `test/score.test.ts`
- `test/modes-integration.test.ts`
- `test/kev-live.test.ts`
- `README.md`
- `AGENTS.md`
- `docs/scoring-research.md`

## Short decision summary

- **Yes, there is migration scope.**
- **No, this should not be a hard cutover yet.**
- **Best path: hybrid backend selection with Pi classifier preferred only for the default hosted path, and direct HTTP retained for overrides/custom endpoints/fallbacks.**
