# acorn's relevant machinery as verified 2026-08-12

Design notes from the dashboards session (2026-08-12). Nothing here is scheduled. This is the
baseline the design in `data-contract.md` / `composition.md` / `placements.md` extends — what is
shipped, where it lives, and which parts were *decided* rather than merely unbuilt. The owning
docs for current behavior are `docs/plugins.md`, `docs/extensibility.md`, and `docs/data-layer.md`;
where this file drifts from those, those win. Paths and line numbers are hints, not contracts —
see the drift warning in `README.md`.

## The descriptor tier is the foundation

Loaded plugins never touch a client registry: the manifest (parsed with Zod in
`packages/node-core/src/main/pluginManifest.ts` — the authoritative contribution vocabulary) ships
in the roster (`GET /v2/core/plugins`), and the device turns rows into contributions
(`packages/client-core/src/plugins/chrome/register.ts` for descriptors,
`plugins/frames/register.ts` for iframes). Actions everywhere come from a **closed verb set**
(`PluginChromeAction`, `packages/protocol/src/api.ts:374-391`): `openPane`, `navigate`,
`runNodeAction`, `createTask`, `openUrl`, `openOverlay`, `surfaceAction`.

The descriptor data path lives in `packages/client-core/src/plugins/chrome/data.ts`:

- `ownsRoute` re-checks path confinement **on the device** — roster rows are untrusted wire.
- The host appends scoping (`?project=…`); a plugin cannot choose node or namespace.
- Readers (`readRailItems`, `readBadge`, `readAttention`, `readStat`) sanitize field-by-field;
  malformed rows are dropped and logged, never thrown into the shell.
- Freshness is **one shared revision signal for all chrome**, bumped by the WS status ping and one
  shared timer set to the minimum declared `refresh` across all descriptors. The `refresh` knob is
  Zod-bounded to 30s–86400s (`pluginManifest.ts:266`). A `ponytail:` note at `data.ts:64` says to
  split the signal per contribution only when a refetch cost shows up — dashboards are that cost
  showing up (`data-contract.md § Freshness`).

Rendering: `ChromeSourcePanel.tsx:20-25` states the descriptor argument this design leans on —
"Native by construction … a third-party rail list is pixel-identical to a first-party one under
every appearance pack … not the cost of an iframe, but that the iframe could never look like this."
A descriptor-only plugin ships no client bundle and therefore triggers **no trust prompt**.

## The precedents, and which one to copy

Three descriptor data shapes exist, deliberately distinct:

- `nodeStats` — one integer with a label. `attention` — a navigable row with severity and target.
  The comment at `registries/nodeStats.ts:11-14` explicitly refuses merging them: different shapes
  stay different contributions. A collections contract must not re-merge them; it is a *third*
  shape (typed records), not a superset.
- **`agentContexts` and `refResolvers` are the template.** Both follow the same pattern: the
  manifest declares routes; the host fetches, parses the response against a **real Zod schema in
  `@acorn/protocol`** (`agentContext.ts`, `refResolvers.ts`), and stamps provenance the plugin
  must not supply. `refResolvers.ts:12-19` carries the budget warning the field-type vocabulary
  inherits: every field added is a field EVERY provider's answer gets rendered with.
- `PluginRailItems` (`api.ts:518`) is the only generic list feed today, and it is **sniffed
  field-by-field, not schema-parsed** — the pattern *not* to repeat (`refused.md`).

The stated validation rule (`docs/architecture-overview.md`): Zod at mutation boundaries; reads
are not validated "because every consumer is TypeScript in this repo." The four existing
exceptions are exactly the plugin-boundary reads above — collections become the fifth, for the
same reason (untrusted wire, rendered by the host).

## The three data paths on the node

There is no single generic feed today; three shapes coexist, all record-shaped underneath:

1. **GitHub** — plugin-owned mirror tables in `plugins/github.sqlite`, served through
   `serveThenRevalidate` with TTLs from `plugins/github/src/server/syncPolicy.ts`.
2. **Rollbar** — core's generic external-item store (`issues`/`issue_resources`/`sync_state`, see
   `docs/data-layer.md § External-item read model`) via `MirroredResourceContribution`
   (`{ id, ttlMs, merge, key, read, refresh }`) and the provider resource runtime.
3. **Linear** — direct multi-connection fan-out, deliberately bypassing the engine.

The sync engine (`packages/node-core/src/server/sync/engine.ts`) is store-agnostic:
`serveThenRevalidate` serves fresh/stale from cache immediately, kicks a deduped backoff-aware
background refresh when stale, blocks only when cold. **Per-resource TTLs are plugin-owned**; the
only engine-owned policy left is the rate-limit backoff. Consequence for dashboards: a collection
route is a *projection* over data each plugin already mirrors — no new sync machinery.

## The client query layer

One `QueryClient` + IndexedDB persister **per node** (`packages/client-core/src/node/fleet.ts`;
defaults: `staleTime` 30s, `gcTime` 24h to outlive a session). Per-query overrides are the norm
(github PR list polls at 60s; blobs are `Infinity`). Fan-out is `createFleetQuery`
(`node/fanout.ts`): per-node 5s deadline, cache-as-fallback with a live/stale/offline vocabulary,
partial results are data not errors. Dashboard panels rendered through this machinery inherit all
of it for free. The key-sharing rule at `fanout.ts:27-36` (a fan-out may reuse a domain key only
if the value shape matches exactly) applies to panel query keys.

Remember the persisted-cache gotcha: the IndexedDB cache has no buster, so a persisted response
type gaining required fields needs a query-key bump.

## Home, FleetHome, and layout state

- **Home is a rail source, not a route** (`apps/desktop/src/app/client/sourceContributions.ts`,
  `order: 0`, `isDefault: true`), 49 deliberately thin lines
  (`packages/client-core/src/workspaces/Home.tsx` — "deliberately provider-neutral", a flat list
  of active tasks). The dashboard's default placement slots in here.
- **`FleetHome`** (`packages/client-core/src/node/FleetHome.tsx`) is the existing dashboard-shaped
  surface: a card per node composing a task-count fan-out, each `nodeStats` contribution, and the
  attention count, with a partial-availability banner. It is the card idiom to grow from.
- **There is no user-configurable dashboard/grid/widget layout anywhere.** The only
  user-arranged layout is per-task panes (`tasks/layout.ts` + `persistence/persistedState.ts`:
  versioned codecs, scopes, and the rule that matters here — **unknown pane ids survive inert**,
  so disabling a plugin never destroys a layout). `persistedState` deliberately has no manifest
  form; a loaded plugin's state story is the frame `state.get/set` prefs namespace. Dashboard and
  panel definitions are *host-owned* config, so they use core persistence, not plugin prefs.

## Shared components: what a dashboard needs vs what exists

The shared layer (`packages/client-core/src/ui`, exported via `@acorn/plugin-api/ui`) is large now:
the original nine primitives plus `Modal`/`Tabs`/`Picker`/`Icon`/`Menu`/`Popover` and roughly thirty
more components from the 2026-08 design-system migration. The pieces a dashboard grid needs —
**`Card`, `Table`, `EmptyState`, `StatusDot`, `Meter`** — all shipped; build on them rather than
around them. `skeleton` is the one that was never built (`EmptyState busy` covers whole-pane loading).
`.home-*` remains an undefined-class family.

The house rules those components are held to are enforced, not documented: pure presentation
(`tools/arch/boundaries.test.ts`), `.ui-*` classes with `data-*` variants and tokens only
(`styles/cssHygiene.test.ts`, `ui/tokenAxes.ts`), `cx()` class append and a ratcheted migration
ledger (`ui/adoption.test.ts`), and frame CSS distribution via
`apps/desktop/src/app/main/pluginFrameStyles.ts`.

## Hard gates any implementation hits

- **The plugin-api surface snapshot** (`packages/plugin-api/src/surface.snapshot.txt` +
  `surface.test.ts`): new exports fail until deliberately regenerated.
- **`tools/arch/boundaries.test.ts`**: protocol may declare no `/v2/p/` route; plugin-named
  protocol modules are an enumerated shrinking list; `client-core/src/ui` purity is enforced. A
  collections schema in protocol is core vocabulary (like `refResolvers.ts`), not plugin-named.
- **The manifest Zod vocabulary** (`pluginManifest.ts`) with per-array caps and the 30s–86400s
  refresh bound.
- **CSS hygiene**: token-only stylesheets, new tokens classified in `ui/tokenAxes.ts`.

## Verify before building

- Whether the chrome freshness model is still one shared revision + min-refresh timer
  (`chrome/data.ts`) — the per-panel refresh design assumes it is being split here.
- Whether `PluginRailItems` grew a schema in the meantime (if so, follow its pattern).
- Whether the external-item store shape or `MirroredResourceContribution` moved
  (`server/integrations/`) — the "collection route is a projection" claim depends on them.
- Whether Home is still a source and `FleetHome` still exists as the card precedent.
- All of `Card`/`Table`/`EmptyState`/`StatusDot`/`Meter` shipped; only `skeleton` did not. Build on
  them, don't duplicate.
- Whether the closed verb set gained verbs (each new verb widens what a panel row action can do).
  Note it grew deliberately since this was written: context menus, cooperative extension points
  and exclusive slots are now manifest vocabulary (`docs/plugins.md`) — plugin-hosted placements
  in `placements.md` must ride the shipped extension-point contract.
