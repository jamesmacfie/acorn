# Targets: what a schedule may do

**Phase 3** (`README.md § build order`). A schedule row names a **kind** and a kind-shaped
**target**. The kind vocabulary is closed and budgeted like every vocabulary here; unknown kinds in
user rows survive inert (`engine.md § storage`).

## What phases 1–2 already built for this (start here)

- `Scheduler.registerTarget(ScheduleTarget)` exists and is tested inert-until-registered — a user
  row with an unregistered kind lists, never runs, and says so. **One wiring gap to close:** the
  `SCHEDULER` route capability exposes `register` but not `registerTarget`; either extend
  `SchedulerBridge` or register targets where `createScheduler` builds core's schedules — decide by
  who owns the target (core targets belong in `createScheduler`; a plugin-owned one would need the
  bridge).
- **In-process plugin-route dispatch is a solved problem — copy it, don't reinvent it.**
  `server/plugin/scheduleRun.ts` is the worked example seam 1 below wants: `resolvePluginFetch` +
  `buildPluginRequestContext(env, principal, pluginId)` + the node's own
  `{ kind: 'internal', scope: 'service' }` principal, with route confinement re-checked on every
  fire. A node-side collection read over a loaded plugin's `items` route is the same call with GET
  and query params.
- `buildPluginRequestContext` was extracted exactly so a caller with **no request** gets the same
  provider runtime and ownership checks a route does (`requestContext.ts`); the credential gate is
  `principalMayUseProviderCredential`, already admitting the service principal.
- `PluginHostOptions.env` threads the node's bindings into the plugin host; the sampler will want
  the same env, not a new channel.
- `describeCadence` (`@acorn/protocol/schedules.ts`) is the words the settings creation flow renders;
  the trust-line pattern for grants (`pluginGrants.ts § pluginScheduleGrants`) is the shape to copy
  if a target kind ever needs disclosure.

| Kind | Owner(s) | What runs |
| --- | --- | --- |
| `plugin-run` | plugin | the plugin's own confined route (loaded) or registered handler (compiled) — `declarations.md` |
| `collection-sample` | core | one pass over every panel that asked for a history trend |
| `node-action` | user | a `runNodeAction` verb, consent taken at creation |
| `agent-run` | user | **reserved, unbuilt** — a headless agent workflow |

## `collection-sample` — the driver, and its two prerequisite seams

One core schedule (`core:sample-measures`, hourly, jittered), not a row per panel: it enumerates
panels with `view.trend: 'history'` from the dashboards prefs slice — which the node already
stores — computes each panel's measure, and appends one sample per panel to the measure-history
table (`../dashboards/measure-history.md`). Panel churn never creates or deletes schedule rows;
compaction (`core:compact-history`, daily) is its sibling.

It needs two seams that do not exist, and **they are the real work of this phase**:

### Seam 1: node-side collection reads

Today a collection is read by the *client*: loaded plugins' `items` is a node route the client
calls; compiled plugins register a client-side `fetch` — which, decisively, is already a thin
wrapper over the plugin's own node route (`plugins/github/src/client/index.ts` § the collections
registration: it `readJson`s `pullsCollectionRoute` and stamps provenance). **Every collection is
ultimately a node route answering.** What the node lacks is only the registry that maps
`(pluginId, collectionId)` to that route.

Build: a node-side collection read registry.

- Loaded plugins: synthesized from the manifest's `collections` descriptors — the host already
  parses `items`; the node calls its own confined route in-process with the declared params as
  query parameters, exactly the request shape a client would send.
- Compiled plugins: register the pointer node-side in `init(ctx)` —
  `ctx.collections.register({ collectionId, items: pullsCollectionRoute })` — one line per
  collection, referencing the route constant the plugin's shared contract module already exports
  to both sides.
- Responses take the **same validation boundary** as the client path: a loaded plugin's answer
  parses with `pluginCollectionResponseSchema` and drops whole on failure; provenance is
  host-stamped; caps hold. The sampler is a reader like any other, with no privileged parse.

**Freshness honesty, restated as a hard rule:** the sampling read serves from whatever the
plugin's route serves — its mirror, at its age. Sampling **never forces revalidation**. GitHub's
no-unattended-revalidate stance survives; linear's declared refresh keeps meaning what it means; a
plugin that wants fresher unattended samples declares its own `plugin-run` refresh schedule (use
case 3) and pays for it from its own rate budget. A sample's `recorded_at` is when the node looked;
the value's age is the mirror's — and that ceiling is recorded in measure-history's display rules
rather than papered over.

### Seam 2: the measure pipeline leaves client-core

Computing "this panel's measure" means running shaping (filters), mapping (cross-source union,
value maps, invented fields) and the aggregate — pure functions that today live in
`packages/client-core/src/dashboards/{shaping,mapping,compose,model}.ts`, which the node cannot
import without dragging a client package into the node graph (and `boundaries.test.ts` exists to
say no).

Build: extract the pure measure pipeline into a shared package (working name
`@acorn/dashboards-core`; no Solid, no registries, no fetch — types + pure functions only).
Client-core re-exports and keeps every call site; the node imports it for the sampler. The
electron-free-node-graph rule applies (a static `electron` import anywhere on the package's graph
breaks the standalone node); the existing vitest habit — logic in pure modules because components
are untestable — is what makes this extraction mechanical rather than a rewrite. The panel
definition parser (`persist.ts § parsePanelDefinition`) moves or is mirrored with it, since the
node must parse the prefs blob it stores.

Sampling rules themselves (all-sources-answered gate, signature reset, one bucket per hour) live in
`../dashboards/measure-history.md § Sampling`, which is written against this target.

## `plugin-run`

Nothing beyond `declarations.md`: the target is implicit in the declaration (its own route or
handler), the cadence and timeout are declared, and the engine's policies apply. Listed as a kind
because the settings surface and the runs table speak in kinds.

## `node-action` — user schedules, and where consent lives

The target is a context-free chrome-verb dispatch, the same `runNodeAction` path a panel row action
or agent tool takes — deliberately **not** a new execution surface. What a scheduled action can do
is exactly what that action could do if clicked; the schedule only owns *when*.

```jsonc
// userSchedules.target for kind 'node-action'
{ "pluginId": "worktrees", "actionId": "prune-merged", "params": { "olderThanDays": "7" } }
```

**Consent moves to creation, whole.** The action's declared risk tier (`read`/`write`/`execute` —
the `ToolRisk` vocabulary, host-drawn confirmation, `docs/dashboards.md § Provenance`) is read at
create time, the creation flow arms exactly the confirmation that tier would get on click — naming
the plugin and the tier, host-drawn, cannot be talked out of asking — and the accepted tier is
**stamped onto the row** (`userSchedules.risk`). From then on runs never prompt: an unattended
prompt is either ignored (the schedule silently does nothing, worse than not existing) or
auto-accepted (a lie about consent). The stamped tier stays visible on the settings row for the
schedule's whole life, which is what makes the one-time consent honest.

Two consequences, decided:

- A target whose declared tier **rises** after creation (plugin update declares `execute` where it
  said `write`) fails closed: the run is `skipped` with "risk changed — re-confirm to resume", and
  the settings row offers the re-arm. Stamped consent covers the tier it stamped, nothing higher.
- A target that stops resolving (plugin gone, action renamed) runs as `skipped` with the reason —
  the row survives inert, dashboards-style, and reattaches if the action returns.

## `agent-run` — reserved, gated

"Every weekday at 9, run an agent over this repo to triage failing CI." The kind is **named in the
vocabulary now** (an unknown kind already survives inert, so old builds handle rows from newer ones
correctly) and **not designed further here**, because it is gated on a prerequisite acorn does not
have: a headless agent runtime — running an agent in a task/worktree with no PTY on a visible
surface, capturing its outcome. Sketch recorded so pickup has a shape: the target names a project,
a prompt/workflow reference, and a worktree policy; the run creates an ordinary Task (worktree
first, task wrapping it — the existing ordering) so its output lands where every agent's output
already lands. Design it when the headless runtime exists, against real usage of `node-action`
schedules — the same discipline as write-back's gate.

## Creation surfaces

- **Settings › Schedules** is the general surface: pick a kind (node-action now), pick the target
  from what is registered, cadence, name — with the consent arm inline when the tier calls for it.
- **Dashboards create nothing directly**: turning on a panel's history trend just makes the next
  `core:sample-measures` pass pick it up. No hidden schedule rows appear because a checkbox was
  ticked; the one sampling schedule is visible in settings like everything else.
- Plugin-declared schedules arrive by trust, not by a creation surface.

## Done when

- The node-side collection read registry serves both feeders with the same parse/provenance/caps
  boundary as the client path, proven by reading linear (loaded) and github (compiled) collections
  with no client attached.
- `@acorn/dashboards-core` (or its final name) exists; client-core imports it with zero behaviour
  change (its existing tests pass unmoved); the node imports it without electron in the graph;
  `boundaries.test.ts` knows the new edge.
- `core:sample-measures` + `core:compact-history` run end-to-end: panels with history trends accrue
  hourly samples with no client open, honoring the all-sources-answered gate and signature rules in
  measure-history.md.
- A `node-action` schedule can be created with the tier-armed flow, runs unattended, fails closed
  on tier rise and on unresolvable targets, and its stamped tier renders permanently.
- An `agent-run` row from a hypothetical future build renders inert here, not as an error.

## Verify before building

- `plugins/github/src/client/index.ts` § collections registration and
  `plugins/github/src/contract/collections.ts` — that the fetch is still a thin route wrapper and
  the route constant is still exported from the shared contract module (seam 1 leans on both).
- `boundaries.test.ts` + the package graph rules — where a new shared package registers, and the
  electron-free constraint on anything the standalone node imports.
- `persist.ts § parsePanelDefinition` and the prefs storage path node-side — the sampler must read
  the same blob the clients write, through a parser it can import.
- The chrome-action dispatch path (`runNodeAction`) — that a node-side dispatch without a client
  is possible for the verbs `node-action` targets, or what subset is (this bounds v1's offerable
  targets; the picker must offer only what resolves).
- `ToolRisk` / the risk-tier confirmation semantics (`@acorn/protocol`, `dashboards/Panel.tsx`) —
  the vocabulary and strip the creation flow reuses.
