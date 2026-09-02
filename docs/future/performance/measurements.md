# Performance: the measurements

The numbers each phase produced, with the command that produced them, so a later phase argues from a
figure rather than from an impression. Phase 10 re-reads this file, and several phases are gated on a
value an earlier one recorded.

Append a dated section. Do not edit an older one: a number that turned out to be wrong gets a new entry
saying so, because a phase that was decided on the old figure was decided on the old figure.

## 2026-09-02 — phase 0

Machine: this developer's M-series macOS laptop, Node 24.11.0 (Node 26.8.1 for the terminal client's
build). Nothing else in the programme had shipped.

### The renderer's startup budget

`pnpm --filter @acorn/desktop build` → `apps/desktop/scripts/check-renderer-budget.mjs`.

| | Startup scripts | Styles | Startup assets | Preload depth |
| --- | --- | --- | --- | --- |
| Before, at `92fef8e0` | **1,329,679 B** (RED, budget 1,250,000 B) | 92,153 B | 148 | — |
| After the icon split | **974,732 B** (green) | 92,153 B | 151 | 4 |

The 1,329,679 B figure is this phase's own re-measurement. `decisions.md` recorded 1,324,279 B on
2026-09-02 and analysis.md 1,317,605 B on 2026-08-31, so the tree drifted 12 KB further the wrong way
in between. That drift is the whole argument for the denylist.

Two numbers the script now also prints:

- **Preload depth 4.** The longest chain of static imports from the entry chunk. The first read argued
  that 143 requests through the custom scheme handler is a waterfall; it is four rounds deep and
  otherwise parallel, so depth is not where the time is. That does not settle whether the scheme
  handler itself is slow per request — nothing here measures that.
- **74 more chunks, 1,727,294 B one dynamic import away**, not counted against the budget. Reported,
  not gated: the `__vite__mapDeps` array is the union over every import site in the entry chunk, so a
  legitimately lazy pane is in it and always will be. Denylisting it would fail forever.

### The icon split

`pnpm --filter @acorn/client-core icons`, then the build above.

| | Value |
| --- | --- |
| Census: Lucide names spelled as literals in product code | **77** |
| `iconNodes.eager.json` | 13,750 B |
| `Icon-*.js` chunk, in the startup list | **15,847 B** (was 371,214 B) |
| `icon-nodes-*.js` chunk, lazy, not in the startup list | 368,667 B |
| Lucide icons in total | 1,756 |

The phase file said "sixty-eight names" from a grep on 2026-08-31. The script says 77, and the script
is the number: it counts `name="…"`, `icon: '…'` and `glyph: '…'` literals that are Lucide names, over
`packages/`, `plugins/` and `apps/`, excluding test files (a test's icon name is a fixture; nothing
draws it). The whole startup saving is 354,947 B, which is 27% of what the renderer used to load.

### The terminal client's eager graph

`pnpm --filter @acorn/tui build` → `apps/tui/scripts/check-startup-graph.mjs`.

| | Value |
| --- | --- |
| Chunks reachable statically from the `App` chunk | **110** |
| Bytes in that closure | **1,114,282 B** |
| Whole build | 2,100,437 B |
| Ceiling set by this phase | 1,150,000 B |

Reproduces `decisions.md`'s "110 chunks, 1.06 MB of 2.05 MB" exactly. The ceiling is the measured value
rounded up by about 3%, not the measured value itself: an exact ratchet goes red on a comment in a
client-core file, and this check exists to catch a 300 KB regression.

The icon split changed this number by zero, because the terminal client aliases both halves of the
icon set to an empty table — there is no SVG in a cell.

### The node's boot breakdown

**This is the number phase 3 is gated on.** `refused.md` § A 503-until-ready node contract says the
wire contract ships only if the plugin passes dominate the boot after concurrency, taken as over
300 ms.

Measured by calling `startServiceRuntime` directly against a data root, under `tsx`, and reading the
`[service:boot]` lines. Two roots: an empty one (11 plugins, no loaded packages) and a copy of this
machine's `apps/node/.acorn` (16 plugins — 5 of them loaded from disk — a 1.6 MB `core.sqlite` and a
159 MB `agents.sqlite`), which is the realistic one.

| Step | Realistic root, first boot | Realistic root, second boot | Empty root, first boot | Empty root, second boot |
| --- | --- | --- | --- | --- |
| `login-shell` | 0 ms | 0 ms | 0 ms | 0 ms |
| `bundled-packages` | 10 ms | 8 ms | 14 ms | 7 ms |
| `migrate` | 6 ms | 4 ms | 220 ms | 4 ms |
| **`graph`** (the plugin loader) | **338 ms** | **125 ms** | 1 ms | 1 ms |
| all plugin `init` passes | **46 ms** | **24 ms** | 25 ms | 12 ms |
| all plugin `ready` passes | **0 ms** | **0 ms** | 0 ms | 0 ms |
| `cert` | 1 ms | 1 ms | 1 ms | 1 ms |
| `bind` | 7 ms | 7 ms | 20 ms | 8 ms |
| `scheduler` | 1 ms | 1 ms | 3 ms | 1 ms |
| **total to `listening`** | **412 ms** | **172 ms** | 287 ms | 36 ms |
| `reconcile.*`, after listening | 62 ms | 8 ms | 3 ms | 3 ms |

Per plugin, realistic root, first boot: `github` 24 ms, `memory` 7 ms, `agents` 3 ms, `terminal` 3 ms,
`browser` 1 ms, `changes` 1 ms, `workflows` 2 ms, `database` 2 ms, `http` 1 ms, and `docker`, `editor`,
`notes`, `preview`, `linear`, `model-providers`, `rollbar` all under 1 ms. **No plugin declares a
`ready`,** so that pass is free.

Three conclusions:

1. **Phase 3 must not ship the 503-until-ready wire contract.** The plugin passes are 46 ms cold and
   24 ms warm, an order of magnitude under the 300 ms bar. Binding the listener before plugin init
   would buy at most 46 ms and cost a wire contract every client and the MCP child would honour
   forever.
2. **What actually dominates the node's boot is `graph`, the plugin loader** — 338 ms cold, 125 ms
   warm, 82% and 73% of the boot. That is `loadExternalPlugins` scanning the data root's install
   directory, reading and verifying each manifest, importing each bundle, and running its migrations
   chain. It runs **in front of** plugin init, so no amount of concurrency in the init pass helps. If
   phase 3 wants the node listening sooner, the loader is the target.
3. `migrate` costs 220 ms only on a first-ever boot, and 4-6 ms thereafter. Not worth optimising.

Caveat, and it matters: measured under `tsx`, so `graph` includes transpiling whatever TypeScript the
loader pulls in. The five loaded packages in that root are built JavaScript bundles, so most of the
338 ms is real filesystem and import work, but a packaged build would be somewhat faster. Re-measure
against the staged `service.js` before deciding how much of the loader to rework.

### The desktop's cold-start timeline — NOT measured

Every process now prints its own marks and the code is in place, but nobody has read the four accounts
side by side, so there is **no measured desktop cold-start timeline in this file**. Taking one means
launching the packaged shell with `ACORN_PERF=1` in its environment and `localStorage.acorn.perf = '1'`
in the renderer, then reading Rust's spawn, `[helper:boot] ready line`, `[service:boot] listener-up`,
`[renderer:boot] first paint` and `[renderer:boot] nodeReady` together. That needs the app running and
a person watching it, which this phase could not do. Phase 2 needs the number and should take it first.

The terminal client's own timeline is likewise unread: `[acorn:boot]` prints on exit, but reading it
means running `acorn` against a live node on Node 26.4.

### What the histograms said — NOT measured

`ACORN_PERF=1` turns on a `git` histogram, a SQLite histogram and a line per request, and none of them
has been read against real traffic. Phase 5 is the phase that needs them (`git status` fan-out) and
should be the one to record them here.

## 2026-09-03 — phase 1

Same machine, Node 24.11.0 (Node 26.8.1 for the terminal client). Phase 0 had shipped at `17b03dbe`;
nothing else in the programme had.

### The renderer's startup budget

`pnpm --filter @acorn/desktop build` → `apps/desktop/scripts/check-renderer-budget.mjs`.

| | Startup scripts | Styles | Startup assets | Preload depth |
| --- | --- | --- | --- | --- |
| After phase 0 | 974,732 B | 92,153 B | 151 | 4 |
| After phase 1 | **654,403 B** | 91,571 B | 133 | 4 |

**320,329 B off the first paint, 33% of what was left**, and 18 fewer requests. Against the pre-phase-0
figure of 1,329,679 B the two phases together have taken 675,276 B, just over half.

The four denylisted names are gone. The script's `KNOWN` allowance list is empty and a test in
`apps/desktop/test/scripts/checkRendererBudget.test.ts` asserts that it is:

```
[renderer-budget] startup scripts=654403B styles=91571B assets=133 depth=4
[renderer-budget] one interaction away: 109 more chunks, 1509975B (not counted)
```

No `KNOWN FAILURE:` lines, where the same command printed three before. Proof by name, from the built
startup list: `shiki` — absent, and two `shiki-*.js` chunks exist in the build, so it is fixed rather
than renamed. `DiffPane` — absent, two chunks exist. `wasm` — absent. `viewState` — absent, one chunk
exists (see the editor below). `icon-nodes` — absent, phase 0's.

`prModel` needs its own line, because it is the one that moved rather than shrank. There is **no
`prModel-*.js` chunk in the build any more**: making the GitHub plugin's PR pane a lazy contribution
took `prModel.ts` out of the eagerly-reachable set, and rolldown folded its modules into a chunk it
named `prSections-*.js`, which is not in the startup list. A chunk name is one module's name, so it
follows the graph. Both names are on the denylist now.

### Where those bytes were, and what the reads got wrong

The `RemoteTree` chunk is in the modulepreload list on every cold window because it is the fallback
branch of `host/tree/Slot.tsx`, and it held `host/tree/components.ts`, whose one static import of
`DiffPane` pulled `features/diff/` and, through `infra/highlight/worker.ts`, the highlighter. That part
of decision 3 was exactly right. Two other parts were not:

- **`host/frames/remoteSolid.ts` is not a second copy of the component table.** It builds
  `KIT_NODE_COMPONENTS` with `Object.fromEntries(KIT_NODES.map(...))` — one factory per name that mints
  a node of that name. It imports no component and can import none: it runs inside a stranger's worker
  and touches no `window`. There was nothing to merge, and merging would have broken the sandbox rule.
  It was not touched.
- **`Markdown` was not the shiki edge.** `kit/components/content/Markdown.tsx` already reached the
  highlighter through `await import('../../../infra/highlight/shiki')` and its grammars through
  `infra/highlight/langs.ts`, which is loaders already. It is a loader in the table now for the
  streaming-transcript reason, not for a byte saving.
- **`prModel` was not a registry-holds-values problem in any of the four tables.**
  `plugins/github/src/client/index.ts` imported `./pullDetail/PrPane` statically to read
  `prPaneContribution`, which the same file declared beside the component — so the contribution row
  held the component, and with it the pull-request model, the overview, the conversation, the file list,
  the check log and the diff viewer. Every sibling plugin's pane contribution was already a `lazy()` in
  a module of its own; this was the one exception, and the phase file's Scope said pane contributions
  "already are" lazy. The fix is `plugins/github/src/client/pullDetail/paneContribution.ts`, the
  sibling shape.

### The editor's grammars

| | Value |
| --- | --- |
| `viewState-*.js` — the chunk holding `features/editor/language.ts` | **60,861 B** (was 954,915 B) |
| Chunks in the build that hold a CodeMirror grammar | 17 |
| Of those, statically reachable from `language.ts`'s chunk | **0** |
| Grammar packages imported statically by `language.ts` | **0** (was 17) |
| Opening a `.ts` file, once the editor pane is loaded | **2 more chunks, 110,946 B** |

**894,054 B off the editor's lazy chunk, 94% of it.** The count is 17 grammar imports, not the 19
decisions.md and the phase file both say: 13 `@codemirror/lang-*` packages and 4
`@codemirror/legacy-modes` modes. `@codemirror/language` and `@codemirror/state` are the engine, not
grammars, and stay static.

The two chunks a `.ts` file fetches are the `lang-javascript` grammar and one shared Lezer chunk;
everything else CodeMirror needs came with `basicSetup` when the pane loaded. "One grammar" is the
honest claim rather than "one chunk". The four JavaScript dialects resolve the same package, so a
`.tsx` file after a `.ts` one fetches nothing.

### The terminal client's eager graph

`pnpm --filter @acorn/tui build` → `apps/tui/scripts/check-startup-graph.mjs`.

| | Chunks | Bytes | Whole build |
| --- | --- | --- | --- |
| Before (phase 0's figure, re-measured) | 110 | 1,114,282 B | 2,100,437 B |
| After phase 1 | 111 | **1,024,422 B** | 2,109,214 B |
| Ceiling now held | | **1,060,000 B** | |

**89,860 B, 8%. The phase file's `Done when` asked for under 550 KB and this does not reach it**, and
the reason is that the phase file was wrong about where the terminal client's eager bytes are. Two
findings:

- **This host's kit table was never in its eager graph.** `apps/tui/src/plugins/RemoteTree.tsx` is
  loaded lazily, so `apps/tui/src/kit/components.tsx` and everything under it — the 173 KB `RemoteTree`
  chunk included — is fetched only when a loaded plugin draws a tree. Decision 3's claim that this
  table "is why that host's eager graph is half its whole build" is false. The table took the shared
  `KitTable` type for parity and kept every entry a component: the heavy nodes share
  `apps/tui/src/kit/showing.tsx` with the cheap ones, so a loader there would cost a frame of blank and
  save no bytes.
- **What the eager graph actually is, is the plugin roster.** `apps/tui/src/App.tsx` imports thirteen
  client plugin barrels statically so their `init` can register. Cutting each of the `App` chunk's 80
  direct static edges in turn and re-walking gives the exclusive cost of each: the largest after this
  phase is 28,040 B, then 23,823 B, then 21,274 B, and the rest is a tail of 75 chunks under 5 KB each.
  There is no registry left in it. Halving this number means not importing thirteen barrels before the
  first frame, which is **phase 4's** work, not a table's shape.

The 89,860 B this phase did take is the pull-request model and its subtree, measured by the same
edge-cut walk at 61,151 B across 4 chunks, plus the modules that came with it.

### What the four tables cost, one line each

| Table | What it held eagerly | What it holds now |
| --- | --- | --- |
| `client-core/host/tree/components.ts` | 75 components, 5 of them reaching `features/` or the highlighter | 67 components and 8 loaders; nothing under `features/` is reached statically |
| `client-core/host/frames/remoteSolid.ts` | node factories, no components | unchanged — the claim about it was wrong |
| `apps/tui/src/kit/components.tsx` | 75 components, none in the eager graph | 75 components, type shared with the DOM host |
| `client-core/features/editor/language.ts` | 17 grammars, 894 KB | 17 loaders, 0 KB until a file is opened |

## 2026-09-03 — phase 2

Same machine, Node 24.11.0. Phases 0 (`17b03dbe`) and 1 (`77ed2ebd`) had shipped.

### The boot order, which is the whole phase

`pnpm --filter @acorn/desktop test` runs the boot test with `ACORN_PERF=1`, against a fresh data root
under the bundled Node. The helper's marks, before and after, measured by stashing the two changed
files and re-staging:

| `[helper:boot]` mark | Before | After |
| --- | --- | --- |
| `handshake` | +21 ms | +20 ms |
| `plugin-cache sweep` | +34 ms | +28 ms |
| `bundled plugins trusted` | +34 ms | +28 ms |
| `ws bound` | — (after the node) | **+31 ms** |
| **`ready line`** — Rust unblocks and creates the window | **+547 ms** | **+33 ms** |
| `service.start` — the node reported itself listening | +535 ms | +486 ms |
| `node adopted` | +543 ms | +493 ms |

**514 ms off the shell's blocking wait**, and the ready line went from the last mark to the fifth.
`apps/desktop/test/boot.test.ts` now asserts that order — `ws bound` before `ready line` before
`service.start` before `node adopted` — so undoing it fails a test rather than quietly costing half a
second.

### The desktop's cold-start timeline — measured this time

Phase 0 left this unread and said phase 2 should take it. Three launches of
`ACORN_PERF=1 tauri dev` against this machine's real `apps/node/.acorn` (16 plugins, a 1.6 MB
`core.sqlite`, 166 MB of plugin databases), reading Rust, the helper and the node side by side.
Launch 1 had a cold WebKit store for the dev bundle identifier — no remembered node and no persisted
query cache. Launches 2 and 3 were warm.

| | Launch 1, cold | Launch 2, warm | Launch 3, warm |
| --- | --- | --- | --- |
| helper `ready line`, and `[shell] helper ready` one line later | +95 ms | +109 ms | +104 ms |
| node `migrate` (its own clock) | 210 ms | 89 ms | 88 ms |
| node `graph`, the plugin loader (its own clock) | 45 ms | 48 ms | 47 ms |
| node `listener-up` (its own clock) | +392 ms | +256 ms | +237 ms |
| helper `service.start` | +842 ms | +725 ms | +706 ms |
| **window open → the node is listening** | **747 ms** | **616 ms** | **601 ms** |

**The window opens 601 to 747 ms before the node's listener is up**, which is this phase's `Done when`.
`[shell] helper ready on <port>` is printed immediately before `open_window`, so it is the window's
own mark.

Two things in that table are worth a later phase's attention:

- **The node's own boot account under-reports by about 450 ms.** `service.start` resolves at helper
  +842 ms when the node's own clock says +393 ms, so the node's timer starts 449 ms after the helper
  did. That gap is spawning the process and evaluating the one-chunk 1,093,602 B service bundle before
  `startServiceRuntime` runs. Phase 0's breakdown does not see it, and it is larger than every step in
  the breakdown except `graph`.
- **`graph` is 45-48 ms here, not the 338 ms phase 0 measured.** Phase 0 measured under `tsx`, and its
  own caveat said to re-measure against the staged `service.js`. This is that re-measurement, and it
  changes the conclusion: **the plugin loader is not what dominates a real packaged boot.** The 220 ms
  `migrate` on a first-ever boot and the 450 ms of bundle evaluation are both bigger. Phase 3 should
  re-read this before targeting the loader.

### What the renderer stopped waiting for

`pnpm --filter @acorn/desktop build` → `apps/desktop/scripts/check-renderer-budget.mjs`, measured by
stashing `index.tsx` alone.

| | With the two top-level awaits | Without |
| --- | --- | --- |
| Startup scripts | 655,372 B | **627,146 B** |
| Startup assets (requests through the scheme handler) | 134 | **43** |
| Preload depth | 4 | **3** |
| Styles | 91,571 B | 91,569 B |

**28,226 B and 91 requests off the first paint, and nobody predicted it.** A top-level `await` in the
entry module makes rolldown keep every module the entry reaches as its own async chunk; with the awaits
gone it merged them. Phase 0 measured 143 startup assets and said depth, not count, was the thing —
which was right about the waterfall and left the count on the table. The count is now 43.

Against the pre-programme figure of 1,329,679 B, the three phases together have taken 702,533 B, 53%,
and 105 of the 148 startup requests.

### The renderer's own marks, and the one that would not be read

Launch 3, warm, dev build. `[renderer:boot]` offsets count from the document's navigation, so they
start where the window opening left off:

| Mark | Offset |
| --- | --- |
| `script start` | +1,154 ms |
| `nodeReady` | +1,213 ms |
| `node selected` | +1,214 ms |
| `plugins applied` | +1,250 ms |
| `first paint` | **never printed** |

Read this table for the ORDER, not the magnitudes. A dev build is proxied from Vite unbundled, so
`script start` is hundreds of module requests rather than the 43 a packaged build makes; the packaged
figure is not in this file. What the order says is that the node was reachable before the renderer's
entry module finished, and that `node selected` and `plugins applied` both land after the shell has
already been told to render — which is the phase.

**`first paint` was not measured, and phase 0's mark cannot be read the way it is.** It is a
`requestAnimationFrame` callback, and macOS pauses those while the window is occluded — the window
opens behind whatever the developer is looking at, so the callback never runs. Reading it needs the
window frontmost, which needs a person at the machine. Phase 10 should either take it that way or
change the mark to something a background window still fires.

### Not measured, and why

- **The immutable-asset saving.** A dev build serves `no-store` by design, so the header only does
  anything in a packaged build, and reading it means `pnpm dist` plus a second launch to see the
  webview reuse its cache. Nothing in this file says what those hashed reads cost today.
- **A warm-cache first paint in a packaged build.** Same reason as the mark above, plus the same
  packaged build.

## 2026-09-03 — phase 3

Same machine, Node 24.11.0. Phases 0 (`17b03dbe`), 1 (`77ed2ebd`) and 2 (`7c826ad6`) had shipped.

Everything here is measured against the **staged `service.js`**, not under `tsx`, and under the pinned
runtime the desktop ships (`apps/desktop/src-tauri/binaries/node-aarch64-apple-darwin`, Node 24.11.0).
The harness forks the bundle with an IPC channel the way the helper does, sends one `service.start`,
and reads the `[service:boot]` lines against the parent's clock. The data root is a copy of this
machine's `apps/node/.acorn`: 16 plugins, five of them loaded from disk, a 1.6 MB `core.sqlite`,
166 MB of plugin databases, and 2,975 files in `blobs/`. Before-and-after pairs were taken by
reverting the changed files, rebuilding, re-staging, and running the same protocol.

### The 449 ms phase 2 could not see, split

Phase 2 found that the node's own boot account starts 449 ms after the helper's, and asked phase 3 to
split spawning the process from evaluating the bundle. Median of seven forks:

| | Value |
| --- | --- |
| `fork()` → the child's first line of user code | **23 ms** |
| of which the child's own clock says was Node's bootstrap | 10 ms |
| **evaluating the service bundle's module graph** | **293 ms** (344 ms on the first, cold fork) |
| `fork()` → the bundle fully evaluated | **316 ms** |

So 316 ms of phase 2's 449 ms is spawn plus evaluation, and the remaining ~133 ms is the helper's own
work between its clock and the fork plus the `service.start` round trip. **Spawning the process is
23 ms and is not worth touching.** Bundle evaluation is 293 ms, which is over the 100 ms bar phase 3's
scope and phase 10's deferred list both set.

### What the 293 ms is, and why per-plugin chunks are refused

Timing each external import in a fresh process, in this order, then importing the bundle with those
already warm:

| Import | Cost |
| --- | --- |
| `drizzle-orm` | 91 ms |
| `drizzle-orm/sqlite-core` | 76 ms |
| `@agentclientprotocol/sdk` | 25 ms |
| `zod` | 17 ms |
| `@hono/node-server` | 11 ms |
| `jose` | 10 ms |
| `ws` | 6 ms |
| `hono` | 5 ms |
| `node-pty` | 3 ms |
| `drizzle-orm/better-sqlite3/migrator`, `smol-toml`, `@vscode/ripgrep`, `node:sqlite` | 4 ms together |
| **the service bundle's own 1,099,400 B chunk, externals warm** | **51 ms** |

**The per-plugin dynamic-import split is refused, and the reason is that the premise was wrong.**
Phase 3's scope said "if it is over 100 ms, the fix is per-plugin chunks through dynamic imports in
`apps/node/src/composition/plugins.ts`". It is over 100 ms, and that fix buys nothing. Only 51 ms of
the 293 ms is acorn's own bundled code, and every plugin in `nodePlugins()` has its `init` called on
every boot, so making each one a dynamic import moves those 51 ms into 16 chunks and evaluates all of
them anyway. The other 242 ms is external libraries, which are already outside the chunk.

`drizzle-orm` and `drizzle-orm/sqlite-core` are 161 ms together and cannot be separated: the root
barrel alone is 92 ms, `sqlite-core` alone is 155 ms, and both together are 161 ms, so the 99 files
importing query operators from the root barrel are paying about 6 ms for the privilege. Narrowing them
would be 99 files for 6 ms. `sqlite-core` is the schema builder, and the node cannot migrate anything
without it.

Two candidates are left, sized, for whoever wants them: `@agentclientprotocol/sdk` at 25 ms, imported
statically by the managed-agent driver and needed only when an Agent Client Protocol session starts,
and `jose` at 10 ms for internal tokens. Both live in files phase 3 does not own.

### The boot, before and after

Five warm boots of the same root under each build, medians. Warm because that is what a person's second
launch of the day is.

| `[service:boot]` step | Before | After |
| --- | --- | --- |
| `login-shell` | 0 ms | 0 ms |
| `bundled-packages` | 11 ms | 11 ms |
| `migrate` | **111 ms** | **29 ms** |
| `graph` | 52 ms | 59 ms |
| the whole `init` pass (`install` minus `graph`) | 24 ms | 24 ms |
| `cert` | 1 ms | 1 ms |
| `bind` | 8 ms | 8 ms |
| **total to `listener-up`** | **210 ms** | **132 ms** |

**78 ms off a warm boot, and none of it is the concurrency.** The `graph` step reads 7 ms slower after,
which is the loaded-plugin imports landing on a slightly colder page cache now that less runs in front
of them; it is noise, not a regression.

### The login-shell probe, which is the phase's real number

The table above is a development build, where the probe does not run at all. With `isPackaged: true`,
which is what a packaged macOS build does:

| | Before | After |
| --- | --- | --- |
| `login-shell` step | **569 ms** | **5 ms** |
| total to `listener-up` | **757 ms** | **209 ms** |

**548 ms off a packaged macOS boot.** This machine's `$SHELL` is `/bin/bash`, and
`/usr/bin/time -p $SHELL -lic 'printf %s "$PATH"'` reports 0.52 to 0.55 seconds over three runs, which
matches the 569 ms step. A profile with a version manager in it costs more. The probe still runs, still
keeps its five-second ceiling, and the first process the node spawns waits for it; nothing on the path
to the listener does.

### What the concurrent init pass actually saved: nothing measurable

The `init` pass is 24 ms warm and 38 to 41 ms on a first boot against this root, both before and after.
The task brief predicted "at most about 22 ms" on the reasoning that concurrency turns a sum into a
maximum. That reasoning does not apply here, and the reason is worth writing down: **these inits are
synchronous.** `ctx.storage.open()` opens a `node:sqlite` handle and runs drizzle's `migrate`, both
synchronous calls, and `agents.init` — the most expensive one — has no `await` in it at all. One thread
cannot overlap synchronous work, so `Promise.allSettled` starts 16 inits that then run to completion one
after another exactly as the `for` loop did.

The change is still right and it stays: the loop was serial because loops are, the file's own header
says declaration order is not load-bearing, and a plugin that does await something no longer blocks its
neighbours. But it is a correctness change with a rounding-error payoff, not a performance one, and
anyone quoting it should say so.

What the marks do show is that the pass is genuinely concurrent. Completion order is no longer
declaration order: on a first boot `github` and `memory` finish after `rollbar`, which is declared
eleventh places later.

### The ten SQLite opens and migrations: confirmed a non-issue

Phase 3's scope asked for a measurement, not a change, and said to write down a journal check before
`migrate` only if the marks demanded it. They do not.

| | Value |
| --- | --- |
| `core.sqlite` open plus drizzle `migrate` (`openDb`) | **7 ms** |
| the nine plugin files, opened and migrated inside their inits | **23 ms** together, warm |
| the widest single one (`agents`, 159 MB) | 11 to 14 ms |

Thirty milliseconds for ten opens and ten migration chains. Drizzle's `migrate` on an up-to-date
journal is one `SELECT` against `__drizzle_migrations`, and that is what it costs. **No journal check
is needed, and nobody should add one.**

### The 102 ms nobody was looking for

Splitting the `migrate` step to find out whether its 111 ms was really migration found that it is not.
`makeRuntime` is what the step covers, and inside it:

| Call | Cost |
| --- | --- |
| `openDb` — open plus migrate `core.sqlite` | 7 ms |
| `ensureSessionKey` | 0.2 ms |
| `activeIdentityStore` | 0.2 ms |
| `ensureBoundIdentity` | 0.6 ms |
| `ensureCert` | 1.2 ms |
| **`diskBlobCache`** | **102 ms** |
| `loadOrCreateInternalToken` | 0.1 ms |

`diskBlobCache` sweeps the blob directory at every boot, calling `chmod(0600)` on every file to migrate
entries written under a permissive umask. On this root that is 2,975 `lstat` calls and 2,975 `chmod`
calls, in front of the listener, and **not one file had the wrong mode.** `put` has written 0600 for a
long time, so the sweep exists for files an old build left behind.

Reading the mode off the `lstat` the loop already does, and chmodding only a file that is actually
wrong:

| | Value |
| --- | --- |
| `readdir` of 2,975 entries | 2 ms |
| `lstat` over all of them, checking the mode | 10.5 ms |
| `lstat` plus unconditional `chmod`, warm | 60 ms |
| the same during a real boot | 102 ms |
| files whose mode was wrong | **0** |

That is the whole 78 ms of the development-build table above. It was not in phase 3's scope list, and
I took it anyway: it is one line, it is the largest single item in the node's own boot account, it sits
on the serial boot chain this phase exists to shorten, and no other phase file names it.
`bindingsSecurity.test.ts` still proves the migration works on a 0644 file and now also asserts that an
already-0600 file's `ctime` does not move.

### The second launch writes nothing under the plugin cache

`packages/custody/src/plugins/bundledPluginTrust.test.ts` asserts it with nanosecond mtimes: two
bundled packages, a full launch (sweep, then trust the roster), then a second launch through fresh
`PluginCache` and `PluginTrustStore` instances so the decision comes off disk rather than off an
in-memory flag. Four files exist afterwards — two bundles, `index.json`, and `plugin-trust.json` — and
all four `mtimeNs` values are unchanged by the second launch. Before this phase the same second launch
wrote all four.

Not measured as a wall-clock saving, and it would be dishonest to claim one: on this machine's APFS
volume five bundle writes and ten fsynced rewrites of two small JSON files do not show above the noise
in the helper's marks, which is why phase 2 measured `plugin-cache sweep` and `bundled plugins trusted`
at 28 ms together. The argument for the change is that the writes are unconditional, they fsync, and
they are in front of the window on a machine with a slower disk than this one.

### Not measured

- **A packaged build.** Every number here is the staged bundle under the pinned runtime, driven by a
  test harness rather than by the Rust shell. The 548 ms login-shell figure is `isPackaged: true`
  through that harness, not a `pnpm dist` bundle launched from Finder.
- **The desktop's window-to-node gap after this phase.** Phase 2 measured it at 601 to 747 ms with the
  node listening at the end of it. The node now gets there 78 ms sooner on a warm development boot and
  548 ms sooner on a packaged macOS one, but nobody has re-read the four accounts side by side, which
  needs the app running and a person watching it. Phase 10 owns that.
- **`first paint`.** Still unread, for the reason phase 2 gave: it is a `requestAnimationFrame`
  callback and macOS pauses those while the window is occluded.
