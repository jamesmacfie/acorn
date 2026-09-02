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
