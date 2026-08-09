# Phase 4 — Declarative chrome

**Size: M.** Requires Phase 2; independent of Phase 3 (can run in parallel). After this phase a
plugin can put an icon in the left rail with a live list, a badge in the bottom taskbar, rows in
the command palette and attention inbox, and a number on a fleet node card — **without loading
any plugin UI code**. The host renders everything natively from descriptors; data comes from the
plugin's node half.

## Principle

Rectangles get frames (Phase 3); chrome gets descriptors. An iframe for a 20px footer badge is
absurd, and descriptors keep small chrome pixel-identical to native because the host draws it
with its own components and tokens. Equally important: a badge must be live when **no plugin
frame is mounted anywhere**, so its data cannot come from plugin UI code — it comes from the
plugin's node half, which is always running. Node owns data, renderer renders: the same shape as
everything else in acorn.

## Manifest schema

The `contributions` block of `acorn-plugin.json` (declared in Phase 1, consumed here). All fields
are static data or route paths into the plugin's own namespace:

```jsonc
"contributions": {
  "sources": [{
    "id": "board",                       // stable persisted key, host-verified unique
    "label": "Board",                    // SourceContribution.label
    "glyph": "kanban",                   // SourceContribution.glyph — Lucide icon NAME as a
                                          // string, resolved client-side, exactly how
                                          // glyph/tasks.icon already work
    "order": 60,                         // REQUIRED. Rail position is declared, never derived
                                          // from plugin load order (see the comment block in
                                          // registries/sources.ts for why)
    "providerId": "board",               // optional: gate the source on a connected integration
    "items": "/v2/p/board/rail-items",   // GET → { items: RailItem[] }
    "onSelect": { "openPane": "board" }  // action vocabulary, below
  }],
  "slots": [{
    "id": "board-footer",
    "slot": "footer",                    // enumerated host slots; start with "footer"
    "icon": "kanban",
    "data": "/v2/p/board/badge",         // GET → { text, tone?, tooltip? } | null (null = hidden)
    "onClick": { "openPane": "board" }
  }],
  "palette": [{
    "id": "board.new-card",
    "title": "Board: new card",
    "action": { "invoke": "new-card" }   // RPCs into the plugin's frame, mounting if needed
  }],
  "attention": [{
    "id": "board-stuck",
    "items": "/v2/p/board/attention"     // GET → { items: AttentionItem[] } per node
  }],
  "nodeStats": [{
    "id": "board-count",
    "data": "/v2/p/board/stat"           // GET → { label, value }
  }]
}
```

Route rules: every referenced path must be inside the plugin's own `/v2/p/<id>/` namespace —
validated at manifest parse. Response shapes are host-defined wire types (add them to
`@acorn/plugin-api` so plugin node halves type their handlers); host validates responses
defensively (a malformed row is dropped and logged, never thrown into the shell).

## Host adapters

One adapter module per target registry, living beside the client plugin host
(`packages/client-core/src/registries/plugin.ts` neighborhood). Each walks accepted manifests
(Phase 2 roster) and registers a **generic** contribution into the existing registry:

- `sources` → `registries/sources.ts`. The generic source renders native rows from the `items`
  route. Row shape `{ id, title, subtitle?, icon?, badge? }`. Selection executes `onSelect` with
  the row id appended (frame query param `item=<id>` for `openPane`). Descriptor fields map onto
  the real contribution: `label`, `glyph`, `order` (required), `providerId` (optional gate).
  A descriptor source contributes no `routes`: `SourceRouteContribution` kinds are `project`,
  `create`, `browse`, and `detail`, and the first two are core-owned URLs (`/p/:projectId`,
  `/p/:projectId/new` — `apps/desktop/src/app/client/sourceContributions.ts`). A plugin claiming
  them would take over project navigation for the whole shell. If descriptor sources later want
  deep links, give them `browse`/`detail` under a host-minted path prefix, never the two core
  kinds.
- `slots` → `registries/slots.ts` / `uiSlots.tsx`. The generic footer badge is a native
  component fed by the `data` query; `null` body hides it. The precedent for a plugin footer
  badge is `docker-footer-badge` (named in `registries/plugin.ts` comments as a persisted key —
  same stability rule applies to third-party slot ids).
- `palette` → `registries/paletteRows.ts`. Static rows; `invoke` actions route through the
  Phase 3 bridge (mount the plugin's primary frame if none is up, then send
  `{ kind: 'invoke', id }`). If Phase 3 hasn't landed, palette entries limited to
  `openPane`/`runNodeAction` still work — don't block this phase on it.
- `attention` → `registries/attention.ts`; fetched per node like existing attention sources.
- `nodeStats` → `registries/nodeStats.ts`.
- `projectImporters` → **deliberately not a descriptor surface.** Import flows carry provider
  auth, a browsable candidate list, and a clone/map/defer decision — richer than rows plus a fixed
  action vocabulary, and every attempt to express it declaratively grows the vocabulary until it
  is a UI framework. Importers are sandboxed frames; see phase 3.

All adapters register through the same host pass so disposal works: when a plugin is disabled or
its winning bundle changes at boot, its chrome unregisters with everything else.

## Data flow and freshness

- Every route binds through the existing per-node query cache
  (`packages/client-core/src/queries.ts`), keyed
  `['plugin-chrome', nodeId, pluginId, contributionId]`. It inherits the status model
  (`live/refreshing/stale/offline` — docs/state.md, docs/caching.md): offline shows the cached
  badge, exactly like every native surface.
- Freshness rides the existing invalidation channel. The plugin's node half calls
  `ctx.events.status()` (the content-free ping, `PluginBroadcast` in
  `packages/node-core/src/server/plugin/types.ts`) when its data changes; the client refetches
  chrome queries for that node. If ping-storms show up in practice, add a debounce in the adapter
  (not a new event type).
- Polling fallback: contributions may declare `"refresh": <seconds>` (min 30) for data that
  changes without a node-side trigger; adapters use `registries/pollers.ts`.

## Presence gating

Chrome renders only against Nodes whose roster says the plugin is enabled — the per-node presence
predicate from Phase 2. This is the same pattern as sources gated on a connected integration's
`providerId` (see `registries/sources.ts` and its consumers). Aggregate surfaces (attention,
nodeStats) already fan out per node and merge; plugin rows join that fan-out unchanged.

## Action vocabulary

The closed verb set the host executes. It is the flexibility dial: every plugin composes the same
few verbs, and adding a verb later is additive.

| Verb | Payload | Behavior |
| --- | --- | --- |
| `openPane` | pane id (own plugin's) | Opens/focuses the pane; appends context (`item`, `node`) as frame query params |
| `invoke` | action id | Bridge RPC into the plugin's frame (mount if needed). Requires Phase 3 |
| `runNodeAction` | path (own namespace) | `POST` to the plugin route via the node-pinned client; response toast on error |
| `openUrl` | https URL | External browser via the existing navigation policy — never in-app |

Verbs referencing panes or routes are validated against the same manifest at parse time (a
`openPane` naming a pane the manifest doesn't declare is a manifest error, not a runtime
surprise).

## Tests

- Manifest parsing: namespace confinement of routes, unknown slots rejected, action validation.
- Adapters: register/dispose round-trip per registry; malformed route responses dropped without
  throwing; presence gating (plugin enabled on node A only → chrome scoped to A).
- Freshness: `ctx.events.status()` → chrome query refetch (integration test over the client
  events registry).
- e2e: demo plugin (Phase 3's, or a chrome-only fixture) shows a rail icon with rows and a footer
  badge that updates after a node-side mutation; badge survives node disconnect as a stale read.

## Exit criteria

- A chrome-only plugin (no `client` bundle at all) ships a rail source with live rows, a footer
  badge, palette rows, and an attention item, all rendered natively, fresh via invalidation, and
  correctly scoped per node.
- Disable/enable and version-winner changes add/remove all chrome cleanly.
- `pnpm lint`, suites, boundaries test, desktop e2e green.

## As built

All exit criteria hold. The chrome-only fixture is driven end to end in
`apps/desktop/e2e/pluginChrome.spec.ts`, and the host pass is unit-covered in
`packages/client-core/src/plugins/chrome/register.test.ts`. The pieces:
`node-core/main/pluginManifest.ts` (schema + cross-field validation), `protocol/api.ts` (wire twins
and the four route response types), and `client-core/plugins/chrome/` (`data.ts`, `actions.ts`,
`register.ts`, and the two native components). Where the implementation departs from the plan above,
and why:

**Chrome gates on "no bundle, or an accepted one" — not on bytes.** `syncFrameContributions` gates on
`bundleAccepted` because bytes execute; a descriptor executes nothing, so a plugin that ships no client
half gets its chrome with no trust prompt at all, which is what makes a chrome-only plugin possible.
The other half of the rule is the part worth stating: a plugin whose bundle this device REFUSED gets no
chrome either. Its panes were never registered, so its `openPane` could not land — and decorating the
shell on behalf of something the owner declined is the wrong answer regardless of whether the
decoration is code.

**`slot: "footer"` is the task footer.** There is no shell-level footer slot; `docker-footer-badge` —
the precedent this document names — is a `TaskSlotContribution` on `task.footer`. The manifest enum is
`['footer']`, so an unknown slot is a parse error and more slot names stay additive. The consequence to
know: `TaskSlotHost` only renders inside a task that HAS a worktree, so a descriptor badge is invisible
until one exists. The e2e asserts the freshness round trip on the rail row's badge instead, which reads
through the same query and the same revision signal; testing the footer would have meant testing the
shell's worktree lifecycle.

**Palette rows got their own `PaletteItem` kind.** `action`, `task` and `workspace` are intercepted by
core's dispatch in `CommandPalette.tsx`, and `run`/`layout`/`workflow` carry a required `hint` and the
wrong semantics. `kind: 'plugin'` renders identically (the palette is kind-agnostic apart from `error`)
and routes back to its contributing source, which is the whole requirement. One source is registered per
plugin covering all its rows, not one per descriptor: the palette asks every source when it opens.

**`invoke` is not in the v1 verb set.** It needs a host→frame RPC into a frame that may not be mounted,
i.e. a headless frame lifecycle the shell does not have. A manifest naming it fails to parse rather than
parsing into a row that silently does nothing — the verb set is closed, and closed should be loud.

**Item context arrives over the bridge, not as a query param.** The `openPane` row above says "appends
context as frame query params", which predates phase 3's decision that a frame's subject travels on the
port. So a selection reaches the plugin's pane as a retained `PaneIntent` (`plugin:select`) that
`PluginFrame` turns into either `context.item` at connect, or a `select` message for a pane that is
already open — remounting a frame per click would throw away everything it had drawn. This is the one
phase-3 surface this phase grew: `PluginBridgeSelect`, `postSelect`, and `bridge.onSelect` in the SDK.

**One timer and one revision signal for all chrome, not a `pollerContribution` each.**
`startClientPollers()` snapshots the poller registry once at app mount, and the chrome pass runs after
the distribution round trip — a poller registered there would never start. So `data.ts` owns one
interval at the smallest declared `refresh` plus one `wsOnStatus` subscription, both torn down with the
contributions. Note that this drives the source and slot surfaces only: attention and node stats are
re-read by the inbox's and Fleet home's own fan-outs, which own their refresh policy.

**Routes are confined twice.** The manifest check happens on the node at parse time, as designed — and
again on the device before any fetch, because the manifest reaches the client as a roster row, and a
roster row is bytes a node sent. That is the same argument that makes the device hash bundle bytes
itself rather than trusting the listing.

**Descriptor sources contribute no `routes` and no polling of their own**, as the Host adapters section
requires; the deep-link decision is left open behind a host-minted prefix.
