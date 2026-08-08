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
    "title": "Board",
    "icon": "kanban",                    // Lucide icon NAME as a string — resolved client-side,
                                          // exactly how glyph/tasks.icon already work
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
  the row id appended (frame query param `item=<id>` for `openPane`).
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
