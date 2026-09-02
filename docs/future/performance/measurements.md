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
