# Phase 4: the terminal client draws first, from disk

Status: not started. Waits on phase 0 for `TimeToFirstDraw`; phase 1 shrinks what it loads but is not
a dependency.

## Goal

`acorn` renders its shell from a persisted query cache before it has heard from the node, under the
same per-node query client every other host uses. When it attaches to a running node, the first frame
waits on nothing but the module graph and the renderer. When it starts a node, the shell is visible
while the child boots. This is [decisions.md](./decisions.md) decisions 2 and 6 for the terminal
client, and [tui-analysis.md](./tui-analysis.md) items 1 and 4 are the read behind it.

## Why this phase, and why now

`apps/tui/src/main.tsx` awaits, in order: `openNode`, nine client-core imports, `selectActiveNode`,
`import('./App')`, a tasks request, then `createCliRenderer`, then `render`. Two of those are the
desktop's mistake in a second host. `import('./App')` evaluates a 1.06 MB graph and runs every
plugin's `activate` before a frame exists, and `readJson(tasksRoute)` is a round trip whose answer the
shell's own tasks query fetches again a moment later. When this TUI is the one starting the node,
`openNode` also blocks on the child's handshake line, 120 seconds of budget and a full tsx boot in a
checkout, with the terminal showing nothing.

The cache is the sharper finding. `apps/tui/src/App.tsx` builds its own `QueryClient`, comments "No
persister", and renders the shell under it. `packages/client-core/src/infra/node/fleet.ts` builds a
different `QueryClient` per node, with a `createAsyncStoragePersister` over the storage seam, and that
one is what `watchTaskChanges` and its siblings invalidate. `apps/tui/src/node/cache.ts` installs a
directory of files behind that seam, and nothing calls `persistQueryClient`, so the directory is
never written. The shell reads a client nobody invalidates, and every start is cold.
[docs/caching.md](../../caching.md) § Renderer query cache says one client and one persister per
node; this host did not keep the contract, and the fix is to keep it rather than to build a second
one.

## Scope

In:

- `App.tsx` renders under `clientFor(opened.nodeId).client`. Its own `QueryClient` goes.
- `persistQueryClient` from `@tanstack/query-persist-client-core`, called once in `main.tsx` with
  the persister `clientFor` already built, and its `restorePromise` awaited before `render`. The
  package is declared in `apps/tui/package.json`; it is bundled because `apps/tui/vite.config.ts`'s
  `isReactiveRuntime` matches `@tanstack/`, so there is one copy.
- `fileCacheStorage` writes with `fs/promises` `writeFile` to a temp name and renames, off the render
  loop. Reads stay synchronous; they happen once, before the renderer exists.
- `readJson(tasksRoute)` leaves the critical path. The shell's tasks query is the source; `--task`
  resolution waits on that query's first answer and fails the same way it fails today.
- The renderer is created before `openNode` in the start path. `startNode` spawns with stderr piped
  rather than inherited, its lines held the way `heldWarnings` are held and printed after
  `renderer.destroy()`, and the footer shows `starting` from the node connection state until the
  handshake arrives. The attach path is already synchronous at `openNode` and needs no reorder.
  Pairing a remote node asks a question on stdin and stays before the renderer.
- `initClientPlugins`'s fire-and-forget HTTP (the agents plugin's `loadAll`) is deferred to after
  the first `frame` event.

Out: the module graph's size (phase 1). The nine sequential imports, which are cheap once the graph
is small; measure before touching them. Any change to pairing.

## Design

**One client, one persister.** `main.tsx` already calls `setCacheStorage(fileCacheStorage())` before
`selectActiveNode()`, which is what builds the first node's cache, so the storage is installed in time.
After `selectActiveNode()` resolves, `const { client, persister } = clientFor(opened.nodeId)` and
`persistQueryClient({ queryClient: client, persister, maxAge, dehydrateOptions })` with the same
`maxAge` and `shouldPersistQuery` the desktop passes (`packages/client-core/src/infra/persistence/queryPersistence.ts`).
The returned `restorePromise` is awaited before `render`, which is the terminal's `isRestoring`.
`App` takes the client as a prop and hands it to `QueryClientProvider`. Every invalidation the
watchers perform lands where the shell reads.

**Async writes, atomic.** `setItem` writes `<key>.json.tmp` with `writeFile` and renames over the
target. A crash mid-write leaves the old file; a reader never sees a partial one. The five-second
throttle stays.

**The start path draws while the child boots.** `openNode`'s start branch returns a promise for the
handshake rather than awaiting it; `installPlatform` takes the node id and endpoint from the
handshake when it arrives, so the broker is built then. Until then the connection state is
`connecting`, which the footer already draws as a sentence. The child's stderr is the only thing that
could paint over the screen, so it is piped and held. The attach branch is unchanged.

**`--task` waits on the query.** A `createEffect` on the tasks query's data resolves the id once and
calls `activateTaskSignals` or prints the "No task" line and quits, after handing the terminal back.

## Code touched

- `apps/tui/src/main.tsx`: order, `persistQueryClient`, the deferred `--task`.
- `apps/tui/src/App.tsx`: client as a prop.
- `apps/tui/src/node/cache.ts`: async atomic writes.
- `apps/tui/src/node/open.ts`, `apps/tui/src/node/supervise.ts`: the start branch returns early;
  stderr piped and held.
- `apps/tui/src/platform.ts`: broker built when the endpoint is known.
- `apps/tui/src/chrome/Footer.tsx`: `starting` reads from the connection state it already draws.
- `apps/tui/package.json`: the dependency.

## Tests

- `apps/tui/src/node/boot.test.ts`: after one run against a fresh config directory, `cache/` holds
  one file named by the partition key; a second run with the node killed renders the task rows from
  it (drive the built bundle with a fixture data root, as the boot test already does).
- `cache.test.ts` (new): a write interrupted between temp and rename leaves the previous value
  readable.
- `chrome.test.tsx`: with the node handshake delayed by `ACORN_FIXTURE_DELAY_MS`, the first frame
  shows the shell and a `starting` footer, and the rail fills when the handshake lands.
- The keys and reachability suites are unaffected; run them.

## Docs owed

`docs/tui.md` § Where the TUI keeps things: the cache directory is written now; § Attach or start: the
renderer starts before a started node's handshake; § Booting client-core under Node: one query client
per node. `docs/caching.md` § Renderer query cache: the terminal client keeps the contract.

## Done when

- `TimeToFirstDraw` attached to a running node with a warm cache is under 300 ms on a developer
  laptop, measured by the phase 0 marks over five runs.
- `acorn` started against a stopped data root shows the shell and `starting` within the same budget,
  and the rail fills when the node's handshake arrives.
- `tasks:changed` on the node updates the rail without a restart, which proves the shell reads the
  client the watchers write.
- The boot test passes against a fresh config directory and against a warm one.

## Verify before building

- Confirm `App.tsx` still builds its own `QueryClient` and `main.tsx` still awaits the tasks request.
  Read at `17a9acdf`.
- Confirm `fleet.ts`'s `clientFor` still returns the persister, or exposes enough to call
  `persistQueryClient`; if it hides it, widen `clientFor` rather than building a second persister.
- Confirm `@tanstack/query-persist-client-core` is the framework-free entry at the version in
  `pnpm-lock.yaml`.
- Confirm `supervise.ts` still spawns with stderr inherited; if it already pipes, the hold is the
  only change there.
- The 300 ms target is a proposal. Replace it with the measured cold number minus the moved awaits
  once phase 0 has run.
