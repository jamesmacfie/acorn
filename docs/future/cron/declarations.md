# Declarations: how a plugin says "I have periodic work"

**Phase 2** (`README.md § build order`). Two feeders, one registry, indistinguishable downstream —
the collections pattern (`docs/dashboards.md § Declaring one`), applied to schedules.

## What phase 1 already built for this (start here)

The engine shipped (`docs/schedules.md`) and left these seams ready, so phase 2 is key-minting,
lifecycle binding and trust disclosure — not scheduler work:

- `Scheduler.register(DeclaredSchedule)` in `node-core/server/schedules/scheduler.ts` takes exactly
  the shape a plugin schedule needs and returns `{ dispose() }`; dispose removes the definition and
  **keeps the state row**, so the whole lifecycle table below is already the engine's tested
  behaviour ("retains the state row of a schedule nothing declares, and reattaches when it comes
  back" in `scheduler.test.ts`). `ctx.schedules.register` is a wrapper that mints the
  `<pluginId>:<scheduleId>` key from the registering plugin and ties `dispose` to the plugin host's
  teardown.
- `keyOwner()` already derives the plugin owner from the key prefix, and the 300s plugin cadence
  floor is already enforced by key shape (`floorFor` in the same file) — declaring with the right
  key *is* opting into the plugin clamps.
- The cadence grammar and its tolerant parser live in `@acorn/protocol/schedules.ts`
  (`cadenceSchema`, `clampCadence`, `parseCadence`); the manifest descriptor should reuse
  `cadenceSchema` verbatim rather than re-declaring the union.
- **One unit trap:** the engine's `DeclaredSchedule.timeoutMs` is milliseconds; the manifest
  `timeout` below is seconds. The descriptor pass converts; do not let both spell seconds-vs-ms
  ambiguously.
- `registerTarget()` exists too but is phase 3's seam, not this one.

## Loaded plugins: the manifest descriptor

One new contribution kind in `packages/protocol/src/pluginContract.ts`, beside `collections`:

```ts
const scheduleDescriptor = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(80),
  // POST, confined to the plugin's own /v2/p/<id>/ route space at manifest parse and re-checked on
  // the device — verbatim the `items` rule. Body: { scheduleId }. The response is ignored beyond
  // ok/error; a schedule is not a data channel.
  run: pluginRoute,
  // The cadence vocabulary (engine.md), with the plugin floor: every ≥ 300s. A plugin asking for
  // sub-five-minute unattended execution is polling, and polling has an owner already.
  cadence: cadenceSchema,
  // Declared timeout, seconds, ≤ 300. Absent = the engine default (60s).
  timeout: z.number().int().min(1).max(300).optional(),
})

// Four. A plugin with more than a handful of distinct periodic jobs is describing a daemon, and
// the daemon here is the node. (Same argument style as every cap in this file — the cap IS the
// design.)
schedules: z.array(scheduleDescriptor).max(4).default([]),
```

Shared id namespace with every other contribution kind (the manifest's one duplicate-id rule),
provenance host-stamped: the registry key is `<pluginId>:<id>` minted by the host from the manifest
that declared it, never from anything the plugin's code says at runtime.

### Trust: schedules are disclosed at install

The descriptor joins the permissions projection the trust dialog renders. A person consenting to a
loaded plugin sees "Runs on a schedule: *Refresh issue mirror* — every 10 minutes", the same way
they see its routes and scopes. This is disclosure, not new capability: the run route is a route
the plugin already owns and could already reach from any of its surfaces — what changes is *when*
it runs (unattended), and that is exactly what the dialog line says. Unattended execution of plugin
routes is also not novel in kind — a placed panel already polls a plugin's collection route with
nobody clicking — but a schedule does it with **no client open**, which is worth a line of ink at
trust time.

## Compiled plugins: the node-side registry

Compiled plugins have no manifest for the host to synthesize from; they register on the node plugin
context (`node-core/server/plugin/types.ts § NodePluginContext`), the same split as collections'
`ctx.collections.register` client-side — except schedules register **node-side**, because that is
where they run:

```ts
// in the plugin's node init(ctx)
ctx.schedules.register({
  scheduleId: 'refresh-pull-mirror',
  name: 'Refresh pull request mirror',
  cadence: { every: 3600 },
  timeout: 120,
  run: async (signal: AbortSignal) => {
    // the plugin's own node code, with the plugin's own storage/core services in scope
    await refreshPullMirror(signal)
  },
})
```

`pluginId` is bound by the host from the registering plugin — a schedule cannot be filed under a
stranger's name (the collections rule). The handler gets the run's `AbortSignal` (timeout and
shutdown both flow through it) and its return value is ignored; it reports by side effect and by
throwing.

Registration happens in `init`/`ready`; the host tears schedules down with the plugin's `dispose`,
so a plugin never manages its own timer lifecycle — declaring the schedule **is** the lifecycle.
Any `setInterval` in plugin node code after this lands is a review flag.

## The override model

The registry (manifest or code) is the **definition**; `scheduleState` (engine.md) holds the
user's **overrides** — pause, cadence retune within clamps — plus run state. Merge rules:

- `enabledOverride` beats the declared default. A plugin cannot un-pause itself by re-declaring.
- `cadenceOverride` beats declared cadence, clamped to the same bounds at read.
- Everything else (name, route/handler, timeout) is definition-owned and not overridable — a user
  who wants a schedule to *do something else* wants a user schedule, not an edited plugin one.

## Lifecycle rules (the survival table)

| Event | Effect |
| --- | --- |
| Plugin disabled / uninstalled | Its schedules leave the registry and stop firing. Their `scheduleState` rows (pause, backoff, history) are **retained unread**. |
| Plugin returns | Definitions re-register; retained state reattaches by key. A pause survives the round trip. |
| Manifest drops a schedule id | Same as disabled, for that id: state retained, nothing fires. |
| Manifest changes cadence | New declared cadence applies unless a `cadenceOverride` exists — the user's word keeps winning. |
| Trust revoked (loaded) | Identical to disabled; nothing schedule-specific. |

Nothing in this table is new policy — it is the dashboards unknown-ids rule and the descriptor
lifecycle, restated for this kind. If an implementation finds itself writing schedule-specific
lifecycle code, it has diverged.

## Done when

- A loaded plugin manifest with a `schedules` entry parses, appears in the trust dialog, registers
  on trust, fires on cadence through its confined route, and survives the whole lifecycle table.
- A compiled plugin registers node-side, fires, and its handler's signal aborts on timeout and on
  node shutdown.
- Duplicate ids collide at parse like any other contribution kind; the caps and clamps hold.
- Pause and cadence overrides survive plugin disable/re-enable and node restarts.

## Verify before building

- `packages/protocol/src/pluginContract.ts` — descriptor conventions, `pluginRoute` confinement,
  where the permissions projection is assembled for the trust dialog.
- `node-core/server/plugin/types.ts` + `server/plugin/context.ts` — the context registries'
  shape (`routes`, `tools`) this one copies; how per-plugin teardown runs at `dispose`.
- The device-side route re-check for descriptor routes (`docs/dashboards.md § Declaring one` cites
  it for `items`) — reuse the same check for `run`.
- The stale-loaded-plugin gotcha: a manifest-declared schedule on a dev-installed package needs the
  package rebuilt to be seen — known behaviour, worth a line in the plugin docs when this ships.
