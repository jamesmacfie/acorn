# Caching

acorn has three independent cache layers. None of them replaces the source of truth that owns the
data.

## Provider mirrors

The GitHub plugin stores repository and pull-request projections in `plugins/github.sqlite`. Linear
and Rollbar use the core external-item projection. Reads use serve-then-revalidate:

1. resolve the resource and freshness marker;
2. serve a usable local projection immediately when one exists;
3. refresh in the request or in a bounded background operation when the policy says it is stale;
4. replace or update the projection and freshness marker.

Mirror collections are disposable. A full list refresh can delete and rebuild rows so repositories
or issues no longer visible to the provider do not remain in the UI. Provider errors preserve a
usable stale projection and return its freshness state; a cold read without a projection reports the
provider failure.

GitHub list and PR detail policies are defined in `plugins/github/src/server/` and use TTLs appropriate
to each resource. Repositories and open PR lists use ETags where the provider supplies them. A `304`
only advances the local freshness timestamp. Explicit `force` requests block for a fresh response.

The sync engine itself (`server/sync/policy.ts`, `engine.ts`) used to hold the staleness TTL for every
provider resource: GitHub's pulls and repos, Rollbar's items, Linear's issues. Each now sits with the
plugin whose API it describes, since how fast a provider's data moves is a fact about that provider,
not about core. What stays in the engine's own policy is the rate-limit backoff: how long a
rate-limited key waits before another background refresh runs. That one is the engine's, not a
provider's, because a provider that could set its own backoff could make the node keep hammering an
API that already said no. `read()` still takes a per-call `backoffMs` override for a provider that
publishes a `Retry-After`.

Provider item resources have independent freshness markers. A Rollbar item list, item detail, and
occurrence history can therefore be stale independently.

Linear's rail, its `issues-mine` collection, and its batch reference-resolution route are the
exception to serve-then-revalidate: they read across every connected workspace with partial results,
and a bare identifier has not yet been attributed to a connection, so there is no single freshness
marker to revalidate against. These routes resolve directly against each connection and write what
they find into the external-item store themselves. Linear's single-resource issue detail route still
goes through the mirrored resource and gets serve-then-revalidate as normal.

## Immutable blob cache

`BLOBS` is an on-disk, content-addressed cache under `<data-root>/blobs/`. GitHub patch bodies and
file bodies are keyed by SHA; attachments and agent artifacts use the same immutable storage
mechanism. A cache miss fetches the provider body, verifies the expected digest where available,
and writes it atomically. The cache is local to a Node and stores both public and private repository
content because it is not shared storage.

Blob pruning must respect references retained by plugin records. Worktrees are not part of the blob
cache.

## Renderer query cache

The renderer uses TanStack Query with one `QueryClient` and one IndexedDB persister per Node. The
persister key is scoped to the Node, not merely prefixed into every feature key. This makes the cache
partition structural: identical task or repository IDs on separate Nodes cannot collide.

The persisted cache is disposable and has a bounded lifetime. It provides fast last-known reads,
not mutation confirmation. When a Node is reconnecting or offline, cached responses remain visible
with freshness badges. A WebSocket reconnect or sequence gap marks affected data stale and triggers
normal refetching; there is no history cursor or offline mutation queue.

The persisted cache has no version buster. A stale entry from before a response type gained a
required field survives a relaunch as-is, so a query key must change whenever the shape it caches
gains a required field; there is no other point at which an old entry gets invalidated.

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
