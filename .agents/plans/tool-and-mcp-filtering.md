# Plan: Jev filtering for Pi tools and MCP servers

Status: proposed implementation plan; no runtime changes in this document.

## 1. Goal and recommended scope

Extend the existing skill picker with optional tool selection, preserving current skill behavior and the `/skill-picker` entry point. Users choose:

- **Off** (default for existing installations): current tool behavior is unchanged.
- **Tool level**: Jev selects individual Pi tools and individual MCP operations.
- **MCP level**: Jev selects entire MCP servers; all eligible operations of a selected server become available, and none from an unselected server do. Ordinary non-MCP tools are unchanged in this mode.

Provide durable “always allow” choices for tools and servers, with explicit **all projects/all sessions** and **this project/all sessions** scopes. These choices bypass relevance ranking, not authentication, project trust, disabled-server settings, or other safety restrictions.

This is context/availability management, **not a security sandbox**. Shell/network tools and other extensions retain their own powers. Do not advertise the picker as preventing all access to an external service.

## 2. Research findings

Research baseline: installed Pi 0.87.1 and local `pi-mcp-adapter` 3.1.0. Recheck contracts against the versions used during implementation.

### Pi exposes more than a prose tools section

- `pi.getAllTools()` supplies registered tool names, descriptions, parameter schemas and prompt metadata. Registration does not imply permission to enable a tool: preserve the user's existing eligible/active baseline separately.
- `pi.getActiveTools()` and `pi.setActiveTools(names)` are supported activation APIs. Unknown names are ignored. The official `examples/extensions/tools.ts` persists names in custom session entries and restores only the active branch; `dynamic-tools.ts` demonstrates registration after startup.
- `before_agent_start` exposes `systemPromptOptions.selectedTools`. Pi reconciles explicit edits with calls to `setActiveTools()`; an explicit selected-tools edit wins. Prefer one activation path rather than competing writes.
- Pi's leading system message declares the initial tool schemas. Subsequent system messages carry `toolsAdded` / `toolsRemoved`; replay determines the current provider-visible loadout. Providers lacking incremental tool support receive a complete checkpoint, potentially invalidating a cached prefix.
- Executable implementations are separately carried in `agent.state.tools` / request `context.tools`. Editing prompt text or schemas alone does not reliably synchronize execution availability.
- Ordinary `context` handlers cannot own system/tool state: Pi restores system messages around their output. `context_with_system` sees the complete transcript and can change it, but must retain the leading system message and preserve unrelated sections.
- Follow-up requests refresh active tools through Pi's next-turn preparation. The exact timing of a `setActiveTools()` call inside `context_with_system` must be verified: the current request may already contain a snapshot of executable tools. Do not assume the existing skill-section rewrite can simply be copied for tools.

**Consequence:** use supported activation/loadout APIs, not regex removal of tool descriptions or provider-specific JSON surgery. Gate implementation on real request/execution tests for initial and follow-up requests.

### MCP has several model-facing access paths

The local adapter exposes a generic `mcp` gateway, `mcpScript`, server namespace proxies such as `mcp__exa`, and supports direct tool exposure. Namespace tools forward to `executeCall`; the gateway exposes search, describe, server listing, instructions, connection and call operations. Script helpers provide another discovery/execution surface.

Pi's `getAllTools()` sees registered wrappers, not necessarily every underlying MCP tool. A generic gateway's schema cannot tell the picker the complete server inventory or enforce per-operation selection.

The adapter has versioned runtime registration/snapshot events, but the inspected snapshot interface concerns an individual runtime server definition. It is **not** a complete, secret-free inventory and selection-policy contract. Do not reuse server definitions as Jev input: these may contain credentials or environment configuration.

**Consequence:** correct MCP filtering requires adapter cooperation. Hiding a namespace tool while leaving unrestricted gateway/script access is not MCP filtering. Do not parse JavaScript to detect disallowed script calls, infer ownership from tool-name prefixes, or read private adapter caches as a permanent API.

### Existing implementation to reuse

- `src/extension.ts`: inventory, selection lifecycle, branch restoration and skill-section preservation.
- `src/picker.ts`: Decisions `noul` ranking, batches of 50, up to six concurrent requests, default model `typesafe/jev-1.13`, bounded `transcriptText`, and fail-closed ranking. Batch failure throws; it does **not** select the catalog.
- `src/decision.ts`, `src/status.ts`, `src/usage-log.ts`: authentication, transient UI and usage accounting. Audit current helper boundaries before extracting a shared ranking abstraction.
- `src/settings.ts`, `src/always-allowed.ts`, `src/always-allowed-ui.ts`, `src/history.ts`: atomic persistence, searchable allowlists and branch-aware history.

### Source references

Paths below are relative to the installed packages, not new dependencies on private implementation files:

- [Pi extension contracts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md), especially dynamic tool activation and context transforms.
- [Pi tool-selector example](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/tools.ts) and [dynamic tools example](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/dynamic-tools.ts).
- Pi `dist/core/agent-session.js`: `_installAgentRequestProjection`, `_installAgentNextTurnRefresh`, `_rebuildSystemPrompt`, `_preparePromptAndToolLoadout`, and `before_agent_start` reconciliation.
- Pi `dist/core/extensions/runner.js`: `emitContext`; `dist/core/extensions/types.d.ts`: `ToolInfo`, activation API and event contracts.
- Bundled `@earendil-works/pi-ai/dist/types.d.ts`: `SystemMessage`, `toolsAdded`, `toolsRemoved`; bundled `pi-agent-core/dist/agent-loop.js`: executable tool lookup.
- Local `pi-mcp-adapter/{index.ts,namespace-tools.ts,proxy-modes.ts}`: runtime events, namespace registration, gateway dispatch and `executeCall`.
- Pi `docs/tui.md`: custom UI lifecycle, focus, bounded rendering and non-TUI behavior.

Upstream links may move; installed versions were the source of truth for this research.

## 3. Settings and durable allowlists

Keep existing settings and filenames backward compatible. Proposed additive settings in `<Pi agent dir>/pi-skill-picker-jev.json`:

```json
{
  "threshold": 0.75,
  "maxNew": 6,
  "triggerMode": "prompt-and-tools",
  "toolFiltering": {
    "mode": "off",
    "threshold": 0.75,
    "maxNewTools": 6,
    "maxNewServers": 2,
    "triggerMode": "prompt-and-tools"
  }
}
```

Numbers are initial defaults to validate with benchmarks, not measured optimal values. Parse invalid fields independently. Explain that server caps count **servers**, not their child tools. Never silently truncate a selected server in MCP-level mode; warn about very large server catalogs instead.

Store global allowlists in a new `<Pi agent dir>/pi-skill-picker-jev-allowlist.json`. Extend the existing project `<cwd>/.pi/skill-picker-jev.json` while retaining `alwaysAllowed` for skills:

```json
{
  "alwaysAllowed": ["existing-skill"],
  "alwaysAllowedTools": [
    { "kind": "pi", "name": "read" },
    { "kind": "mcp", "server": "docs", "tool": "search" }
  ],
  "alwaysAllowedMcpServers": ["docs"]
}
```

Use the same shape in both files; global skill pins are an additive capability, not a migration of existing project pins. Effective pins are the union of global and project pins. UI must show the source and allow editing/removing global pins explicitly; unchecking a project row must not pretend to remove a global pin. All writes are atomic and preserve unrelated valid fields.

Use structured identities to avoid separators and duplicate-name collisions. Ask the adapter for stable server identity metadata; warn when a same-named server binding changes. Global pins to a server name must not implicitly authorize a newly configured endpoint. Eligibility/trust still wins. Keep stale pins visible as unavailable, but never activate missing tools or initiate connections just because a stale name exists.

### Granularity and precedence

1. Apply upstream registration, explicit enablement, project trust, auth and disabled-server constraints.
2. Preserve eligible essential ordinary tools in tool mode (initially `read`, `bash`, `edit`, `write` when already enabled); expose this baseline in the UI. These are usability defaults, not newly granted permissions.
3. Apply persistent pins, then eligible branch-restored selections, then new Jev selections.
4. Server pins expose every eligible child in either mode. Tool pins expose only that tool in tool mode.
5. In MCP mode, an individual MCP tool pin necessarily pins its **whole parent server**. Display and confirm this implication when switching modes; never create a partially selected server in MCP mode.
6. In off mode, withdraw only picker-owned restrictions; never enable everything in the registry.

Selection is additive within an active session branch, like skills. New sessions start from baseline + durable pins. Branch navigation restores that branch's additions only. Explicit reset, mode changes or pin removal may shrink the loadout at an idle boundary; a separate Jev selection can still keep an unpinned capability active, which the UI must explain.

## 4. Inventory and adapter integration

Introduce a normalized inventory layer with explicit kinds (`pi-tool`, `mcp-tool`, `mcp-server`), stable identity, bounded description, registration/execution mapping, eligibility, schema fingerprint and inventory revision. Keep full JSON schemas local; scoring usually needs the description and a short parameter summary, not a full schema.

### Proposed adapter contract — must be implemented, not assumed available

Add a versioned public bridge, for example `pi-mcp-adapter:selection-policy:v1`, with a handshake and capability advertisement:

- Get a **sanitized inventory snapshot**: eligible server IDs, labels/descriptions, child operation IDs/descriptions, registered Pi wrapper mappings, inventory revision and completeness state. No URLs with secrets, auth headers, environment values or server launch definitions.
- Publish inventory-change notifications after registration, reconnect, removal, tool-list changes and trust/config updates.
- Install/replace a **session-scoped policy** with owner token, generation, mode and allowed server/tool identities. Acknowledge successful application. Compose by intersection with other restrictions; do not overwrite another extension's policy.
- Dispose the policy explicitly on disable/shutdown/reload; never persist task-selected tools into MCP configuration. Ensure lifecycle transitions cannot expose an unrestricted catalog while filtering remains enabled.
- Apply the same predicate to direct tools, namespace calls, gateway calls and every script helper. Filter discovery, schema lookup, server listings/counts, status summaries, suggestions and server instructions as well as execution. A denied exact-name call returns a concise unavailable error without revealing its hidden schema.
- Recheck policy immediately before dispatch, including reconnect and script fan-out. Give each request an immutable policy generation; do not race policy removal against in-flight sibling calls.

Generic `mcp` / `mcpScript` wrappers remain transport tools only when they serve selected capabilities. Their descriptions must not list excluded servers. They must not themselves be ranked as unrelated domain capabilities. Keep user-facing administrative commands available for manual connection/auth/setup, while model-facing install/connect/auth paths cannot automatically expose hidden servers or bypass selection. Filter later discovery updates before publication.

Do not connect every MCP just to rank it. Prefer sanitized cached metadata; unknown/incomplete inventory is explicit state. Offer user-triggered refresh. For large server catalogs, rank bounded deterministic chunks and aggregate server relevance (maximum child-chunk score is a practical initial rule); include every child across chunks to avoid losing tools at the end of a truncation. Document and measure that this is a heuristic, not a calibrated probability.

### Compatibility fallback

Without a compatible bridge, ordinary non-MCP tool filtering can still work. Show MCP filtering as unsupported and refuse to enable that mode; leave the prior configuration unchanged. If an enabled bridge disappears mid-session, restrict adapter-owned model access until recovery or explicit disable, with a clear notification. Do not label namespace-only hiding as complete MCP filtering.

Other MCP extensions need equivalent public adapters. Do not guess ownership from names and accidentally hide unrelated tools.

## 5. Jev decision design

Extract reusable bounded Decisions batching without changing skill prompts or results. Separate candidate prompts:

- Tool mode: “Would this operation be directly useful for the current task?” Include canonical identity, bounded description and sanitized parameter summary.
- MCP mode: “Would access to this server's capabilities be directly useful for the current task?” Include bounded server capability summaries/chunks. Select the entire eligible server after aggregation.

Reuse Pi OpenRouter authentication, existing model override, `noul` validation, deterministic sorting/ties, timeout/cancellation and `transcriptText`. Never send server config, credentials, full tool output or hidden full catalogs to the main model. Tool descriptions are untrusted data, not instructions to Jev.

Maintain separate thresholds/caps for skills, tools and servers. Allowlisted/baseline/already selected candidates cost no ranking request and do not consume `maxNew`. A server selection may expose many tools; show both counts. Share a global concurrency limiter across skill/tool decisions so enabling both does not double the existing six-request ceiling.

Cache decisions by bounded task snapshot, inventory/schema revision, mode and settings. Avoid reranking unchanged retries and streaming updates. Reuse the existing trigger semantics, but keep skill and tool state independent. Additions can happen after completed textual tool results; newly registered tools remain hidden until eligible and selected.

On missing key, timeout, malformed response or batch failure: retain only baseline, valid pins and prior valid selections. Never fall back to the full catalog. Commit no partial new selection from a failed decision round, although successful priced batches must still be logged. Preserve the pi-stats sidecar schema and ensure each batch is charged/logged once; use separate history entries for domain attribution rather than breaking usage consumers.

## 6. Pi loadout coordination and state

Create one coordinator responsible for the effective loadout and adapter policy. Track user/upstream eligibility separately from picker output; using the current filtered active list as the next inventory would permanently lose candidates. Conversely, `getAllTools()` must not resurrect deliberately inactive tools.

- Initial decision: rank in `before_agent_start`, install restrictive adapter policy first, then activate the computed Pi tool names before Pi constructs its prompt/loadout transition.
- Follow-ups: prove a supported pre-request boundary that completes ranking and updates both execution implementations and provider-visible declarations for **that** request. Test `turn_end`/next-turn preparation for tool-result triggers. For every-request mode, retries and steering, inspect the actual request snapshot ordering.
- If public hooks cannot atomically update both surfaces in time, propose a small upstream Pi pre-request loadout hook. Ship prompt-only tool mode first; do not claim every-request support by mutating a captured tool list too late.
- Preserve unrelated system sections, guidelines and skill filtering. Pi should generate loadout deltas/checkpoints. Do not rewrite historical assistant/tool results to erase old tool names; selection affects future availability, not deletion of past conversation content.
- Serialize policy/loadout changes, reject stale async decisions after session/branch changes, and handle cancellation with `finally` cleanup.
- Define explicit coexistence with manual `/tools` and other selectors. Without a composable eligibility API, document one activation owner and surface conflicts rather than last-writer-wins surprises.

Persist new versioned custom entries (e.g. `capability-picker-add`) containing kind, canonical identity, score, turn, step, threshold and inventory fingerprint. Do not persist schemas/descriptions/secrets. Read only `getBranch()` and validate against current inventory and policy. Leave legacy `skill-picker-*` entries unchanged. Clear transient state on session replacement/reload.

## 7. User experience

Extend `/skill-picker` with sections for Skills, Tool filtering, Always allowed and History. Keep existing commands/settings working; optional `/tool-picker` can be an alias later.

- Mode selector with plain descriptions of tool vs whole-server selection.
- Separate tool/server thresholds and addition caps; explain additive session behavior.
- Searchable allowlist with kind, server grouping, source scope and unavailable entries.
- “Always allow in this project” and “Always allow across all projects” actions, visibly distinct from “enable for this session”. Server selection shows affected child count.
- Reuse per-opening global-importance caching and explicit Jev refresh, adapted to operation/server prompts; do not rescore on every keystroke.
- Current availability shows baseline/pin/Jev reasons and blocked-upstream reasons. History displays server decisions as one group with the resulting tool count.
- Temporary picking status and concise failures; clean up status in `finally`.
- Provide non-TUI command arguments for mode and pin management. Never require custom terminal UI in RPC/print/JSON modes.

## 8. Implementation sequence and release gates

### Phase 0 — contract proof

Build minimal integration fixtures against Pi 0.87.1 and adapter 3.1.0. Capture actual provider requests and execution attempts on initial/follow-up requests. Establish eligibility ownership and lifecycle timing. Write an adapter API proposal and determine whether a Pi hook is needed. **Gate:** no full implementation until provider declarations and executable state can remain synchronized.

### Phase 1 — ordinary Pi tools

Add `capability-inventory.ts`, `tool-policy.ts`, shared Decisions batching, additive settings and global/project allowlist helpers. Implement opt-in prompt-only filtering for non-MCP tools, baseline protection, branch-aware entries and headless controls. Existing skill tests must remain unchanged in behavior.

### Phase 2 — coordinated MCP policy

Implement and test the public bridge in the adapter repository; publish a compatible adapter version. Add `mcp-bridge.ts` here with handshake/version checks. Implement tool-level and whole-server selection with complete route coverage and inventory invalidation. Never modify the installed adapter as the deliverable.

### Phase 3 — follow-up triggers and UI

Add supported tool-result/every-request scheduling after the timing proof or required upstream hook lands. Extend allowlist/history/settings UI, conflict reporting and selection explanations.

### Phase 4 — validation and documentation

Run `npm run typecheck` and `npm test`, plus real Pi smoke tests. Update README with everyday setup, mode semantics and compatible adapter versions; keep architecture/persistence detail in `AGENTS.md`. Release with filtering off by default and an explicit opt-in prompt. No migration should activate tools or connect MCPs.

## 9. Test matrix and acceptance criteria

- **Granularity:** tool mode exposes only selected operations; MCP mode exposes every eligible child or none. A huge selected server is not partially exposed by `maxNewTools`.
- **Every MCP route:** hidden server/tool absent from direct registrations, namespace descriptions, gateway search/list/status/describe/instructions/suggestions, script discovery and script invocation. Exact-name calls and already-known names cannot bypass policy.
- **Actual provider payloads:** verify schemas and snippets, not only event mocks; cover an incremental-loadout provider and a checkpoint/fallback provider, with retained conversation/tool-result validity.
- **Execution synchronization:** initial prompt, tool-result follow-up, steering, retry, abort, compaction, cache warming, parallel calls and reload. No new tool visible before executable; no hidden operation executable through the bridge.
- **Persistence:** restart/new session respects both pin scopes; branch fork/tree restoration cannot leak sibling selections; stale/renamed/disabled tools remain unavailable; global unpin and project unpin behave honestly.
- **Failures:** no key, deadline, invalid score, one failed batch, unavailable bridge, changing inventory, auth failure and malformed settings all preserve restrictive behavior. Off mode genuinely remains a no-op.
- **Composition:** manual tool disable, another selector, new registrations, protected ordinary tools and adapter reconnect cannot silently widen eligibility.
- **Privacy/accounting:** bounded Jev payloads exclude connection secrets; priced empty-result batches log once; sidecar schema and legacy skill history still work.
- **Performance/quality:** compare unfiltered vs tool vs server mode for main-model schema tokens, Jev cost, decision latency, cache invalidation and task completion on representative coding/browser/search tasks. Record false exclusions; server mode should trade finer filtering for fewer decisions, not claim guaranteed token savings.

Done means both model context and all supported adapter routes obey the same chosen granularity, persistent pins work across sessions, old skill behavior remains intact, and unsupported environments report limitations rather than pretending to filter.
