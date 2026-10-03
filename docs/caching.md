# Caching

This page covers acorn's cache layers: provider mirrors, the blob cache, plugin bundle custody, the
renderer's query cache, and resident diff segments. Read it before you add a cache or change what one
holds. None of them replaces the source of truth that owns the data.

## Provider mirrors

The GitHub plugin stores repository and pull request projections in `plugins/github.sqlite`. Linear
and Rollbar use the core external-item projection. Reads serve, then revalidate:

1. Resolve the resource and its freshness marker.
2. Serve a usable local projection when one exists.
3. Refresh in the request, or in a bounded background operation, when the policy says it's stale.
4. Replace or update the projection and its freshness marker.

Mirror collections are disposable. A full list refresh can delete and rebuild rows, so repositories or
issues the provider no longer shows leave the UI. A provider error keeps a usable stale projection and
returns its freshness. A cold read with no projection reports the provider failure.

GitHub's policies are in `plugins/github/src/server/`, with TTLs per resource. Repositories and open PR
lists use ETags where the provider supplies them, and a `304` only advances the freshness timestamp. An
explicit `force` request blocks for a fresh answer.

Each staleness TTL lives with the plugin whose API it describes, because how fast a provider's data
moves is a fact about that provider. The engine's own policy (`server/sync/policy.ts`, `engine.ts`)
keeps one value: how long a rate-limited key waits before another background refresh. A provider that
set its own backoff could keep hammering an API that already said no. `read()` takes a per-call
`backoffMs` for a provider that publishes `Retry-After`.

Provider item resources have their own freshness markers, so a Rollbar item list, item detail, and
occurrence history can be stale separately.

Linear's rail, its `issues-mine` collection, and its batch reference resolution don't serve then
revalidate. They read across every connected workspace with partial results, and a bare identifier
isn't tied to one connection, so there's no single marker. They resolve against each connection and
write what they find into the external-item store. Linear's issue detail route uses the mirrored
resource as normal.

## Immutable blob cache

`BLOBS` is an on-disk, content-addressed cache under `<data-root>/blobs/`. A GitHub patch body is keyed
by a SHA-256 digest of the patch text, `patch:sha256:<hex>`, because a head blob SHA doesn't identify a
patch: the same file has a different patch against a different base. A new-side file body is keyed by
its blob SHA, `filebody:<sha>`. Attachments and agent artifacts use the same storage.

Beside each patch body, the GitHub plugin stores the segment descriptors it cut,
`diffdoc:v<version>:sha256:<hex>`, so a diff document's topology is read from small blobs rather than
parsed ([the document](./diff-rendering.md#the-document)). A new segmenter version reads new keys and
cuts again. A compare preview writes its patch bodies under the same `patch:` keys.

A GitHub file row says whether its patch is available. An available patch whose body is missing is an
integrity failure, and the files route repairs it with a blocking refresh. A summary read touches no
blob. A miss fetches the provider body, checks the expected digest where there is one, and writes it to
a staged file renamed over the entry, so a reader never gets half a body. The cache is local to a Node
and holds public and private repository content.

**Nothing prunes the cache.** `BlobCache` has `get` and `put` and no delete, so superseded patches,
pre-digest `patch:<sha>` bodies, and descriptor blobs from older segmenter versions all stay. A compare
preview writes up to 300 patch bodies each time it loads. A pruner would have to respect the references
plugin records keep.

Opening the cache sweeps the directory once, and the sweep is a permission migration: `put` writes mode
`0600`, so a file with any other mode came from an older build. It chmods only a file whose mode is
wrong, read off the `lstat` it already does, because the sweep is synchronous and runs before the
listener. An unconditional `chmod` over 2,975 blobs cost 102 ms of every boot, measured on September 3,
2026 (`packages/node-core/src/server/bindings.ts`).

## Plugin bundle custody

The device keeps client bundles by the SHA-256 it computes from the bytes it received. An advertised
Node hash is a lookup hint, checked before caching, and the trust decision is a separate record keyed
by `(pluginId, hash)` ([third-party plugin bundles](./security/plugin-bundles.md)). One cache file can
serve the same bytes offered by several Nodes, and offer provenance records which ones. Reconciliation
visits both a Node's active runtime and its installed disk candidate, so an update can be reviewed
without displacing running UI. The Node keeps its active client bundle apart from the package directory
and serves it by hash after an update or uninstall until that runtime stops.

The cache doesn't persist a selected fleet winner. Each session derives per-Node selections from
runtime observations, cached bytes, and custody decisions. Stale or unreachable observations stay
available for explanation but can't authorize a contribution.

## Renderer query cache

The renderer uses TanStack Query with one `QueryClient` and one persister per Node. The persister key is
scoped to the Node, so identical task or repository IDs on two Nodes can't collide. One client per Node
is a contract: nothing on any host may add another ([booting client-core](./tui.md#booting-client-core-under-node)).

The shell mounts on the last-known active Node's partition, read synchronously on the first tick
(`packages/client-core/src/infra/node/activeNode.ts`), because the window opens before the helper says
which Nodes exist ([startup readiness](./frontend.md#startup-readiness)). The fleet answer corrects it,
and a Node that has gone triggers the `node-replaced` reload. A launch with nothing remembered renders
onboarding.

The host decides where a partition is written, through `setCacheStorage`. IndexedDB is the default, and
the terminal client installs a directory of files. Each partition captures its adapter when built.

`packages/client-core/src/infra/persistence/queryCacheLifecycle.ts` owns persistence for the selected
partition. Both hosts take a lease. Concurrent leases share one restore and one subscription, and a
later remount restores again. Hydration keeps fresher in-memory rows.

- Meaningful query and mutation events mark the partition dirty. One five-second clock coalesces
  dehydration, serialization, and the write, and observer-only changes schedule nothing. Writes run one
  at a time, with a follow-up if changes arrive during one. Capture reports `cache.dehydrate` and
  `cache.dehydrate.count`.
- Releasing the last lease stops the subscriptions, and pending durability survives an ordinary switch.
- Retiring a Node stops every subscriber and queued capture, fences reads, drains started writes, and
  deletes through the captured adapter. A replacement with the same Node ID waits for the deletion.
- A failed deletion stays a barrier, is logged, and isn't retried in a loop. The fleet's
  `retryCacheRetirement(nodeId)` retries it, then restores and flushes a mounted replacement, and
  rejects if any step fails.

The persisted cache gives fast last-known reads, not mutation confirmation. While a Node is reconnecting
or offline, cached answers stay visible with freshness badges. A reconnect or sequence gap marks data
stale and fetches again. There's no history cursor and no offline mutation queue.

Two ages bound it (`packages/client-core/src/infra/persistence/queryPersistence.ts`). A snapshot is
restored if it was written in the last seven days, so the first launch after a weekend draws last-known
rows. An entry goes into the next snapshot only if it was fetched in the last day, matching `gcTime`.

**Clear cache** on Settings > Machines > Storage and memory empties the cache of the Node the settings
header names, while it stays connected (`clearNodeCache` in `packages/client-core/src/infra/node/fleet.ts`).
It removes every entry nothing draws, deletes the saved snapshot through the partition's adapter and
write queue, and fetches the queries on screen again, so the window doesn't go blank. It isn't
`dropNode`, which also removes the Node from the fleet and discards its `QueryClient`. The page shows
the snapshot's size and entry count. The overflow menu's **Clear cache** clears every Node's snapshot and
reloads the window.

The Workflows pane follows the same rule with Solid resources. Run and child frames read the task
again, and a reconnect reads the run list and the selected run's steps. Its model lives inside the
active Node's shell, so identical IDs on two Nodes can't cross.

No diff segment, parsed row, token, or whole patch is in the query cache. A pull request's document sits
under a `files` key that isn't persisted (`['files', owner, repo, number, 'diff']`). Each provider keeps
up to 64 MB of parsed patches per plugin process on the Node, by digest. The Changes plugin also records
which digest the last document gave each file, and refuses a segment request for any other.

**The persisted cache has no version buster.** An entry written before a response gained a required
field survives a relaunch, so change the query key when the cached shape gains one. GitHub's file
summaries key ends in `'v2'` and the compare key in `'v3'` for that reason. The Agent pane's harness
list, `['agents', 'providers']`, needs a new key too if `AgentProviderDescriptor` gains a required field.

## Resident diff segments

The diff viewer keeps the Node's recently read segments in memory, one cache per query client
(`packages/client-core/src/features/diff/segmentCache.ts`). Segments never pass through a query, so the
persisted snapshot can't hold one, and `DiffPane.test.tsx` checks that. It's never written to IndexedDB
or a file.

It's a weighted least-recently-used cache with two ceilings, 40,000 rows and 32 MiB of estimated bytes.
Plain rows and colour are weighed apart, and colour goes first. Segments a pane shows, holds near, or is
loading are never evicted. A working tree that saves a file drops that file's superseded patch.
`dropNode` clears it, and **Clear cache** doesn't, because its `clear` drops claims a mounted pane holds
([resident segments](./diff-rendering.md#resident-segments)).

## Fan-out cache safety

Fleet views send one request per Node. A fan-out may warm a Node's query cache only with the exact value
shape that key expects: a task-list key holds `Task[]`, never a count. Use `createFleetQuery`, and keep
aggregate keys apart from per-Node keys when the shapes differ.

## Measurement

The Node logs its storage footprint at startup, and Settings > Storage and memory asks for the same sizes
while it's open ([what the node reports](./data-layer/backup-and-retention.md#what-the-node-reports)).
Neither deletes anything. Mirrors, blobs, plugin databases, logs, and application records have different
retention rules and must not share a blind deletion policy.

## Task script snapshots

The client query key is `['task-scripts', 'v1', taskId]` in the selected Node's cache. A task-addressed
`tasks:changed` notice invalidates that task's script query as well as its task rows, and a reconnect
refreshes. Active views also refresh every 15 seconds. Core sends content-free invalidations after
lifecycle writes and archive-gate changes, and log tails are fetched on demand. A stale or offline
running snapshot doesn't assert that the process is alive.
