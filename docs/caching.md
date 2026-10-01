# Caching

acorn has four independent cache layers. None of them replaces the source of truth that owns the
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

`BLOBS` is an on-disk, content-addressed cache under `<data-root>/blobs/`. A GitHub patch body is
keyed by a SHA-256 digest of the patch text, `patch:sha256:<hex>`, because a head blob SHA does not
identify a patch: the same new file has a different patch against a different base. A new-side file
body stays keyed by its blob SHA, `filebody:<sha>`. Attachments and agent artifacts use the same
immutable storage mechanism.

Beside each patch body, the GitHub plugin stores the segment descriptors it cuts into,
`diffdoc:v<version>:sha256:<hex>`, so a diff document's topology is read from small blobs rather than
parsed ([diff-rendering.md](./diff-rendering.md) § The document). A new segmenter version reads new
keys and cuts again; the old ones are only cache data. A compare preview writes its inline patch
bodies under the same `patch:` keys, so its segments are served the same way.

A GitHub file row says whether its patch is available. An available patch whose body is missing from
the cache is an integrity failure, and the files route repairs it with a blocking refresh rather than
serving the file as having no diff. A summary read touches no blob at all. A cache miss fetches the provider body, verifies the expected digest where available,
and writes it atomically: to a staged file beside the entry, renamed over it, so a reader never gets
half a body. The cache is local to a Node and stores both public and private repository
content because it is not shared storage.

Nothing prunes the cache. `BlobCache` has `get` and `put` and no delete, so every body stays on disk:
superseded patches, `patch:<sha>` bodies from before patches were keyed by digest, and descriptor
blobs from older segmenter versions. A compare preview writes up to 300 patch bodies each time it
loads. A patch seen before lands on its old key, but every new comparison adds its own. A pruner must respect the references plugin records keep. Worktrees are not part of the blob
cache.

## Plugin bundle custody

The device keeps client bundles by the SHA-256 it computes from received bytes. An advertised Node hash
is a lookup hint and is verified before caching; the trust decision is a separate durable record keyed
by `(pluginId, hash)`. A single cache file may serve equivalent bytes offered by several Nodes, while
offer provenance records which Nodes supplied them. Reconciliation visits both the Node's active
runtime and its installed disk candidate so an update can be reviewed without displacing running UI.
The Node retains its active client bundle independently of the mutable package directory and serves
it through the hash-addressed bundle route after an update or uninstall until that runtime stops.

The cache does not persist a selected fleet winner. Each client session derives per-Node selections
from current runtime observations, locally cached bytes, and custody decisions. Stale or unreachable
observations remain available for explanation but cannot authorize a contribution. Existing cache
files and trust records need no reset for the additive `active` protocol field.

Opening the cache sweeps the directory once, and the sweep is a permission migration: `put` writes
mode 0600, so a file with any other mode was written by an older build under a permissive umask. The
mode comes off the `lstat` the sweep already does, and only a file that is actually wrong is
chmodded. That matters because the sweep is synchronous and sits in front of the node's listener:
2,975 blobs and an unconditional `chmod` each cost 102 ms of every boot and fixed nothing
(`packages/node-core/src/server/bindings.ts`, measured 2026-09-03).

## Renderer query cache

The renderer uses TanStack Query with one `QueryClient` and one persister per Node. The persister key
is scoped to the Node, not merely prefixed into every feature key. This makes the cache partition
structural: identical task or repository IDs on separate Nodes cannot collide.

Which partition the shell mounts on comes from the last-known active Node id, read synchronously on
the renderer's first tick. It has to: the window opens before anything has asked the helper which
Nodes there are ([frontend.md](./frontend.md) § Startup readiness), and a partition picked a
tick late would mount the shell on the `origin` cache and then remount it on the real one, throwing
away the first paint. So the device remembers the id
(`packages/client-core/src/infra/node/activeNode.ts`), the fleet answer corrects it, and a Node that
has gone reaches the `node-replaced` reload. A launch with nothing remembered has no cache to draw
either, and renders the onboarding path instead.

Where a partition is written is the host's, through `setCacheStorage`. IndexedDB is the default;
the terminal client installs a directory of files before the first cache is built. Each partition
captures its adapter at construction. Changing the installed adapter affects partitions constructed
afterward. Fleet readers can construct and warm memory without restoring or persisting a partition.

`packages/client-core/src/infra/persistence/queryCacheLifecycle.ts` owns selected-partition persistence.
Both hosts acquire a lease. The desktop composes the public `QueryClientProvider`,
`IsRestoringProvider`, and `persistQueryClientRestore` APIs; the terminal awaits the same restore
before drawing. Concurrent leases share one restore and one subscription. A later remount restores
again so an empty cache after inactive garbage collection can recover a valid offline snapshot.
Public hydration preserves fresher in-memory rows.

Meaningful query and mutation events mark the partition dirty in constant time. One five-second
clock coalesces full dehydration, serialization, and the storage write. The first dirty capture waits
up to five seconds, replacing the prior immediate first snapshot. There is no second storage throttle;
preference requests keep their separate write policy. Observer-only changes do not schedule capture.
Writes are serialized, with one active capture and a dirty follow-up when changes arrive during it.
Capture telemetry uses `cache.dehydrate` and `cache.dehydrate.count`, separately from serialization
and storage duration. Query eligibility, snapshot schema, and the age rules below are preserved.

Releasing the last selection lease keeps its listener through synchronous child cleanup, then stops
query and mutation subscriptions. Dirty, queued, and in-flight durability survives an ordinary switch;
an unchanged release writes nothing. Inactive fleet updates do not start background persistence.
Explicit Node retirement stops every partition subscriber and queued capture, fences delayed reads,
drains started writes, and deletes through the captured adapter. A replacement with the same Node ID
waits for deletion before restoring or writing. This ordering also owns the TUI file adapter's fixed
sibling temporary file.

A failed deletion remains a barrier and is logged; it does not retarget to another adapter or retry
in a loop. Repeated explicit removal retries the original deletion. The fleet's
`retryCacheRetirement(nodeId)` recovery entry point retries through that adapter, then reacquires
restore and flushes a mounted replacement's dirty memory. It rejects if deletion, restore, or flush
fails so its caller can report or retry the failure. Selected dirty tracking continues behind a
failed barrier, and all storage access remains fenced until deletion succeeds.

One client per node is a contract, not a convention. The terminal client was the host that broke it:
it minted a second `QueryClient` for its shell beside the per-node one, so the shell read a cache
nothing persisted and nothing invalidated. Nothing on any host may add another
([tui.md](./tui.md) § Booting client-core under Node).

The persisted cache is disposable and has a bounded lifetime. It provides fast last-known reads,
not mutation confirmation. When a Node is reconnecting or offline, cached responses remain visible
with freshness badges. A WebSocket reconnect or sequence gap marks affected data stale and triggers
normal refetching; there is no history cursor or offline mutation queue.

Two ages bound the persisted cache
(`packages/client-core/src/infra/persistence/queryPersistence.ts`). A whole
snapshot is restored if it was written in the last seven days, so the first launch after a weekend
away draws last-known rows instead of an empty shell. A single entry is written into the next
snapshot only if it was fetched in the last day, which matches the query client's `gcTime`. So a
week-old entry is drawn once and then dropped unless its screen refetched it, and the longer restore
window does not make the snapshot any bigger.

**Clear cache** on Settings > Machines > Storage and memory empties the cache of the node the settings
header's node switcher names, while it stays connected (`clearNodeCache` in `packages/client-core/src/infra/node/fleet.ts`). It removes every entry
nothing is drawing, deletes the saved snapshot through the host's cache store, and refetches the
queries on screen. Clearing waits for hydration and outstanding captures, then deletes through the
partition's captured storage adapter and write queue so an older write cannot restore the cleared
snapshot. Those rows stay drawn until their refetch lands, so the window does not go blank.
The persister writes a new snapshot within five seconds, holding only what was on screen. It is not
`dropNode`, which is for a node leaving the fleet: that also removes the node from the fleet list and
the status map and throws away the `QueryClient` the mounted provider still holds. The page shows the
snapshot's size and entry count, read back from the store. The overflow menu's **Clear cache** is
older and blunter: it clears every node's saved snapshot and reloads the window.

The Workflows pane follows the same rule even though its selected run and steps are Solid resources
rather than persisted query rows. Run and child-change frames re-read the relevant task, and socket
reconnect re-reads both the task's run list and the selected run's steps. The pane model is created
inside the active Node shell, and the task-run index subscribes through that same Node connection.
Identical task or run IDs on two Nodes therefore cannot invalidate or navigate into each other.

No diff segment, parsed row, token, or whole patch is in the query cache. Segments are fetched
outside it and held in the resident segment cache below, and a pull request's document is under a
`files` key that is not persisted (`['files', owner, repo, number, 'diff']`). The providers keep their own parse caches on the node: 64 MB of parsed patches per plugin
process, by digest, which are content-addressed and so can be gone but never wrong. The Changes
plugin's also records which digest the last document gave each file, and a segment request for any
other is refused rather than answered from the cache.

The persisted cache has no version buster. An entry written before a response type gained a required
field survives a relaunch as-is, so change the query key whenever the shape it caches gains a
required field. Nothing else invalidates an old entry. GitHub's file summaries key ends in `'v2'` for that
reason: the response gained `completeness`, and file rows gained `position` and patch state. The
compare key ends in `'v3'`: it gained `completeness`, then its `files` became a diff `document`. The
Agent pane's harness list, `['agents', 'providers']`, holds `AgentProviderDescriptor[]` as the Node
answers it. A descriptor that gains a required field needs a new key there too.

## Resident diff segments

The diff viewer keeps the node's recently read segments in memory, one cache per query client
(`packages/client-core/src/features/diff/segmentCache.ts`). It is a separate store from the query
cache: segments never pass through a query, so the persisted snapshot cannot contain one, and
`DiffPane.test.tsx` checks that a dehydrated client holds no segment text. The cache is never written
to IndexedDB or to a file.

It is a weighted least-recently-used cache with two ceilings, 40,000 rows and 32 MiB of estimated
bytes. Plain rows and colour are weighed apart, and colour goes first. Segments a pane shows, holds
near, or is loading are never evicted. One held segment over a ceiling stays until nothing holds it.
A working tree that saves a file drops that file's superseded patch at once. `dropNode` clears it with
the node's query client, and a node switch reads the other node's. **Clear cache** leaves it alone. It
is never saved and its memory is bounded, and its `clear` drops the claims a mounted diff pane holds,
which is right only for a node that is gone. The keys, the weights, and the
eviction order are in [diff-rendering.md](./diff-rendering.md) § Resident segments.

## Fan-out cache safety

Fleet surfaces fan out one request per Node. A fan-out may warm a Node's regular query cache only when
it writes the exact value shape expected by that query key. For example, a task-list key must contain
`Task[]`, never a derived count. Client code should use `createFleetQuery` and keep aggregate keys
separate from per-Node resource keys when the shapes differ.

## Measurement

The Node logs its storage footprint once at startup, and Settings > Storage and memory asks for the
same sizes while it is open ([data-layer.md § What the node reports](./data-layer.md#what-the-node-reports)).
Neither deletes anything, and the Node does not run a general destructive cache sweep on every
request. Provider mirrors, immutable blobs, plugin databases, logs, and
application-owned records have different retention semantics and must not share a blind deletion
policy.
