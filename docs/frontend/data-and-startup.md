# Data and startup

This page covers how the renderer reads Node data, typed data authoring, the startup readiness gate,
and connection and freshness UI. Read it before you add a read that runs at startup. It's part of
[frontend](../frontend.md).

## Node data access

`packages/client-core/src/infra/node/apiClient.ts` uses route builders and response types from
`@acorn/protocol/api.ts`. On the desktop it calls the platform seam's
`nodeTransport().fetch(nodeId, request)`, which the desktop helper sends through the pinned broker.
Without a transport it falls back to a same-origin `fetch`. Shared repository-picker and task-status
reads are generic query wrappers backed by the owning source's `repository` contribution, so provider
routes and types stay out of client-core.

A response body is a `Uint8Array` all the way from the broker, so binary is a read on the same
transport. `readBytes` and `sendRawBytes` are for answers that are files. Under `app://`, a route
builder's URL resolves against the protocol handler, not a Node, so a download can't be an `href` or a
`src`. It comes back as bytes the caller turns into a blob URL. `sendRawBytes` also carries a plugin
frame's `api.getBytes` and `postBytes` ([binary bridge calls](../plugins/frames.md#binary-bridge-calls)).

TanStack Query is the server-data cache, with one query client and persister scope per Node. Query keys
need no Node prefix, because the cache is partitioned. Fleet queries fan out per Node and never write
aggregate shapes into per-Node keys.

## Typed data authoring

Typed source authoring lives in `packages/client-core/src/features/dataSources`, not in provider
plugins or consumer panes. Its editor and field-picker models sit beside kit components, and its
requests use the same Node-partitioned cache. Workflow and dashboard consumers receive protocol values
from it and don't duplicate source forms. The picker can request bounded metadata options as you type,
and query preview stays an explicit action. The lazy `@acorn/plugin-api/ui/data-sources` facade
exposes the connected controls to compiled consumers.

Workflow schedule setup follows the same rule. The workflows plugin owns a small dialog and a pure
cadence and preview model, and reuses the typed value and field pickers. Activation and status changes
go to device-only routes. They aren't offline writes: a failure stays visible in the open editor, and
nothing replays after reconnect.

Dashboard authoring uses `SourceQueryEditor` directly. Each query reports its fields and its explicit
preview through a callback, and the dashboard's display state never writes back into the query. The
two-region editor projects typed nested values through `@acorn/dashboards-core/typedProjection.ts`
into the host's panel views, and at narrow widths the regions stack without losing the draft.
Published panels cache their revision and bounded results under the active Node, workspace, and
dashboard ID. The renderer strips Solid's reactive metadata before handing cached values to the typed
projector.

## Startup readiness

The desktop opens its window as soon as the helper is listening, and shows the startup loader while the
helper picks a Node and the supervised local Node boots. The renderer doesn't mount the shell or plugin
panes until that Node reports its first broker status and compiled plugin registration finishes, so
pane resources never request routes that don't exist yet.

`apps/desktop/src/client/index.tsx` starts `selectActiveNode()` and `applyNodePlugins()` without
blocking. `activate.ts` registers core eagerly. After the first paint, a queued task imports the
12-plugin roster and runs its registration and activation passes. A window hidden behind others gets a
250 ms fallback, because macOS can suspend animation frames. Workspace restore waits for registration,
including plugin state slices, before it reopens tasks or follows pane deep links.

`applyNodePlugins` waits for registration and applies the Node's disabled list when it arrives.
Concurrent calls for one Node share a request, answers for a Node no longer selected are dropped, and
a failed read can be retried. The host skips a pass whose plugins and disabled set match the last, so
a Node that disables nothing costs no second registration. A plugin whose startup read depends on the
Node, such as the agent list or the terminal session list, waits for that Node to report itself
reachable.

The cache partition can't wait for the fleet, because it decides which cache provider mounts. The
device remembers the last Node it talked to, and `activeNodeId()` answers from that on the first tick
(`packages/client-core/src/infra/node/activeNode.ts`). The fleet answer corrects it, and a Node that's
gone triggers the `node-replaced` reload.

`nodeGateHolds()` keeps the loader up while fleet selection runs and while the selected local Node has
no status. The first `online`, `degraded`, `incompatible`, or named `offline` status releases it.
`nodeReady()` is the same condition reversed, and gates reads that start before the shell mounts, such
as the queries, schedules, and disk warning in `App.tsx`. Until the helper hands the local Node to the
broker, the broker answers `Unknown node`, so the fleet fan-out skips that Node, serves its cache, and
runs again on its first status. Offline remote Nodes don't hold the gate, because this app doesn't run
them. A later disconnect leaves the shell mounted.

Fleet membership can arrive after the first frame, so `fleet.ts` reads it again when a status names a
Node its list lacks. `index.tsx` invalidates active queries on the first usable status, which covers
requests that started early.

## Connection and freshness UI

The broker reports `online`, `degraded`, `offline`, `incompatible`, and `revoked`. Client-core maps
these plus query state to `live`, `refreshing`, `stale`, `offline`, `disabled`, and `error`
([states](../ui-design/states.md#connection-and-staleness-vocabulary)). Offline reads show cached values
with a Node badge, and writes fail fast and keep drafts.

Outside the startup gate, a supervised local Node the broker hasn't reported reads **Starting**
instead of **Offline**. Its freshness value stays `offline`. A remote Node with no status reads
**Offline**, because this app doesn't control its process.

The event client tracks per-connection sequence numbers and reconnects with backoff. A gap, a missed
heartbeat, or a Node restart marks the scope stale and refetches active queries. Feature streams show
attached or disconnected state separately from whether a process is alive.
