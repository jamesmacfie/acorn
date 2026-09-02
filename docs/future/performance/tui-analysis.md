# Performance: the terminal client

Analysis, 2026-09-02. The third read in this folder, after [analysis.md](./analysis.md) and
[architecture.md](./architecture.md), and the first to look at `acorn`, the terminal client under
`apps/tui`. [decisions.md](./decisions.md) is what was decided from it; phases 4 and 9 are the work.
Read at `17a9acdf`. Nothing here was profiled except where a number says how it was measured.

The terminal client is client-core booted under Node with OpenTUI drawing the kit in cells
([docs/tui.md](../../tui.md)). It collapses the desktop's renderer and helper into one process, so
its transport is in-process and cheap. Its costs are elsewhere: what it loads before the first frame,
what it draws for a list, and what a key press walks.

Two facts settle what this read is not about. OpenTUI renders on demand: `requestRender()` schedules
one frame and there is no continuous loop unless something calls `start()`, which nothing here does.
And no tree-sitter worker starts, because no `CodeRenderable` is drawn. Frame rate is not the
problem. The frame's contents and the key path are.

## Startup

### 1. The critical path, in order

`apps/tui/src/main.tsx` is one file of top-level awaits. From process start to first frame:

1. Parse arguments and check the Node version. Free.
2. `await openNode(values.node)` (`apps/tui/src/node/open.ts`). Attaching to a running node is
   synchronous file reads: the lock, `node.json`, the certificate, one X509 parse. Starting a node
   spawns `apps/node` and blocks on its stdout handshake line with a 120-second budget
   (`apps/tui/src/node/supervise.ts`). In a checkout with no build that is a full tsx boot of the
   node, on this client's critical path. Pairing a remote node asks on stdin and must stay here.
3. `installPlatform(opened, ...)` (`apps/tui/src/platform.ts`). Builds the broker and calls
   `connect(nodeId)`, whose protocol probe and WebSocket open are not awaited. Cheap.
4. Nine sequential `await import(...)` of client-core modules, twelve chunk loads in the built
   output. Sequential because each must evaluate after the platform seam exists.
5. `setCacheStorage(fileCacheStorage())`. Installs a storage nothing uses; see item 4 below.
6. `await selectActiveNode()`. In-process fleet read. Cheap.
7. `await import('./App')`. The largest item. The built `App` chunk is 215 KB and its static import
   closure is 110 files and 1.06 MB, measured by walking `from "./chunks/..."` edges in
   `apps/tui/dist`. `apps/tui/src/App.tsx` imports all twelve client plugins statically and calls
   `initClientPlugins` at module scope, which runs every plugin's `init` and `activate`. The agents
   plugin's `activate` fires an HTTP request to prime its session store.
8. `await readJson<Task[]>(tasksRoute)`. One HTTPS round trip, fatal on failure. The shell's own
   tasks query asks for the same rows a moment later.
9. `syncPluginDistribution()` and `watchPluginChanges()`. Not awaited, by design.
10. Two more dynamic imports for the bell.
11. `installRenderGuard()` (`apps/tui/src/renderGuard.ts`). Patches every renderable's layout hook
    with a NaN clamp, which then runs per renderable per layout pass.
12. `await createCliRenderer(...)`. Terminal setup, capability queries, and the `node:ffi` load of
    OpenTUI's native core. `@opentui/core`'s Node entry is 1.52 MB of JavaScript, imported statically
    at the top of `main.js`.
13. `installKeymap(renderer)`.
14. `await render(() => <App .../>, renderer)`. First frame.

The shape is the desktop's: a complete node, then a large module graph, then a round trip, then a
frame. Step 2's start path and steps 7 and 8 are the ones worth moving, and phase 4 moves them.

### 2. The eager graph is half the build

Of 2.05 MB across 198 chunks, 1.06 MB is reachable statically from `App`. Two imports account for
most of what should not be there:

- `apps/tui/src/kit/components.tsx` maps every kit node name to its component, the same shape as
  `packages/client-core/src/host/tree/components.ts` on the desktop, and for the same reason pulls
  every component it names into the graph. `prModel` is in the eager closure because of it.
- `@acorn/plugin-api/ui/editor` is not aliased in `apps/tui/vite.config.ts`. The aliases cover
  `@acorn/plugin-api/ui` and `ui/host` only. So `plugins/editor/src/client/EditorPane.tsx` pulls
  `packages/client-core/src/features/editor/language.ts`, which imports 19 CodeMirror grammar
  packages statically, into a process that draws no CodeMirror. `apps/tui/src/harness.tsx` names the
  cost in its own comment: "the agents pane pulls a highlighter and the editor pulls CodeMirror,
  which is seconds." The `editor` rectangle in `apps/tui/src/kit/rectangle.tsx` already draws the
  file read-only with the `$EDITOR` handoff beside it, so the alias can point at a stub.

Phase 1 fixes both under decision 3.

### 3. Loaded plugins are lazy and cost a thread each

A third-party plugin runs in a `node:worker_threads` worker started with `--permission` flags
(`apps/tui/src/plugins/workerFactory.ts`), one per bundle hash, started on first tree mount and
released 30 seconds after the last unmount. That is a fresh V8 isolate per bundle plus structured
clone per message. It is the right cost for a stranger's code and this read leaves it alone; the
batch-application costs it shares with the desktop are item 17 of the desktop findings and sit in
phase 10.

## Data

### 4. Two query clients, and a cache nobody writes

`apps/tui/src/App.tsx` mints its own `QueryClient` and renders the whole shell under it. Its comment
says "No persister." `packages/client-core/src/infra/node/fleet.ts` mints a different `QueryClient`
per node through `clientFor(nodeId)`, with a `createAsyncStoragePersister` at a five-second throttle,
and that second client is the one `watchTaskChanges`, `watchProjectChanges`, `watchConnectionChanges`,
and `createFleetQuery` write into.

So the client the shell reads is not the client the watchers invalidate, and `main.tsx` installs a
file-backed storage (`apps/tui/src/node/cache.ts`) for a persister that is built and never driven:
nothing in `apps/tui` calls `persistQueryClient`, and the only `PersistQueryClientProvider` in the
repo is the desktop's. Every `acorn` start renders from an empty cache. The storage itself is
synchronous `readFileSync` and `writeFileSync` on the loop that draws, justified by a comment that
says the payload is a few hundred kilobytes, which is the size at which a synchronous write starts to
be a visible frame.

The terminal client also installs none of the desktop's boot watchers: no `applyNodePlugins`, no
`watchNodeEvents`, no `wsOnReconnect`. Whether that is a gap or a choice is not a performance
question and is left to [docs/tui.md](../../tui.md).

## Drawing

### 5. `Rows` is the only virtualiser and three sites use it

OpenTUI has no windowed list, so `Rows` in `apps/tui/src/kit/showing.tsx` is one: it draws
`all.slice(from, from + fit)` and a two-cell scrollbar. But `virtual` is a prop, and only the rail's
sources, the rail's tasks, and the descriptor source panel pass it. The other 39 call sites, among them
the pull-request list, notes, changes, context, docker, and the agents sidebar, build one renderable
per row and let `stopsIn` and `<For>` see all of them.

`virtual` is not a flag that can be defaulted. It swaps the box's flex to grow into its panel, so a
short list would stretch to fill the space its rows do not need. Phase 9 opts the long-list sites in
one by one and refused.md records why the default stays.

### 6. The diff pane builds every row

`DiffPane` in `showing.tsx` says it in its own comment: "There is no virtual window here, the pane is
one scrolling box and every row is built." It is a `<For>` over files inside a `<For>` over rows, one
`<text>` renderable per line, inside one `ScrollViewport`. A 200-file pull request is tens of thousands
of renderables. The annotations effect then rebuilds a joined key string over every code row on every
re-run, and `packages/client-core/src/host/annotations/annotations.ts` joins the keys again to compare
against the last ask.

### 7. The rail recreates every row on every change

`apps/tui/src/chrome/Rail.tsx` hands `<For>` a fresh array: `props.model.tasks().map((task) => ({
key: task.id, task }))`. Solid's `<For>` keys by object identity, so a new array of new objects means
every row renderable is destroyed and rebuilt whenever the task list changes, which is every
`tasks:changed`. `apps/tui/src/chrome/Shell.tsx` does the same for sources, workspaces, and projects.
Inside each row, `<Marks markers={markersFor(...)}>` calls
`packages/client-core/src/host/registries/rail/railMarkerFeed.ts`, which copies and sorts the marker
registry with `localeCompare` per row per render.

### 8. The reconciler adds a closure per dynamic child and a patch per element

`apps/tui/src/kit/reconciler.ts` sits in front of every JSX call in the process. Its `insert` wraps
accessors in new accessors so loose text lands in a `text` node, one closure layer per dynamic child.
Its `createElement` patches `destroyRecursively` on every element and registers an `onCleanup` that
schedules a `process.nextTick`. Both exist for real bugs (docs/tui.md § Loose text under a box and
§ Destroy on disposal). They are a per-element cost worth measuring once phase 0's counter exists, not
a thing to remove.

## Keys

### 9. A key press scans arrays inside a subtree walk

`apps/tui/src/keys/regions.ts` is 1,071 lines and holds the focus model. Its indexes are arrays:
`groups`, `parents`, `containers`. A move (`moveStop` then `walkStops`) calls `stopsIn(box)`, a
recursive walk of the region's subtree, and for every child in the walk does `groups.some(...)`,
`parents.find(...)`, `containers.find(...)`, and `isPanel(child)`, which calls `panels()` on every
parent, and `panels()` in `apps/tui/src/kit/grouping.tsx` allocates a fresh array on every call.
`moveStop` runs `stopsIn` twice per key. Writing focus then walks parents three more times: reveal in
viewports, find the region, and settle on the next frame.

`scheduleSettle()` is guarded to one run per turn, but it is scheduled by a dozen callers, and a
settle calls `reachable(node)` (two parent walks) and possibly `entryStop(group.box)`, two more
subtree walks.

### 10. The footer disables the keymap's cache and asks twice

`apps/tui/src/chrome/Footer.tsx` calls `activeHints()` in `apps/tui/src/chrome/bindings.ts` during
render, and `activeHints()` calls `engine.getActiveKeys()` twice. `@opentui/keymap` 0.5.9 caches
active keys only while `state.activeKeyCacheBlockers === 0`, and `layerBlocksActiveKeyCache(layer)`
returns true for any layer, command, or binding with a runtime matcher. This host installs matchers
everywhere: `packages/client-core/src/kit/keys/keymapHost.ts` puts `active: () => !typing()` on every
bare-key intent binding, `apps/tui/src/keys/commandLayer.ts` puts `active` on every resolved
keybinding, and `apps/tui/src/keys/install.ts` adds more. The counter is global, so one such layer
turns the cache off for the whole process and both `getActiveKeys()` calls do a full collect over all
active layers, per footer render. The keymap has no enable or disable call on a layer; the only way to
change a layer's matchers is to register or unregister it.

`regionsInScope()` also sorts a fresh array on every call, and `activeHints()` calls it per render.

### 11. Every rectangle intercepts every key

`apps/tui/src/kit/rectangle.tsx` registers `engine.intercept('key', ...)` at the rectangle tier for
every mounted rectangle, entered or not, because an entered rectangle answers every key. Unentered
ones return early, but the intercept runs before the layers do.

### 12. The trace flag writes synchronously per key

`ACORN_TUI_KEYS_TRACE` (`apps/tui/src/keys/install.ts`) is the developer's first tool for a focus
bug and appends one line per key with `appendFileSync`. Fine for a trace; not fine to leave on while
measuring anything else.

## Terminal rectangles

### 13. The third parse is inherent

A PTY drawn in cells is parsed three times: `@xterm/headless` on the node keeps the canonical screen
(`plugins/terminal/src/server/terminalDisplay.ts`), the bytes cross the wire as JSON strings, and
`apps/tui/src/kit/pty.ts` writes them into OpenTUI's `EmbeddedTerminalRenderable`, a second full
emulator in the native cell buffer. The first parse is the node's contract and phase 6 gates it on
attachment; the third is how a terminal draws a terminal and stays. What phase 6's binary frames buy
this host is the same as the desktop: one encode per broadcast and no JSON escaping of terminal
bytes.

## Instrumentation

### 14. What exists

- `ACORN_TUI_KEYS_TRACE`: one line per key, synchronous. See item 12.
- `OTUI_SHOW_STATS`: OpenTUI's own overlay with frame time and render time. The only live frame-cost
  readout today.
- `TimeToFirstDraw`, exported by `@opentui/solid`. Not used anywhere in the repo.
- `ACORN_FIXTURE_DELAY_MS`, `ACORN_FIXTURE_PULLS`, `ACORN_FIXTURE_PATCH_LINES`: fixture knobs in
  `apps/tui/src/fixture.ts` that add latency to the stub transport and inflate the pull-request list
  and diff. They are how a large-list case is reproduced without a large repository.
- `apps/tui/src/harness.tsx` waits `settle(3000)` then `settle(1000)` then twenty times
  `settle(200)` before reading a frame, and its `until(text)` defaults to 15 seconds "because a cold
  compile of the agents pane is seconds". Those constants are the current cost written down as
  timeouts.

No `performance.now`, `process.hrtime`, or `console.time` appears in `apps/tui/src`. Phase 0 adds
the marks.

## Verify before building

- The eager-graph number (110 files, 1.06 MB) came from a build on 2026-09-02. Rebuild with
  `pnpm --filter @acorn/tui build` and re-walk before quoting it; phase 0 turns the walk into
  `apps/tui/scripts/check-startup-graph.mjs` (new) so this stops being a manual step.
- Confirm `apps/tui/vite.config.ts` still aliases only `@acorn/plugin-api/ui` and `ui/host` before
  adding the `ui/editor` alias.
- Confirm `apps/tui/src/App.tsx` still constructs its own `QueryClient`, and that `fleet.ts` still
  builds a persister per node.
- The keymap cache claim was read from `@opentui/keymap@0.5.9`'s `layerBlocksActiveKeyCache`. A
  newer keymap may cache per layer, which would change phase 9's design for the typing gate.
- `Rows`'s `virtual` layout swap is in `showing.tsx` around line 343. Read it before deciding any
  default.
