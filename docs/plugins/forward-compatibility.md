# Forward compatibility

[Back to plugins](../plugins.md)

## Forward compatibility

**Unknown is retained and reported, never dropped silently.** One rule, because there were four
different answers to "the plugin knows something this build does not", and three of them were wrong in
different directions.

- A **schedule state row** whose declaration is gone is retained and shown. Right, and the model for
  the rest: disabling a plugin must not delete the owner's pause or its run history.
- An **unknown `apiVersion`** used to hard-refuse. Fixed by making it a range (§ What is published):
  refusing meant a manifest written for the next acorn could not name this one.
- An **unknown `permissions.node.core` facet** is skipped by `scopeCore`, and an **unknown manifest
  key** is stripped by the schema. Both of those are correct — rejecting either would make a manifest
  from a later build fail to load, which is the trap `apiVersion` used to be. What was wrong is that
  neither said so, so an author whose key never took effect had nothing to read.

So the manifest reader now collects them. `parsePluginManifest` returns an `unknown` list alongside the
manifest — unknown top-level keys, unknown contribution kinds, unknown core facets — computed by
comparing the raw JSON with what came back out, so there is no key list to keep in step. It rides the
roster row to the device, which raises one attention row per entry on the same path a surface that
failed to register takes. The wording says what it is: this version of acorn does not recognise it, so
it was ignored. Not a failure of the plugin.

Those rows, and every other row a loaded plugin raises through `contributions.attention`, land on the
plugin's own rail source when it has one and on Settings > Plugins when it does not. The manifest
names no target and the wire carries display strings only, so the host supplies it
([notifications.md](../notifications.md) § What a row points at).


## Collaboration rules

Plugins collaborate through four mechanisms:

1. **Contracts** — import only a provider's `contract/` entrypoint for types, capability IDs, or
   narrow pure functions.
2. **Capabilities** — resolve typed functions from the Node's per-runtime capability registry at
   call time. This is the Node's only late-binding mechanism: route handlers receive a read-only
   capability view through `RuntimeBindings`, while plugin providers register during `init`. Missing
   optional providers produce a degraded feature, not a module import. The small helpers in
   `server/bridge.ts` are typed route adapters; their setter functions exist only for isolated route
   tests and are never used by production composition.
3. **Broadcasts** (`ctx.events`) — tell connected clients that something changed, and hear what core
   says changed on this node. It is an invalidation channel over the authenticated WebSocket — no
   durability, no replay, no delivery guarantee — and a client that misses one refetches after the
   gap. Durable history belongs in the owning plugin's tables. Plugins can subscribe to another plugin's
   declared events with a manifest grant. Use a capability when the caller needs a result.
4. **Client registries and slots** — register UI contributions without importing another plugin's
   implementation. The host records disposables so disabling/reloading a plugin removes its entries.

`packages/client-core/src/infra/node/clientCapabilities.ts` mirrors capabilities (2) on the client: a typed
`Map` keyed by `ClientCapabilityId<T>`, so one plugin's client half can call another's without an
import edge between their packages. The motivating case was the agent task sidebar merging
`plugins/workflows`' steps into its roster while `plugins/workflows`' node half already needed
`plugins/agents` to execute a session, two legitimate couplings pointing opposite ways, which is a
package cycle that turbo refuses to build. Routing one direction through a capability id breaks the
cycle.

It carries the node registry's four verbs behind `ctx.capabilities` — `provide`, `get`, `require`,
`ids` — so an author who learned one half does not get the other backwards. `clientCapability` and
`requireClientCapability` are the same reads as free functions, for a component that has no `ctx` in
hand. What it is emphatically NOT is the platform gate: that is `requires` on a contribution, answered
by `hostCapabilities()`. Both were spelled "capability" until 2026-08-27, in opposite senses on the two
halves.

**A capability id belongs to the plugin that publishes it.** A loaded plugin may only provide ids
starting with `<its own id>.`, the same binding the host already applies to its routes, schedules,
collections, integration flows and extension points. Providing anything else fails registration and the
reason lands on the roster row. Without the rule, a package called anything at all could publish
`github.mirror` or `preview.rules` while the real plugin was disabled, and the composition root would
resolve the impostor — a capability is a typed function another plugin calls, so squatting one is not a
name clash, it is a substitution nothing announces.

Two ids are exempt, and both are host-declared invitations rather than any plugin's property:
`core.taskWorktreeCreated` and `agents.harnessRegistry`. Whichever plugin owns worktree side effects or
agent sessions on a given node fills them. `HOST_OWNED_CAPABILITY_IDS` in
`packages/node-core/src/server/plugins/permissions.ts` is the list, and a test holds it against the real
constants.

The catalogue of every id the first-party plugins publish, with its signature, is
`CapabilityCatalogue` in `acorn-plugin-types`. Most ids are declared in
`plugins/*/src/contract/` modules a loaded plugin cannot import, so the catalogue is the stable way
a stranger learns what exists.

**Hearing a core event.** `ctx.events.on(event, listener)` is the receive side, and it fires whether or
not a client is attached, which is the point on a node nobody is sitting at. The event must be one core
publishes (`NODE_EVENT_CHANNELS` in `packages/protocol/src/nodeEvents.ts`) and, for a loaded plugin,
one its manifest named in `permissions.events`, the same grant list its frames subscribe against, so
there is one vocabulary and one trust sentence per grant rather than two of each. Disposal follows
unload, exactly as a route registration does. The catalogue is in `nodeEvents.ts`.

Two of the eleven are worth calling out because they are what a coarser ping split into.
`terminal:sessions-changed` says a session was created, exited, or flipped between working and idle.
It is the one core channel that fires at machine speed, so hear it only if a session roster is what
you draw. `worktree:status-changed` says something under a task's worktree changed, and carries the
`taskId`. Announce that one with `ctx.events.worktreeStatus(taskId)` after your plugin writes under a
worktree, and drop the node's coalesced `git status` for the path first if you wrote to it directly:

```js
import { invalidateWorktreeStatus } from '@acorn/plugin-api/node'

await writeFile(join(root, path), text, 'utf8')
invalidateWorktreeStatus(root)
ctx.events.worktreeStatus(taskId)
```

The order matters. The announcement is what makes every client re-read, and they must not be handed
the answer from before your write. See [Worktree status reads](../workspaces-and-tasks.md#worktree-status-reads).

**Hearing another plugin.** The same `on` takes `plugin:<id>:<verb>` when the producer declared the
verb: a loaded plugin under a top-level `emits` key in its manifest, a built-in through
`NodePlugin.emits`. The subscriber names the channel in its own `permissions.events`, and the trust
prompt draws one host-owned sentence per producer, "Receive live updates from the github plugin". A
producer that is running and did not declare the verb makes the subscription throw; one that is not
running delivers nothing and errors nothing, which is tolerable only because payloads carry state and
the consumer re-reads on receipt. The frame side honours the same grant through the broker, and it does
not consult the producer's `emits`: a producer's frames reach every socket regardless, so the check
would be cosmetic, and the node-side check is the one that holds. One ceiling to know: init order is
not a dependency contract, so a consumer that subscribes before its producer's init has run sees an
"absent" producer and is admitted even for an undeclared verb. The frames never arrive, so the contract
holds; only the error is lost.

### Shipped first-party lifecycle events

Every row below is an invalidation over durable or otherwise node-authoritative state. Payloads carry
only enough current state or scope to avoid an unnecessary broad read; startup, reconnect, and a
sequence gap still require a re-read.

| Producer event | Safe payload | Re-read seam |
| --- | --- | --- |
| `plugin:workflows:run-changed` | task, run, durable run status | workflow run routes |
| `plugin:workflows:gate-changed` | task, run, step, human-gate status | `workflows.gates` |
| `plugin:agents:turn-changed` | task, session, turn, source, status, attempt | `agents.turns` |
| `plugin:agents:request-changed` | task, session, request, kind, status | `agents.requests` |
| `plugin:agents:sessions-changed` | task, session, present, archived | `agents.sessions` |
| `plugin:github:repos-changed` | none | user-scoped repositories from `github.mirror` |
| `plugin:github:pulls-changed` | repository scope | GitHub mirror routes |
| `plugin:github:checks-changed` | repository, pull, current head | GitHub mirror routes |
| `plugin:github:pr-synced` | repository, pull, current head | GitHub mirror routes |
| `plugin:browser:captures-changed` | task | `browser.captures` |
| `plugin:changes:review-notes-changed` | task, total count, unsent count | task-confined review-note routes |
| `plugin:memory:memories-changed` | project or private scope | `memory.library` |
| `plugin:preview:url-changed` | task, nullable URL and resolution source | `preview.urls` |

The browser also sends `capture-created` for one compatibility period. New consumers use the
collection event. Core's `agent-session:changed` remains the deliberately coarse compatibility
reduction for completion and attention; the agents plugin's lifecycle events do not duplicate its
transcript stream.

**What earns a place in the catalogue.** An event is admitted only if all four hold: core (or the
emitting plugin) is the only possible observer; it is human-scale, not machine-scale (per commit, yes;
per keystroke, per agent step, per container health check, no); it carries state rather than a delta,
so a missed frame self-heals on re-read, which is the promise the WS envelope already makes; and one
honest host-owned sentence describes it in the trust prompt. Rule two is partly a property of the pipe:
`wsBroadcast` walks every open socket with no subscription filter and no backpressure, so a frame every
few seconds is a stream, and streams stay with the one plugin that owns `ctx.events.streams`. Every new
channel costs one `SUBSCRIBABLE_CHANNELS` entry and one sentence, which is the brake on growth working
as intended.

**What is not an event.** Refused by name so the argument is had once. *File opened or saved*: a plugin
that wants this wants a file watcher its node half can run; the post-save invalidation ping is not an
event. *Terminal output and every other owned stream*: PTY, docker logs and stats, the agent token
stream; the lifecycle reduction is the event, the stream stays with its owner. *Anything per-keystroke,
per-selection, per-render, or per-agent-step*. *Machine-scale invalidation mechanics*: a cache talking
to itself (docker's health-check ping, github's 304 bumps, per-step workflow writes); the event is the
completed sync or the terminal state, emitted after the funnel, never inside the loop. *Generic process
and port lifecycle*: a port manager can poll `lsof`; declared run targets changing state is the carve-out
and is an event. *Raw user activity*: an idle or active signal is the most surveillance-shaped thing a
third-party surface could carry; core keeps its own activity record and exposes a projection. *Request
and query payloads*: http's request-sent and database's query-ran are the user's private data and can
carry resolved secrets; the plugin-local record is the feature. *Compose up and down*: another plugin can
ask `docker compose ps`; `task-teardown` made the cut instead because it is archive-coupled state.

Three adjacent events remain conditional by design. `http:variables-changed` ships only with a
concrete consumer and a capability exposing redacted metadata—never names, values, commands, or
resolved secrets. `agents:delegation-changed` waits for a task-authorized durable provisioning read
model and never carries prompts or lineage detail. `preview:navigated` waits for an authoritative
node-side current-URL read and an explicit rule for redacting sensitive query values. None is emitted
today; their absence is the contract, not unfinished wiring.

**Where a key lives.** With whichever side would otherwise have to import the other. On the node that is
almost always the provider, and the registry says so: "the signature lives in the provider's
`contract/`, never here". `WORKFLOW_CONTROL` is the exception that fixes the rule's wording — agents
declares it, workflows provides it, and the id string still names the provider — because agents draws
the control and workflows already imports agents. Cycle-breaking wins over provider-ownership. Put the
key wherever it does not recreate the import you were avoiding, and say which in its own file.

Like the Node's registry, it is not a DI container: it resolves nothing on its own, constructs
nothing, and orders nothing. Call sites must resolve at call time, never at module scope or in a
component body that runs once, because a plugin's client registration order is not a contract, and
reading a capability during another plugin's init could cache `undefined` just because that plugin
happened to register second. Unlike the Node's registry, which is per-runtime because the service can
boot twice in one process, this one is a module singleton: a renderer has exactly one client graph,
and `_resetClientCapabilities` exists only for tests.

The architecture test enforces zero non-contract plugin-to-plugin edges, no app imports from packages
or plugins, no shell bindings outside `apps/desktop/src/shell`, protocol purity, declared
dependencies, an acyclic package graph, and the client/Node split.

## Data ownership

Table-owning plugins get one `plugins/<name>.sqlite` file under the Node data root and own its
migrations. There are eight: agents, changes, database, GitHub, HTTP, memory, terminal, and workflows.
Core owns shared workspace/task/integration/external-item/security tables. Docker, editor, Linear,
Rollbar, model providers, preview, notes and the built-in agents profiles use core services, provider
registries or plain files without owning a database (notes writes markdown under `<data-root>/notes`).

Both tiers get their handle from `ctx.storage.open()`, and the host owns the lifecycle either way: it
opens the file lazily on the first call, applies the chain, returns the same handle to every later call
in that boot, and closes it immediately after that plugin's `dispose()` — inside the `plugins` step of
`NODE_DRAIN_ORDER`, before core's SQLite and before the data-root lock. A plugin's `dispose` is for what
the plugin itself opened (timers, children, pools, capability slots); GitHub and HTTP need none at all.

What each tier declares:

- **A compiled plugin** sets `migrationsModule: import.meta.url` on its `NodePlugin`. The host walks
  from that module for the chain, which is how one declaration covers all three runtime layouts —
  `plugins/<id>/migrations/` in a source tree, `out/migrations/<id>/` in a build, `<resources>/migrations/<id>/`
  when packaged (`packages/node-core/src/server/plugins/migrations.ts`).
- **A loaded plugin** declares a package-relative `migrations` directory in `acorn-plugin.json`. The
  loader confines and validates that chain and the host binds the filename to the manifest id. A
  `migrationsModule` on a loaded plugin's exported object is IGNORED — a bundle must not be able to point
  the migrator outside its own package.

No declaration means no storage: `ctx.storage` is absent, and reaching for it is an immediate
"not a function". There is no fallback search, and a plugin never names the file, the data root, or the
directory its chain lives in.

HTTP is the only plugin on that path, and it is what makes the rest of this paragraph real rather than
designed: `build-plugin.mjs` stages the declared directory into the package it builds — a chain that
travels with the code, since Drizzle reads the journal and the `.sql` files off disk at migrate time —
and `apps/node/test/integration/plugins/httpLoaded.test.ts` covers a schema change arriving through an
installer update against a populated database, a broken chain failing contained, and
uninstall-without-purge keeping the file. Because the filename is bound from the manifest id, that id
is the one thing in a table-owning package that can never change: renaming it orphans real rows.

There are no cross-file foreign keys, `ATTACH` queries, or transactions spanning plugin databases.
Cross-plugin workflows use durable operation state and explicit IDs/capabilities.

### Uninstalling, and what "purged" means

Uninstall removes the package directory and its lockfile. With `purgeData`, it also removes the
plugin's own SQLite file and its WAL sidecars, and then everything in the core database that is keyed
by the plugin id: the `plugin:<id>:*` prefs rows, and the `schedule_state` and `schedule_runs` rows
under `<id>:`. That last part is `cascadeDeletePluginData`
(`packages/node-core/src/server/db/cascade.ts`); disk goes first and the database second, because a
failure in that order still leaves the plugin gone, where the reverse leaves a running plugin whose
state was deleted underneath it.

The prefs rows are why this exists. Every sandboxed frame's state lives under `plugin:<id>:*`, nothing
could enumerate or delete that namespace, and uninstall audited `dataPurged: true` over rows that were
still there — so a reinstall inherited the old plugin's state with no way for anyone to look at it
first.

Two things a purge deliberately does not reach, and the audit row is still honest about both. A pane id
sits inside a core-owned layout blob (`core:task-layouts`), and the layout normaliser already drops an
id no registered pane answers to. Cached external items belong to the owner's *connection*, not to the
plugin that reads it, and disconnecting the connection is what clears them.

Without `purgeData` nothing is deleted, which mirrors what disabling has always done: reinstalling
finds its data where it left it.

## Tool projection

A plugin registers schema-validated agent tools with risk metadata. Core projects the registry into:

- the task-scoped HTTP tool surface;
- the stdio MCP server used by spawned agents;
- renderer permission and tool-description UI.

The caller's internal-token scope and the owner's tool permission settings are both applied. Tool
implementations run in the Node and use CoreServices; the renderer and MCP process do not open plugin
databases directly.

## Adding a plugin contribution

Every kind that exists, with its tier and where it is declared, is one table in
[contribution-kinds.md](../contribution-kinds.md). Read that first: the odds are good that a kind
already draws what you want.

1. Put the behavior in the owning plugin and choose the correct runtime directory.
2. Use CoreServices rather than importing core implementation modules or another plugin's internals.
   If it needs tables of its own, declare the chain (§ Data ownership) — do not open a database.
3. Add a narrow `contract/` export, capability, or client registry entry when collaboration is
   needed; `ctx.events` if the renderer needs telling.
   Name each `permissions.node.core` token the contribution needs in the manifest, including
   `telemetry` if it reads the telemetry stream. A token nobody declared is a facet absent from
   `ctx.core` and a `TypeError` on first call.
4. Register the Node/client entry in the appropriate composition list (named below).
5. Add package-local tests and, for rendered behavior, desktop e2e coverage.
6. Regenerate the golden lists (below) and read the diff before you commit it.
7. Run the architecture test, `pnpm lint`, and the relevant tests.

### The files a contribution touches

None of this is discoverable from a stack trace, so it is written down here rather than met as red CI. A
contribution INSIDE an existing compiled plugin — a pane, a rail source, a route, a tool, a settings page —
touches that plugin's own `src/` and then only the golden lists. A whole new compiled plugin also touches:

- `plugins/<id>/package.json`, plus the three one-line config files (§ Package shape). Nothing lists the
  plugin anywhere: `scripts/db.mjs` finds `drizzle.config.ts` by scanning, and `pnpm lint`/`pnpm test` reach
  the package through the workspace.
- `apps/node/src/composition/plugins.ts` — the Node activation list. A plugin that is not in it does not exist in
  that Node. If it needs an adapter only the composition root can build, `NodePluginDeps` grows a key here
  and the adapter itself goes in `apps/node/src/composition/pluginDeps.ts`, which builds the bag once for both
  composition roots.
- `apps/desktop/src/client/plugins.ts` — the client activation list. Rail and pane ORDER is a declared
  field on the contribution, not a position in this array.
- `apps/node/package.json` and `apps/desktop/package.json` — each needs `"@acorn/plugin-<id>": "workspace:*"`
  for the half it composes, the Node one for `node/`, the desktop one for `client/`. A plugin with only one
  half needs only that one entry.

A LOADED plugin instead needs one row in `BUNDLED_PLUGINS` in `apps/desktop/scripts/build-bundled-plugins.mjs`
and its own `acorn-plugin.config.mjs`, and touches no composition list and no golden list: the manifest is
the record, validated at parse time, and it carries the panes, sources, order and chords the compiled lists
would otherwise hold. (Several loaded packages do have an `apps/node` dependency entry, but only because that
app's own tests import them directly — nothing composes them.) Stylesheets are central in neither tier — a plugin's CSS sits next to its component
and is imported by it, and `tools/arch/boundaries.test.ts` enforces that no plugin reaches into another's.

### The golden lists

Four test files hold an exact, reviewed record of what each COMPILED plugin claims. They are snapshots, not
hand-edited tables, and one command rewrites all four:

```sh
UPDATE_PLUGIN_GOLDENS=1 pnpm --filter @acorn/desktop --filter @acorn/node test
```

- `apps/desktop/test/client/parity.snapshot.json` — every compiled pane with its order and chord, and every
  rail source with its order (`parity.test.ts`).
- `apps/desktop/test/client/clientPluginDisable.snapshot.json` — every client registry entry, and which
  optional plugin owns each one (`clientPluginDisable.test.ts`).
- `apps/node/test/integration/routeRegistry.snapshot.json` — every `/v2/p/<plugin>/…` route the compiled
  plugins mount (`routeRegistry.test.ts`).
- `apps/node/test/integration/pluginSystem/pluginDisable.snapshot.json` — the full Node boot's routes, tools, context
  sections, providers and databases, and which optional plugin owns each (`pluginDisable.test.ts`).

Every assertion is exact equality against the file, never a subset, so a contribution that silently VANISHES
fails as loudly as one that appears. That is also what makes the diff the point: regenerating is a deliberate
act, and the snapshot diff is the only place a reviewer sees what a plugin now claims — a disable that took a
sibling's entry with it shows up there as that entry sitting in the wrong plugin's slice. Regenerate in its
own commit hunk and say why the list moved.

Three things in those files stay hand-written, and should keep costing a deliberate edit: the `required` list
in `pluginDisable.test.ts` (`agents`, `memory`, `notes`, `terminal`), because which plugins may not be turned
off is policy and deriving it from `p.required` would assert nothing; the anti-vacuity floors, which are what
stops an exact match against an empty snapshot passing; and the prose above each snapshot read, explaining
what is ABSENT and why, which a generated file cannot say for itself.

`pluginDisable.test.ts` compares route, tool, section, provider and database lists with multiset
subtraction, not set subtraction: it removes each expected entry once and reports what is left over.
A plain `filter` against the expected list would be wrong, because some plugins register several
entries under the same key (github mounts eleven routers under `github/repos`; `changes` and `editor`
each mount two under one prefix). Set-style subtraction would drop all of them for one expectation and
would not notice most of them going missing. Counting catches a duplicate disappearing, which is the
only way an exact match means anything for a key with repeats.

Regeneration can only record what a boot lost, so it cannot record an entry a disable wrongly added;
that case still has to fail the equality against the recorded file. Route removals are also attributed,
not just counted: a route's key names its owning plugin (`/v2/p/<plugin>/...`, see § Activation), so an
entry credited to the wrong plugin in the golden file fails that check even when the overall equality
still passes. Regenerating the file cannot launder a wrong attribution, only a human correcting it can.

Two neighbours have the same shape and different commands. `packages/plugin-api/src/surface.snapshot.txt`
pins the facade's exports and regenerates with `UPDATE_SURFACE=1 pnpm --filter @acorn/plugin-api test`; a
contribution touches it only if it needs a new export from `@acorn/plugin-api`. The exact-set baselines in
`tools/arch/boundaries.test.ts` are ratchets rather than snapshots — they may only shrink, and no flag
rewrites them.
