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

## 2026-09-03 — phase 4

Same machine. Phases 0 (`17b03dbe`), 1 (`77ed2ebd`), 2 (`7c826ad6`) and 3 (`facd8288`) had shipped.

The terminal client runs on **Node 26.8.1** with `--experimental-ffi`; nvm's default here is 24.11 and
OpenTUI cannot draw on it. Every number below is the built bundle (`pnpm --filter @acorn/tui build`,
then `node --experimental-ffi dist/main.js`) driven through a pty with `script -q`, against a fixture
data root and a fixture config directory, quit with `Ctrl+C`, reading the `[acorn:boot]` marks phase 0
added. Before-and-after pairs were taken by stashing `apps/tui` and `packages/client-core`, rebuilding,
and running the same protocol.

Caveat on the "starting a node" rows: there is no `standalone.js` beside the TUI bundle in a checkout,
so `supervise.ts` falls back to the source entry under `tsx`. That is what a developer's `acorn` does,
and it is what the before column was paying for.

### First draw

Medians of three runs, except the start rows (two before, three after).

| | Before | After |
| --- | --- | --- |
| Attached to a running node, **warm** cache | 88 ms | **67 ms** |
| Attached to a running node, **cold** cache | 88 ms | **65 ms** |
| **Starting a node** (root opened before) | **722–852 ms** | **62 ms** |
| First-ever start, fresh root and no cache | 886 ms | 886 ms — unchanged, and deliberately |

**The 300 ms target in the phase file is replaced by 67 ms**, which is the measured warm attached
figure. The proposal was written before phase 0's marks had been read on this host; the attach path was
never the problem. What was the problem is the row below it: `acorn` against a stopped data root drew
its first frame **at 62 ms instead of 722–852 ms**, an order of magnitude, because the shell no longer
waits for a node it just spawned. In a checkout with a cold `tsx` cache that gap is seconds rather than
hundreds of milliseconds.

Cold and warm attached differ by 2 ms, which is honest and slightly disappointing: the restore is one
`readFileSync` of a 1.8 KB snapshot on this fixture root. On a real root the snapshot is hundreds of
kilobytes and the gap will be larger; nobody has measured that.

The first-ever start still waits, and that is the design. There is no `node.json` to name a cache
partition with and no cache under it, so there is nothing to draw and waiting costs nothing.

The marks after, warm attached, one run:

| Mark | Offset |
| --- | --- |
| `node open` | +3 ms |
| `cache restored` | +21 ms (18 ms) |
| `App imported` | +35 ms (14 ms) |
| `renderer created` | +39 ms (5 ms) |
| **`first draw`** | **+67 ms** (28 ms) |
| `roster registered` | +81 ms (14 ms) |

…and before, warm attached, one run: `node open` +3 ms, `App imported` +43 ms (**40 ms**),
`tasks read` +53 ms, `renderer created` +60 ms, `first draw` +90 ms. Two things moved: the `App` import
is 14 ms rather than 40 ms because the roster left it, and the tasks round trip is gone from the
critical path entirely.

### The eager closure, and the new ceiling

`pnpm --filter @acorn/tui build` → `apps/tui/scripts/check-startup-graph.mjs`.

| | Chunks | Bytes | Whole build |
| --- | --- | --- | --- |
| After phase 1 | 112 | 1,026,357 B | 2,110,161 B |
| After phase 4 | **91** | **841,142 B** | 2,122,669 B |
| Ceiling now held | | **870,000 B** | |

**185,215 B, 18%, and 21 fewer chunks.** The whole build grew 12 KB, which is the roster becoming its
own chunk boundary rather than being folded into `App`.

This is phase 1's missed target, and it is still missed: phase 1's `Done when` asked for under 550 KB.
Phase 1 was right that the roster was what remained and wrong that removing it would halve the number.
Its edge-cut walk measured each barrel's *exclusive* cost — the largest 28,040 B, then a tail of 75
chunks under 5 KB — and cutting all twelve at once takes 185 KB, not 500 KB, because most of what the
plugins reach is client-core that the chrome reaches too.

What is left is the chrome and the client-core it draws with: `PanelGrid` 228 KB, `asking` 114 KB,
`App` 108 KB, `fleet` 92 KB. That is what the first frame is made of. There is no registry in it and
nothing in it is waiting to be made lazy, so **the next honest saving here is a smaller kit, not a
later import**, and nobody should set a byte target for this host again without saying which components
they intend to delete.

### The cache directory is written

Proof by file, against the fixture config directory after one run:

```
$ ls -l "$ACORN_TUI_CONFIG_DIR/cache"
-rw-------  1  1798  acorn-cache%3A92973bbb-580b-4dff-837d-bd59a52c508c.json
```

One file, named by the partition key (`acorn-cache:<nodeId>`, colon percent-encoded), 0600 in a 0700
directory. Before this phase that directory never existed: the store was installed and no persister was
ever driven. Its four entries, all `success`, are `['workspaces','groups','v2']`, `['tasks','v3']`,
`['integrations','v3']` and `['prefs']`.

That last fact is also the proof that the node's arrival is honoured. On a start run all four of those
queries fail with `ECONNREFUSED` while the child boots; they are `success` in the snapshot because the
first non-offline state invalidates the active queries and they refetch, the same effect
`apps/desktop/src/client/index.tsx` has held since phase 2.

### Two things the reorder exposed, both fixed here

Neither is in the phase file, and both were only reachable once a frame could be drawn in front of a
node that is not listening.

- **`Unknown node`, not `ECONNREFUSED`.** Skipping `connect()` until the handshake left the broker with
  no record, and `NodeBroker.fetch` answers that with a hard `Unknown node` error rather than a
  reconnect. The fix is to connect to the row last time's handshake wrote — its port is dead, the broker
  reports `offline` and retries, which is a state the footer already draws.
- **An unhandled rejection drew OpenTUI's debug console over the shell.** `initSessions` in client-core
  fires its first pull without a `catch`; OpenTUI answers an uncaught error by showing its console
  overlay. Fixed at the source, and the renderer is now created with `openConsoleOnError: false`. The
  host also keeps OpenTUI's console *capture* on and hidden rather than deactivating it, so a stray
  `console.warn` from a plugin lands in the capture and is printed after `renderer.destroy()` instead of
  being written to the file the renderer draws on.

### Not measured

- **A real data root.** The fixture root has no tasks, projects or worktrees, so the rail is empty in
  every frame above and nothing here says what a hundred-task rail costs to draw. The cache snapshot is
  1.8 KB rather than the hundreds of kilobytes `cache.ts`'s own comment assumes.
- **A packaged build.** In a checkout the TUI has no `standalone.js` beside it, so the started node runs
  under `tsx`. Phase 7 of the bundle programme pins that layout.
- **`tasks:changed` against a real write.** `watchTaskChanges()` is installed and the shell now reads the
  client it invalidates, which `chrome.test.tsx` covers from the cache side, but nobody has created a
  task on the node from a second client and watched this rail move.

## 2026-09-03 — phase 5

Same machine, Node 24.11.0. Phases 0 (`17b03dbe`), 1 (`77ed2ebd`), 2 (`7c826ad6`), 3 (`facd8288`) and
4 (`92983971`) had shipped.

Every number here comes from a throwaway `*.test.ts` under the package it measures, driving the real
modules with the real subprocesses and the real SQLite file, and counting at the seam. The two
measurement files were deleted after they were read; the assertions that hold each number are in the
permanent tests named below. What is **not** here is a reading of phase 0's request log, because that
needs the packaged shell running with a person driving a terminal, and port 4317 is this machine's live
instance. The section at the end says what that leaves unmeasured.

### git processes per status ping

One status ping, as the trace defines it: every connected client asks for the rail's dirty markers
(one `git status --porcelain=v2 --branch` per active worktree) and, with a changes pane open, the
local-changes list (`git status --porcelain=v2` plus two `git diff --numstat` per worktree). Two
clients, four worktrees, one dirty file in each, real git.

| | `git status` | git processes in total |
| --- | --- | --- |
| Before | 16 | 32 |
| After | **4** | **20** |

Four is one per worktree per two-second window, which is the phase's done-when line, and it does not
move with the number of clients: the second client's eight reads all join or hit the first client's
four runs. The `git diff --numstat` pair is untouched at 16, because this phase shares the status half
of the local-changes read and nothing else. That is the residue worth knowing about: a changes pane on
two clients is still 16 processes a ping, and coalescing them means caching a per-file stat list, not
a status line.

Held by `packages/node-core/src/server/worktrees/worktreeStatus.test.ts`: two concurrent callers run
git once, a caller inside the window runs it zero times, an invalidated path runs it again, and a
failure is never remembered.

### The worktree-removal guard

**It passes.** A file written 100 ms ago still blocks `removeWorktree` without `force`, with the cache
warmed to "clean" immediately before the write. `worktreeDirty` passes `fresh: true`, which skips both
the in-flight promise and the window, and the same test proves the bypass is real by counting two
`git status` spawns for one read and one refusal issued together, where two reads would have been one.

### SQLite reads in auth

A hundred authenticated requests with the same device token, counting calls into `db.select` on the
`devices` table.

| | Reads |
| --- | --- |
| Before | 100 |
| Inside one 60-second window | **1** |
| Spread over 10 minutes | 10 |

Zero on a warm token, which is the done-when line, and one per minute of continuous traffic. A revoke
drops the entry before it notifies anyone, and a token that failed is never remembered, both held by
`packages/node-core/src/server/auth/deviceTokens.test.ts`.

### The task-list route

`GET /v2/core/tasks`, counting calls into `db.select`. The route reads the tasks, their links, and
every project they mention.

| Rows | Before | After |
| --- | --- | --- |
| 1 project, 2 tasks | 4 | **3** |
| 3 projects, 24 tasks | 26 | **3** |

It was one project query per task, in a loop, including a repeat for every task sharing a project. The
list is what every client refetches on `tasks:changed`, so on a hundred-task node that was a hundred
identical statements per write per client. Held by
`packages/node-core/src/server/routes/projects/tasks.test.ts`.

### Query traffic on an idle client while a terminal streams — counted at the client, not the node

A terminal producing output crosses the idle-to-working threshold repeatedly, and each crossing used to
be one `term:status` frame with six subscribers. Counted as reads provoked per crossing, on a client
with a task open, a changes pane, a PR pane and the agents sidebar:

| Subscriber | Before, per edge | After, per edge |
| --- | --- | --- |
| Plugin chrome sweep (`chromeData.ts`) | one descriptor read per plugin per contribution | 0 |
| Worktree status sweep (`taskStatus.ts`) | 1 read, 3 git processes per worktree behind it | 0 |
| Session roster (`agentSessions.ts`) | 1 read | 1 read |
| Pull-request keys (`prTabs.ts`) | 2 invalidations | 0 |
| Workflow runs and steps (`AgentTaskSidebar.tsx`) | 1 read plus one per run | 0 |
| Terminal client re-export | unused | removed |

The session roster is the one thing that genuinely wanted this edge, and it is the only thing that
still hears it, on `terminal:sessions-changed`. The dirty markers moved to `worktree:status-changed`,
which the terminal engine fires on the human edges only: a command going quiet, a session exiting, a
setup script finishing. So a `git commit` typed into a shell still moves the markers immediately, and a
build spewing output does not.

`chromeData.test.ts` holds the first row (a `terminal:sessions-changed` frame bumps no plugin's chrome
revision, and a `term:status` naming one bumps only that one), and `wsClient.test.ts` holds the
routing.

### Backpressure

Driven over a real socket with the client end paused and the hub's mark set to one byte, so the pause
and the resume happen for real without pushing four megabytes through a loopback socket
(`maxBufferedBytes` on `WsAuthDeps` exists for that and nothing else).

Four one-megabyte `term:out` frames into a paused socket: the engine is asked to pause the
pseudo-terminal once, not once per frame; all four frames arrive with `seq` 1, 2, 3, 4; the engine is
asked to resume once the buffer drains. A socket terminated while holding a pause releases it. Three
invalidation frames shed in the same congested window produce exactly one `ws:shed` marker and no gap
at all, and `nodeBroker.test.ts` shows the broker forwarding a marker rather than closing the socket,
including one that did skip a number.

Before this, a frame over the mark was dropped and `seq` incremented anyway, so the broker read the gap
as loss and closed the socket, and reconnect re-attached every terminal.

### Not measured

- **Phase 0's request log.** Every done-when line in the phase file is written in terms of
  `ACORN_PERF=1`'s per-request lines and its git and SQLite histograms. Reading them means launching
  the packaged shell with a person driving a terminal at full rate, and this machine's live instance
  holds port 4317 and the data root's lock. The numbers above are the same quantities counted at the
  seam instead, in-process, with real subprocesses and a real database. Nobody has read the histograms
  against real traffic, which is still what phase 0 asked for and still owed. Phase 10 should take it.
- **A deliberately saturated socket recovering without a reconnect, in the app.** Held as a unit over a
  real socket, not observed on a real build's output.
- **The `git diff --numstat` pair.** Two processes per worktree per client per ping, untouched, for the
  reason in the first section.

## 2026-09-03 — phase 6

Same machine, Node 24.11.0. Phases 0 (`17b03dbe`), 1 (`77ed2ebd`), 2 (`7c826ad6`), 3 (`facd8288`),
4 (`92983971`) and 5 (`28781ae6`) had shipped.

Every number here comes from a throwaway `*.test.ts` or `*.test.tsx` under the package it measures,
driving the real modules — the real `@xterm/headless`, the real panel in jsdom — and counting at the
seam. Both measurement files were deleted after they were read; the assertions that hold each
behaviour are in the permanent tests named below. The "before" figures for the tab switch were taken
by checking the two client files out at `92fef8e0` and running the same measurement against them, not
by reading the old code.

The corpus for the node-side numbers is one megabyte of real terminal output: 4,272 bytes of
`git log --color --graph --oneline` repeated, with a full-screen redraw frame every third chunk
(cursor hide, clear, box-drawing borders, a quoted string and a backslash — the shape an agent TUI
emits). 339 chunks, 1,004,005 bytes.

### Parser work for an unwatched session

The whole point of the phase. Same bytes, nobody attached.

| | Time |
| --- | --- |
| Before: an emulator per session, running from the moment it was spawned | **492 ms** |
| After: the ring alone, no emulator built | **2.8 ms** |

Emulators built for an unwatched session: **0**, which is the assertion rather than the timing.
`plugins/terminal/src/server/terminalDisplay.test.ts` holds it, along with the last detach disposing
and a cold attach rebuilding byte for byte the same visible screen a session that emulated throughout
would have shown.

Phase 0 put its `ACORN_PERF=1` histograms on the git and SQLite seams, and `terminal.write` is inside a
plugin rather than in node-core, so this is the phase file's other option taken: the parser is counted
at the seam in a test rather than sampled through a histogram. What a histogram would add is a reading
against a person's real session, which is the same thing phase 5 left owed and phase 10 should take.

### What an attach costs the node

| | Time |
| --- | --- |
| Before, per tab switch: serialize a warm framebuffer | 17.8 ms |
| After, per first visit to a tab: replay the ring and serialize | 20.0 ms |

The same work, and the point is how often it happens: it used to be once per switch, for ever, and it
is now once per tab per drawer session.

### Network per tab switch

Counted in jsdom with the real panel and the real surface, xterm stubbed, four switches between two
sessions.

| | Before | After |
| --- | --- | --- |
| First visit to a tab | 1 `POST …/resize`, 1 `term:attach`, 1 xterm built | same |
| Every switch after that | 1 `POST …/resize`, 1 `term:detach`, 1 `term:attach`, 1 xterm disposed, 1 built | **nothing** |

Over four switches: **4 HTTP requests and 8 WebSocket frames before, 1 and 1 after** — and the one is
the second tab's own first visit, not a switch. Held by
`plugins/terminal/src/client/TerminalPanel.test.tsx`, which also fails if the list goes back to
iterating the session rows or moves to `<Index>`.

### `term:out` wire volume

Bytes on the wire for the same corpus, per flush, one flush per coalescing tick. The node hop is the
node's socket to the desktop broker; the helper hop is the broker's forward to the renderer, which used
to re-wrap the JSON frame in a push and stringify it again.

| Corpus | Node hop | Helper hop | Encodes, 3 sockets |
| --- | --- | --- | --- |
| Mixed, as above | 1,196,783 → **1,016,209 B** (15.1%) | 1,223,225 → **1,028,413 B** (15.9%) | 1,017 → **339** |
| The full-screen redraw frames alone | 57,743 → **42,601 B** (26.2%) | 66,557 → **46,669 B** (29.9%) | |
| The plain-text chunks alone | 1,139,040 → **973,608 B** (14.5%) | 1,156,668 → **981,744 B** (15.1%) | |

So the saving is a sixth of the bytes on ordinary output and nearly a third on the escape-heavy frames
a full-screen agent draws, which is the traffic that actually arrives at 60 frames a second. The
`payload` itself is 1,004,005 B, so the after figures are the payload plus 36 bytes of id per frame and
nothing else.

The **encodes** column is the part that does not show up in bytes: the node used to `JSON.stringify` the
frame once per attached socket, and now builds one frame per broadcast whatever the socket count.
`packages/node-core/src/server/transport/wsHub.test.ts` holds that two attached sockets receive
byte-identical frames, that a binary frame takes no sequence number, and that an id the fixed-width
field cannot spell falls back to the JSON frame rather than going missing.

### Not measured

- **The app.** Every number above is in-process. Nobody has watched a real build spew output through
  the packaged shell with these changes in, because this machine's live instance holds port 4317 and
  the data root's lock. The smoke checklist in docs/testing.md is what covers that, by hand.
- **Memory per open tab.** Keeping an xterm per tab is the trade the phase accepts, and nobody has
  measured what one costs. jsdom's stub is not an xterm, and a real figure needs the app.
- **Scrollback loss in practice.** A cold attach rebuilds from 256 KB, so a program whose screen
  depends on older bytes redraws from its next output
  ([refused.md](./refused.md) § Scrollback beyond the ring). What that looks like for a real agent TUI
  after a long build has not been watched.

## 2026-09-03 — phase 7

Same machine, Node 24.11.0. Phases 0 (`17b03dbe`), 1 (`77ed2ebd`), 2 (`7c826ad6`), 3 (`facd8288`),
4 (`92983971`), 5 (`28781ae6`) and 6 (`449807fb`) had shipped.

Every number here comes from a throwaway `*.test.ts` under `plugins/agents`, replaying a **real
session out of this machine's own agents database** — a read-only copy of
`apps/node/.acorn/plugins/agents.sqlite`, 151 MB, 66,264 events, through the real
`buildConversationItems` and the real `renderBlocks`. The "before" column is the old algorithm written
out beside the new one in the same file and fed the same events, so both see the same data in the same
process. The measurement file was deleted after it was read; the assertions that hold each behaviour
are in `managedStore.test.ts`, `usageFold.test.ts`, `managedBridge.test.ts`, `AgentTranscript.test.tsx`
and `Markdown.test.tsx`.

The session is **`72f744c0-abff-49b6-a84f-4077989ce7bf`, "Implement phase 4 of
docs/future/phased-review-steps/", 2,727 events**, the largest in the database and the one
decisions.md's "2,700 events" refers to. 881 of its events are `usage`, which is 32%.

### The event mix, database-wide

| Type | Rows | Share |
| --- | --- | --- |
| `tool` | 35,472 | 54% |
| `usage` | **16,359** | **24.7%** |
| `assistant_message` | 11,155 | 17% |
| everything else together | 3,278 | 5% |

Confirms decisions.md's "usage rows are 25% of all events" exactly. It also says something that read
did not: **`tool` is more than twice as many rows as `usage`**, and nothing in this phase folds those.
The transcript already collapses a call's updates into one card at render time, the way it used to do
for usage; folding them at the source is the same shape of change and is not in this phase.

### What one streamed event costs

Median of three replays of the whole session, after a warm-up pass.

| | Before | After |
| --- | --- | --- |
| Store bookkeeping, whole session | 59.0 ms | **0.4 ms** |
| Store bookkeeping, per event | 21.6 µs | **0.1 µs** |
| One projection rebuild at full size | 1.00 ms | **0.85 ms** |
| Bookkeeping plus one rebuild, whole session | 901 ms | **771 ms** |
| **Per arriving event** | **0.33 ms** | **0.28 ms** |

**The store's own per-event work is 200 times cheaper**, and that is the whole of what `appendEvent`
was: two linear scans, a copy of the array and a sort of an already-sorted array, on a list that grows
to 2,727. It is now a `Set` lookup and a `push`.

Two honest caveats on the rest of that table.

- **The 2 ms budget in the phase file was already met before the phase.** At 2,727 events the whole
  per-event cost outside the DOM was 0.33 ms, not something over 2 ms. The proposal was written from
  source rather than from a profile, which is what its own `Verify before building` line said to check.
  What the phase actually buys at this size is the 21.6 µs and the highlighter, not a budget rescue.
- **The projection rebuild is now the cost**, at 0.85 ms of the 0.28 ms average and rising with the
  session. Folding usage takes the array from 2,727 rows to 1,850, which is where the 1.00 → 0.85 ms
  comes from. Making that rebuild incremental is refused for now and parked in phase 10, and this is
  the number phase 10 should argue from.

`buildConversationItems` still copies and sorts its input on every call, and that was measured rather
than assumed: on the 1,850-row array the copy plus sort and an in-order check that would skip it both
land around 0.02 to 0.06 ms, run to run, because V8's sort walks an already-ordered array in one pass.
Guarding it buys nothing, so it was left alone.

### The Markdown work, on the longest fenced message in the database

Found by concatenating every `assistant_message` delta per message id across all 114 sessions: session
`6c8cff0a-6b8a-4016-84cf-c781cf7406f6` ("Microlighter"), **15,083 characters, 34 blocks, 3 closed code
fences** — which is exactly the "message with three fences" the phase file describes.

| Over eleven renders (the message plus ten streamed updates) | Before | After |
| --- | --- | --- |
| Blocks whose element is replaced | 374 (all 34, every render) | **10** (one per update) |
| **Highlighter calls** | **33** | **3** |
| Copy buttons disposed and re-mounted | 33 | **3** |
| Parse of the whole message | 0.31 ms | 0.31 ms |

**No fence re-highlights while its text is unchanged**, which is this phase's `Done when`, and
`Markdown.test.tsx` holds it with a spy across ten updates.

The parse is deliberately unchanged: `renderBlocks` still reads the whole source every tick, because
the parser is line-based and cheap (0.31 ms for 15 KB) and a resumable parser would be real machinery
for less than the DOM write it feeds. What the split buys is everything after the parse.

The longest message in the profiled session itself is 3,758 characters over 13 blocks with no fences;
growing it moves 1 key of 14.

### The snapshot a client reads

`GET /v2/…/snapshot` caps a page at 2,000 event rows. Session `72f744c0`, first page:

| | Before | After |
| --- | --- | --- |
| Rows in the page | 2,000 | **1,345** |
| Serialized bytes | 2,351,578 B | **2,158,126 B** |

**33% of the rows and 8.2% of the bytes.** The gap between those two numbers is the finding: usage
rows are small, so folding them is a saving in rows walked and objects held rather than in bytes on the
wire. The rows are what `buildConversationItems` pays for on every event afterwards, which is why it is
worth doing, but nobody should quote this as a transfer saving.

The ledger is untouched, and `managedBridge.test.ts` asserts it against a real migrated database: 58
usage rows in one turn project as one through the HTTP bridge, while `exportSnapshot`, `store.snapshot`
and `eventPage` all still return 58.

### What a projected event reads

| | Before | After |
| --- | --- | --- |
| Row reads per `user_message`, `request`, `request_resolved`, `turn_completed` | up to 2,000 event rows, plus every turn and request | **0** — one turn row or one request row arrives with the event |
| Row reads per `error` | up to 2,000 | up to 2,000 — unchanged, on purpose |
| Projected events in the whole database | 679 of 66,264 | of which **645 no longer refetch** and 34 (`error`) still do |
| In session `72f744c0` | 7 refetches | **1** |

`error` keeps its refetch because it also expires the session's pending requests, and no frame names
that set.

### Not measured

- **The app.** Every number above is in-process, against the real database but not through the shell.
  This machine's live instance holds port 4317 and the data root's lock, so nobody has watched a real
  agent stream through the packaged build with these changes in. The smoke checklist in
  docs/testing.md is what covers that, by hand.
- **Text selection surviving an update.** No test covers selection anywhere in this repo — it needs a
  real selection in a real window. `Markdown.test.tsx` asserts the thing selection depends on, which is
  that an unchanged block keeps the same element, but that is a proxy and it should be confirmed by
  hand: select across two paragraphs of a streaming agent message and watch the selection hold.
- **Memory.** Folding usage keeps roughly a third fewer event objects per session in the client, and
  the highlight cache holds up to 200 fences under 16 KB each. Neither was weighed.

## 2026-09-03 — phase 8

Same machine, Node 24.11.0. Phases 0 (`17b03dbe`), 1 (`77ed2ebd`), 2 (`7c826ad6`), 3 (`facd8288`),
4 (`92983971`), 5 (`28781ae6`), 6 (`449807fb`) and 7 (`9e5d90ca`) had shipped.

Every number here comes from a `*.test.tsx` under jsdom driving the real component — the real
`DiffPane` over 200 files, the real `EditorPane` over a real CodeMirror, the real `TabRail` — and
counting at the seam. The "before" columns are not modelled: they are the same harness run against the
same tree with the phase's own files stashed, so both columns see the same fixture in the same process.
The measurement files were deleted after they were read; the permanent assertions are named under each
table.

### List re-renders while a 200-file diff hydrates

Counted as calls to `buildRenderableRows`, which walks every file in the diff and every row in each of
them and is what the virtualizer, the measure passes and the sticky header all hang off. 200 files,
each a small patch, hydrated to completion.

| | Row-model rebuilds |
| --- | --- |
| Before | 226 |
| After | **102** |

One per file that arrives, near enough, against two to three per file before: the statuses moved from a
`Map` behind one version counter to a store keyed by path, and the load row reads its own key rather
than the row model carrying a status baked in at build time. Each rebuild also walks all 200 files, so
the memo's own iterations went from about 45,000 to about 20,000, and the `hydrator.status()` calls
inside them from about 45,000 to zero.

**102 is not 1, and the phase file's done-when line said one.** Getting there means a row model built
per file rather than over all files, and that is a restructure of the most carefully tuned surface in
the app, which this phase's own scope refuses. What is left is the floor for the shape that is there: a
file arriving changes the rows, and the rows are one array.

Held by `packages/client-core/src/features/diff/DiffPane.test.tsx`, which fails at 226 against the old
shape, and `packages/client-core/src/kit/diff/hydration.test.tsx`, which holds the property underneath
it: a publish for one path does not re-run a memo reading another. That file is `.tsx` because the
`logic` project runs in bare Node against Solid's server build, where a store notifies nobody.

### Requests when the editor pane comes back

Counting calls into the editor's API from a mount, driving the real pane.

| | `root` | `read` |
| --- | --- | --- |
| Coming back to a task after visiting another, before | 1 | 1 |
| Coming back to a task after visiting another, **after** | **0** | 1 |
| Pane closed and reopened in the same task, before | 1 | 1 |
| Pane closed and reopened in the same task, **after** | **0** | **0** |

Zero requests for a pane toggled inside a task, which is the phase's done-when line, and the open file
keeps its text, its undo history and its cursor with it: the per-file documents moved into the pane
model, which the host holds per (pane, task).

Across tasks the file is read again, deliberately. The agent shares the worktree, so the pane cannot
serve a file's text out of a cache it left behind; what it does not ask for again is the checkout path,
which is now a query with a one-minute window and is warmed by the rail on hover.

Held by `plugins/editor/src/client/EditorPane.test.tsx`.

### Round trips to first editor text on a remembered file

The same harness with an artificial latency on every request, so the slope across two latencies counts
serial round trips rather than milliseconds of jsdom.

| Latency per request | Before | After |
| --- | --- | --- |
| 50 ms | 222 ms | **174 ms** |
| 100 ms | 331 ms | **232 ms** |
| slope (serial round trips) | **2.2** | **1.2** |

Two serial requests became one. The first read's fixed cost — importing the file's grammar, and jsdom
itself — is the ~120 ms both columns carry.

The first read called this three round trips (root, mount, read). Only two of them are requests; the
mount between them is local, and it is gated on the root rather than on the network.

### The node-switch remount, which is an examination

The phase said to measure it and act only if it is over a second. It is not, and the change is not
made.

What a node switch does is re-key `PersistQueryClientProvider` and the whole shell under it
(`apps/desktop/src/client/index.tsx`), so the data half is: build or look up the node's cache
partition, restore its persisted snapshot, and remount the subtree. Driven in jsdom against the real
`clientFor` and a **2.4 MB snapshot of 300 queries**, far larger than a real partition:

| | |
| --- | --- |
| First mount, including the restore | 9 ms |
| Switching node A → B, subtree remount | 5 ms |
| Switching node A → B, to the new cache restored | 5 ms |

**Verdict: leave it.** Single-digit milliseconds on the half that can be measured here, against a
threshold of a second.

What that does not include is the shell's own re-render — the rail, the panes, the plugin chrome —
which needs the packaged shell with two nodes configured and a person clicking the switcher. The
nearest measured bound is phase 2's renderer marks, where everything from `script start` to
`plugins applied` is 96 ms in a dev build (measurements.md § The renderer's own marks). A remount does
a subset of that with the modules already evaluated, so it is not the second the phase set as its bar.

### Rail hover prefetch

Behavioural rather than numeric, held by `packages/client-core/src/features/tabs/TabRail.test.tsx`
against the real rail: a pointer settled on a row for 200 ms warms every pane that declares a
`prefetch`, a row crossed for 50 ms warms nothing, and a pane that declares none is not asked. The
agent pane's session list is deduplicated over a five-second window in the store, so the hover and the
click that follows it are one read rather than two
(`plugins/agents/src/client/sessions/managedStore.test.ts`).

### Not measured

- **The app.** Every number here is in-process. Nobody has watched a task switch, a pane toggle or a
  node switch through the packaged build with these changes in; this machine's live instance holds
  port 4317 and the data root's lock. Phase 0's request log is still owed, and phase 10 should take it
  with the app running — it is the only thing that can say what a real task switch issues across every
  pane at once, rather than per pane at the seam.
- **The rail's hover prefetch against real latency.** The test counts calls, not milliseconds, and
  nobody has watched whether 150 ms is the right settle for a real pointer on a real rail.
- **Memory.** The editor's document pool now outlives a pane mount, so a task with twenty files open
  holds twenty `EditorState`s until the task is left. Nothing weighed that; it is bounded by the tabs
  the reader opened, and it was already the shape within one mount.
