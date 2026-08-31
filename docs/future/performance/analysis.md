# Performance: the first read

Analysis, 2026-08-31. One of the two inputs to this programme; [architecture.md](./architecture.md)
is the other, and [phases.md](./phases.md) holds the order of work. Paths are hints, not promises.

This is a first read of the whole app for performance. Nobody has done one before: there is no
benchmark anywhere in the repo, no timing on any request, and four `console.log` marks on the node's
boot. So most of what follows is a structural argument plus a measurement of the one artifact that
can be measured without running anything, the built renderer.

The headline is that the renderer's startup budget is already blown, and a quarter of the startup
payload is an icon set nobody asked for. Everything else is smaller than that.

## What was measured

`apps/desktop/dist/client`, built 2026-08-31, against `apps/desktop/scripts/check-renderer-budget.mjs`:

```
[renderer-budget] startup scripts=1317605B styles=90169B
Error: Renderer startup budget exceeded (scripts 1317605/1250000B, styles 90169/200000B)
```

That check runs inside `pnpm --filter @acorn/desktop build`, so a desktop build is red until the
number comes down. Everything else in this document is read from source.

## The startup payload

144 assets are in the document's script tag and `modulepreload` list, 1,375 KB uncompressed:

| Bytes | Asset | What it is |
| --- | --- | --- |
| 363 KB | `Icon-*.js` | The whole Lucide set: 1,500-odd path definitions |
| 159 KB | `shiki-*.js` | The syntax highlighter core, before any grammar |
| 134 KB | `index-*.js` | The shell entry |
| 82 KB | `index-*.css` | Every stylesheet the kit and the panes declare |
| 79 KB | `install-*.js` | The keymap and its bindings |
| 72 KB | `schemas-*.js` | Zod |
| 49 KB | `activeNode-*.js` | Fleet and node state |
| 45 KB | `DiffPane-*.js` | The diff viewer |
| 26 KB | `prModel-*.js` | GitHub's pull-request model |
| 189 KB | 126 more files | |

### 1. The icon set is 26% of startup

`packages/client-core/src/kit/tokens/iconNodes.ts` imports `lucide-static/icon-nodes.json` whole:
1,756 icons, 706 KB of JSON, minified into a 363 KB chunk. It ships whole because
`kit/components/content/Icon.tsx` resolves `props.name` against the map at render time, so the
bundler cannot see which names are reachable.

**All 1,756 have to stay reachable.** `kit/components/inputs/IconPicker.tsx` fuzzy-searches
`ICON_NAMES`, which is `Object.keys` over the whole map, and `randomIconName()` picks any of them.
A user assigning an icon to a task can pick any one, a plugin manifest can name any one, and both
choices are already persisted. So dropping the unreferenced icons is not on the table, and a
build-time census of the names in the source is the wrong fix by itself: 68 distinct literal names
appear in the tree, which is 4% of the set.

Split it in two instead. Those 68 names are 12 KB of JSON, which covers every icon the app draws from
code, so keep that as an eager map and load the rest on demand behind it. `Icon` reads the eager map
first and the lazy one once it resolves.

One behaviour to get right. Until the full map arrives, an unmatched name falls through to the
`glyph` span fallback and renders as its own literal text, which
`docs/ui-design.md § Icons` calls load-bearing. Nothing breaks, but a user-picked icon would flash the
word `circle-check` before becoming a tick. The 12 KB eager set keeps that off the chrome; have the
picker and anything drawing `tasks.icon` await the lazy map to keep it off the rest.

Expect to recover about 350 KB, which alone puts the build back inside its budget.

### 2. Nothing on the first paint needs a syntax highlighter

`shiki`, `langs`, `languageIds`, `esm`, and `libesm` total roughly 190 KB in the preload list. The
first paint is a rail, a topbar, and an empty workspace. Highlighting belongs behind the same lazy
boundary the grammars already sit behind.

`DiffPane` and `prModel` are in the list for the same reason: something on the startup path imports
them eagerly rather than through the contribution registry. Worth tracing which import pulls each
one in, since that import is the actual bug and the bytes are the symptom.

### 3. 144 module scripts is a waterfall, not just bytes

Each one is a request through the `app://acorn` scheme handler in
`apps/desktop/src-tauri/src/app_scheme.rs`, which means a round trip into Rust and back. The bytes
matter less than the depth of the import graph, and the budget script counts only the first, so a
second measurement is needed: the depth of the preload chain and the time to first paint.

### 4. First paint waits on two node round trips

`apps/desktop/src/client/index.tsx` has two top-level awaits before `render`: `selectActiveNode()`
and `applyNodePlugins()`. Both cross the helper to the node. Nothing draws until they resolve, so the
window is blank for helper spawn, plus node boot, plus two requests. A skeleton behind the gate would
cost little and would make a cold start feel like a start.

The node's own boot makes that worse on macOS. `apps/node/src/composition/runtime.ts` awaits
`inheritLoginShellPath`, which runs `$SHELL -lic 'printf %s "$PATH"'` with a 5-second timeout before
anything else happens. A developer's `.zshrc` with a version manager in it costs half a second to two
seconds, every launch. The `PATH` is needed for spawning agents and build commands, not for binding
the listener, so this can start in the background and be awaited at the first spawn instead.

### 5. Duplicated grammars, 780 KB of the 6.4 MB of JavaScript

`cpp` ships twice at 623 KB each, `ruby` twice at 86 KB, `html` twice, `scss` twice. Vite builds the
highlighter worker as a separate Rollup graph, so anything both graphs import is emitted into both.
It costs disk and download in the installer, not startup, since grammars load on demand. Fixable by
having only the worker import grammars and keeping the main thread on the worker's protocol.

## The agent transcript

The heaviest live surface, and the one with the most per-event work.

### 6. Every streamed event copies and re-sorts the whole event list

`plugins/agents/src/client/sessions/managedStore.ts`, `appendEvent`:

```ts
const duplicate = snapshots()[event.sessionId]?.events.some((item) => item.id === event.id) ?? false
setSnapshots((current) => {
  const snapshot = current[event.sessionId]
  if (!snapshot || snapshot.events.some((item) => item.seq === event.seq)) return current
  return { ...current, [event.sessionId]: { ...snapshot, events: [...snapshot.events, event].sort((a, b) => a.seq - b.seq) } }
})
```

Per event: two linear scans, one array copy, one full sort. The server caps a snapshot fetch at 2,000
events, and the client-side merge accumulates beyond that, so `n` is in the low thousands for a long
session. Events almost always arrive in `seq` order, so the sort is nearly always sorting an already
sorted array.

Both scans want a `Set` of seen ids and a check against the last element's `seq`. The sort wants to
be a tail append with a splice only when the new `seq` is out of order.

### 7. The whole projection rebuilds on every event

`AgentTranscript.tsx` does `createMemo(() => buildConversationItems(props.snapshot.events))`. The
memo's only dependency is the events array, which is a new array per event, so an active turn rebuilds
the entire conversation tree per streamed token-ish event. Combined with item 6 this is quadratic over
a turn.

An incremental projection is the real fix and it is not small. A cheaper first step: hold the events
in a Solid store keyed by `seq` so an append is a keyed write, and project in slices.

### 8. `turns.find` runs once per row per render

Same file, inside the `Index`:

```tsx
turn={props.snapshot.turns.find((turn) => turn.id === item().turnId)}
```

Rows times turns, on every render of the list. One memoized `Map<string, AgentTurn>` above the
`Index` removes it.

### 9. The transcript has no virtualizer, deliberately

Recorded in `docs/managed-agents.md`: a virtualizer was removed because `measure()` churn made output
flash and unselectable. That decision stands, and it means the DOM holds every card in a long session.
Fix items 6 through 8 before revisiting it, because a rebuild-everything projection is what made the
virtualizer thrash in the first place.

### 10. A projected event refetches the whole snapshot

`scheduleSnapshotRefresh` refetches the full snapshot, debounced 50 ms, whenever a `user_message`,
`request`, `request_resolved`, `turn_completed`, or `error` event arrives. Each refetch reads up to
2,000 rows on the node, parses a JSON body per row, base64-encodes twice across the bridge, and
merges with three sorts on the way in.

Those five types are not per-token, so the storm is bounded. It is still a full re-read to learn one
fact, and the node's own projection could send the changed turn or request instead.

## The transport

### 11. Every byte crosses the bridge as base64 inside JSON, twice

`apps/desktop/src/shell/wire.ts` says so plainly, and names its own ceiling:

> base64 costs a third more bytes and one copy each way on a loopback socket, which is nothing next
> to the request it is part of until a response reaches tens of megabytes.

The reasoning is sound and the upgrade path is written down. Two things are worth doing before that
ceiling arrives.

`decodeBytes` decodes one byte at a time in a JavaScript loop:

```ts
const binary = atob(value)
const bytes = new Uint8Array(binary.length)
for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
```

A 5 MB response is 5 million iterations on the renderer's main thread. `Uint8Array.from(binary, (c) =>
c.charCodeAt(0))` is not obviously better; the measured win usually comes from `fetch` with a
`data:` URL or from `TextEncoder` on a latin1 round trip. Measure before choosing.

The path also has two JSON hops, renderer to Rust and Rust to helper, so a large body is parsed and
re-serialized in between. Whether Rust re-parses the payload or forwards the string opaquely is worth
confirming in `apps/desktop/src-tauri/`.

### 12. Every node's frames cross the bridge, then get dropped

`packages/client-core/src/infra/node/wsClient.ts`:

```ts
transport.onFrame((nodeId, raw) => {
  if (nodeId !== activeNodeId()) return
  dispatch(raw)
})
```

The comment explains why the filter is there. What it does not say is that the frame already crossed
two process boundaries and one JSON parse before being thrown away. A background node running a build
sends `term:out` at 60 frames a second for nothing. The helper knows which node is active, so the
filter belongs there.

## The node

### 13. One query per task in the task list

`packages/node-core/src/server/routes/projects/tasks.ts`:

```ts
const projects = new Map<string, Awaited<ReturnType<typeof getProject>>>()
for (const row of rows) {
  if (row.projectId) projects.set(row.projectId, await getProject(db, row.projectId))
}
```

The `Map` looks like a cache but nothing reads it before writing, so this is one `SELECT` per task,
awaited in series, even when every task shares one project. The fix is an `inArray` over the distinct
project ids, the same shape the line above it already uses for `taskLinks`. The rail refetches this
on every `tasks:changed`, so it runs often.

This is the only N+1 the scan found in a request path. Sequential awaits elsewhere are mostly
deliberate ordering: plugin init, teardown, scheduler state writes.

### 14. Sync SQLite, headless terminals, and git spawns share one event loop

The node is one process with one loop, and on it sit:

- `node:sqlite` through the Drizzle shim in `packages/node-core/src/server/storage/sqlite.ts`, fully
  synchronous. WAL and a 5-second busy timeout are set, which is right, but a slow query blocks
  everything.
- A full `@xterm/headless` emulator per PTY session with 1,000 lines of scrollback, in
  `plugins/terminal/src/server/terminalDisplay.ts`, fed every byte the PTY produces.
- Every `git` invocation, through `packages/node-core/src/server/core/git.ts`, with a 16 MB output cap.
- Agent driver JSON-RPC parsing, the workflow runner, and the scheduler.

Nothing here is wrong. The point is that no measurement exists, so the first slow thing to appear
will be a mystery. One request-duration log line behind an environment variable, and a
`process.hrtime` histogram on the git seam and the SQLite shim, would answer most questions before
they get asked.

### 15. `exportSnapshot` reads every event a session ever had

`plugins/agents/src/server/sessions/store.ts` has an unbounded `SELECT` over `agentEvents`, with a
`JSON.parse` per row, synchronous. It is the export path, so it is rare, but it blocks the loop for as
long as it takes and there is no cap.

## The diff viewer

Already the most carefully tuned surface in the app: batched `requestAnimationFrame` measuring, a
tokenizer in a worker, idle-scheduled hydration, and virtualizers on both unified and split lists. Two
things in it are still quadratic in the file count.

### 16. One version signal invalidates every file's status

`packages/client-core/src/kit/diff/hydration.ts` keeps statuses in a plain `Map` and publishes a
counter:

```ts
const status = (path: string): DiffHydrationStatus => {
  version()
  return statuses.get(path) ?? 'idle'
}
```

`DiffPane.tsx` reads `hydrator.status(file.path)` inside a memo over all files, so each of the two or
three `publish()` calls per file rebuilds an array of every file. On a 200-file pull request that is
tens of thousands of iterations and several hundred list re-renders during load.

A signal per path, or a Solid store keyed by path, makes each publish touch one row.

### 17. The parsed-file map is copied per file

Same file: `setParsedByPath((prev) => new Map(prev).set(parsedFile.file.path, parsedFile))`. One full
`Map` copy per parsed file. A keyed store write does the same job in constant time.

### 18. Every token carries both themes

`{ content, light, dark }` per token, so a diff holds roughly twice the token memory it needs for the
theme on screen. Deliberate, since it makes a theme switch free. Worth knowing when a large diff's
memory becomes the complaint.

## Persistence

### 19. The query cache serializes whole, per node, every five seconds

`packages/client-core/src/infra/node/fleet.ts` builds one
`createAsyncStoragePersister` per node with `throttleTime: 5_000`. Patch bodies and blobs are already
excluded by `queryPersistence.ts`, which is the important exclusion. What remains, file summaries for
every visited pull request, tasks, projects, prefs, still serializes as one JSON blob on the main
thread on every write window, once per node.

Measure the blob first. If it is tens of kilobytes this is nothing; if a week of browsing pull
requests grows it into megabytes, the answer is per-key persistence rather than a smaller throttle.

## What to do first

The ordering moved to [phases.md](./phases.md) when this file became one input of two; the companion
read is [architecture.md](./architecture.md). The one standing rule from this file survives there as
the gate: add timing before arguing about anything past the startup payload, because no number in the
agent-transcript or diff sections was measured.

## Verify before building

- `apps/desktop/dist/client` was built 2026-08-31 from a tree at `4b07aae7`. Rebuild and re-run
  `apps/desktop/scripts/check-renderer-budget.mjs` before quoting any byte count here.
- Confirm which import pulls `shiki`, `DiffPane`, and `prModel` into the startup graph. The
  fix is that import, and this document did not trace it.
- Confirm whether the Rust side of `node-fetch` re-parses the JSON body or forwards it opaquely.
- `PROJECTED_EVENT_TYPES` in `managedStore.ts` is the list that drives the snapshot refetch. Check it
  has not grown to include a per-token event type.
- The claim that the transcript's virtualizer was removed on purpose comes from `docs/managed-agents.md`
  and a session note. Read the removal commit before putting one back.
- No number in the agent-transcript or diff sections was measured. They are read from the code. Profile
  a real long session and a 200-file pull request before sizing any of that work.
