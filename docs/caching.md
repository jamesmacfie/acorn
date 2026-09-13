# Caching

acorn has three independent cache layers. None of them replaces the source of truth that owns the
data.

## Provider mirrors

The GitHub plugin stores repository and pull-request projections in `plugins/github.sqlite`. Linear
and Rollbar use the core external-item projection. Reads use serve-then-revalidate:

1. Resolve the resource and its freshness marker.
2. Serve a usable local projection when one exists.
3. Refresh in the request, or in a bounded background operation, when the policy says it is stale.
4. Replace or update the projection and freshness marker.

Mirror collections are disposable. A full list refresh can delete and rebuild rows so repositories
or issues no longer visible to the provider do not remain in the UI. Provider errors preserve a
usable stale projection and return its freshness state; a cold read without a projection reports the
provider failure.

GitHub list and PR detail policies are defined in `plugins/github/src/server/` and use TTLs appropriate
to each resource. Repositories and open PR lists use ETags where the provider supplies them. A `304`
only advances the local freshness timestamp. Explicit `force` requests block for a fresh response.

Each staleness TTL sits with the plugin whose API it describes, because how fast a provider's data
moves is a fact about that provider, not about core. The engine's own policy
(`server/sync/policy.ts`, `engine.ts`) keeps one value: the rate-limit backoff, or how long a
rate-limited key waits before another background refresh runs. A provider that could set its own
backoff could make the node keep hammering an API that already said no. `read()` takes a per-call
`backoffMs` override for a provider that publishes a `Retry-After`.

Provider item resources have independent freshness markers. A Rollbar item list, item detail, and
occurrence history can therefore be stale independently.

Linear's rail, its `issues-mine` collection, and its batch reference-resolution route are the
exception to serve-then-revalidate. They read across every connected workspace with partial results,
and a bare identifier is not attributed to one connection, so there is no single freshness marker to
revalidate against. These routes resolve directly against each connection and write what they find
into the external-item store themselves. Linear's single-resource issue detail route goes through
the mirrored resource and gets serve-then-revalidate as normal.

## Immutable blob cache

`BLOBS` is an on-disk, content-addressed cache under `<data-root>/blobs/`. GitHub patch bodies and
file bodies are keyed by SHA; attachments and agent artifacts use the same immutable storage
mechanism. A cache miss fetches the provider body, verifies the expected digest where available,
and writes it atomically. The cache is local to a Node and stores both public and private repository
content because it is not shared storage.

Blob pruning must respect references retained by plugin records. Worktrees are not part of the blob
cache.

Opening the cache sweeps the directory once, and the sweep is a permission migration: `put` writes
mode 0600, so a file with any other mode was written by an older build under a permissive umask. The
mode comes off the `lstat` the sweep already does, and only a file that is actually wrong is
chmodded. That matters because the sweep is synchronous and sits in front of the node's listener:
2,975 blobs and an unconditional `chmod` each cost 102 ms of every boot and fixed nothing
(`packages/node-core/src/server/bindings.ts`, docs/performance.md § 2026-09-03 —
phase 3).

## Renderer query cache

The renderer uses TanStack Query with one `QueryClient` and one persister per Node. The persister key
is scoped to the Node, not merely prefixed into every feature key. This makes the cache partition
structural: identical task or repository IDs on separate Nodes cannot collide.

Which partition the shell mounts on comes from the last-known active Node id, read synchronously on
the renderer's first tick. It has to: the window opens before anything has asked the helper which
Nodes there are ([frontend.md](./frontend.md) § Painting before the node), and a partition picked a
tick late would mount the shell on the `origin` cache and then remount it on the real one, throwing
away the first paint. So the device remembers the id
(`packages/client-core/src/infra/node/activeNode.ts`), the fleet answer corrects it, and a Node that
has gone reaches the `node-replaced` reload. A launch with nothing remembered has no cache to draw
either, and renders the onboarding path instead.

Where a partition is written is the host's, through `setCacheStorage`. IndexedDB is the default,
because the hosts that had one were browsers; the terminal client has none and installs a directory
of files instead, one per partition key, before the first cache is built. That host drives the
persister itself — `persistQueryClient` from `@tanstack/query-persist-client-core`, with the same
`maxAge` and dehydration predicate the desktop's provider passes — and awaits the restore before it
renders, which is its `isRestoring`.

One client per node is a contract, not a convention. The terminal client was the host that broke it:
it minted a second `QueryClient` for its shell beside the per-node one, so the shell read a cache
nothing persisted and nothing invalidated. Nothing on any host may add another
([tui.md](./tui.md) § Booting client-core under Node).

The persisted cache is disposable and has a bounded lifetime. It provides fast last-known reads,
not mutation confirmation. When a Node is reconnecting or offline, cached responses remain visible
with freshness badges. A WebSocket reconnect or sequence gap marks affected data stale and triggers
normal refetching; there is no history cursor or offline mutation queue.

The Workflows pane follows the same rule even though its selected run and steps are Solid resources
rather than persisted query rows. Run and child-change frames re-read the relevant task, and socket
reconnect re-reads both the task's run list and the selected run's steps. The pane model is created
inside the active Node shell, and the task-run index subscribes through that same Node connection.
Identical task or run IDs on two Nodes therefore cannot invalidate or navigate into each other.

The persisted cache has no version buster. An entry written before a response type gained a required
field survives a relaunch as-is, so change the query key whenever the shape it caches gains a
required field. Nothing else invalidates an old entry.

## Fan-out cache safety

Fleet surfaces fan out one request per Node. A fan-out may warm a Node's regular query cache only when
it writes the exact value shape expected by that query key. For example, a task-list key must contain
`Task[]`, never a derived count. Client code should use `createFleetQuery` and keep aggregate keys
separate from per-Node resource keys when the shapes differ.

## Measurement

The Node reports storage-footprint information at startup. It does not run a general destructive
cache sweep on every request. Provider mirrors, immutable blobs, plugin databases, logs, and
application-owned records have different retention semantics and must not share a blind deletion
policy.
