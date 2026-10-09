# Production minification evidence, October 9, 2026

This page records what performance phase 03 ([production minification](../future/performance/03-production-minification.md))
changed in the Node service's startup graph, the staged desktop resources, and the service's boot
time. The figures are dated evidence. Don't edit them. The budget rules are in
[startup budget](../frontend/startup-budget.md#the-node-service), and the stack lookup is in
[packaged stacks](../local-development/packaged-stacks.md#find-the-source-line).

## Setup

- Checkout: `9f23e0836` with phases 02 and 03 applied and uncommitted.
- Platform: macOS 27.0 on Apple silicon (`darwin-arm64`). Bundled Node runtime 24.21.0. The build
  toolchain ran Node 24.11.0. The Node suite ran under Node 26.8.1, because loaded plugins refuse an
  unpatched runtime.
- Toolchain: Vite 8.0.16 and Rolldown 1.0.3, minifying with Oxc. `output.keepNames` keeps function and
  class names.
- The terminal client's startup ceiling fails at this checkout, as the
  [phase 01 baseline](./performance-baseline-2026-10-09.md) records. It was raised locally for the
  `pnpm pack:node` run only and put back.

## Startup graphs

From the build checks and `apps/desktop/scripts/size-report.mjs`, in bytes:

| Graph | Before | After | Ceiling after |
| --- | ---: | ---: | ---: |
| Node service static graph | 3,193,213 | 1,824,878 | 1,827,000 |
| Terminal client startup closure | 729,998 | 729,998 | 723,000 |
| Renderer startup scripts | 802,856 | 802,856 | 775,000 |

The Node figure before is the phase 01 baseline, and a scratch build with minification off
reproduced it exactly. A scratch build without `keepNames` measured 1,700,205 bytes, so kept names cost
about 122 KB. The terminal client and the renderer were already minified, and this phase didn't
change their bundles. Both still fail their ceilings, as they did before.

## Installed bytes

Staged desktop resources, in bytes. The before figures are the phase 01 baseline for the two changed
components and the phase 02 evidence for the total:

| Component | Before | After | Change |
| --- | ---: | ---: | ---: |
| Node service | 6,056,340 | 4,004,745 | -2,051,595 |
| Node service JavaScript | 5,021,306 | 2,969,711 | -2,051,595 |
| Bundled plugins | 4,237,635 | 2,360,131 | -1,877,504 |
| Bundled plugins JavaScript | 4,171,766 | 2,294,262 | -1,877,504 |
| Installed total | 201,970,424 | 198,041,325 | -3,929,099 |

The total fell by exactly the two component changes. The build also writes about 10 MB of hidden
source maps into `apps/node/dist`, and staging leaves them out. The standalone tarball from
`pnpm pack:node` was 1,925,792 bytes compressed and held no source maps or graph files. No tarball was
measured before the change, and no installer was built.

## Boot time

The staged helper folder was copied outside the checkout twice, once as built and once with an
unminified service build in place of `service.js`, the entries, and `chunks/`. A script started
`standalone.js` under the bundled Node, timed it from spawn to its `[server] listening` line, and
stopped it. It alternated the two copies. A cold run used a fresh data root. A warm run reused one
data root that an earlier boot had set up. Medians, in milliseconds:

| Run | Boots per copy | Unminified cold | Minified cold | Unminified warm | Minified warm |
| --- | ---: | ---: | ---: | ---: | ---: |
| First | 7 | 392 | 412 | 256 | 263 |
| Second, order reversed | 11 | 388 | 377 | 244 | 235 |

The two runs disagree on which copy is faster, by more than the gap within either run. On this
machine, minification produced no measurable change in time to listen. The byte cut is a size
result, not a startup-time result.

## Checks

These passed:

- `pnpm --filter @acorn/node build`, with the graph-based budget check. Two builds of the same
  checkout produced byte-identical JavaScript and source maps, 386 files.
- `pnpm --filter @acorn/desktop build` through staging, the runtime syntax check over 205 generated
  files, and the size report. The build stops at the renderer budget, which fails as the baseline
  records, so the last two steps ran by hand.
- From the copy outside the checkout: the standalone service booted; `mcp.js` answered `initialize`
  and `tools/list`; `loop-hook.js` exited 0; and with `ACORN_BUNDLED_PLUGINS_DIR` set, all seven
  minified loaded packages installed and reported `active` through the plugin worker.
- A corrupt `node.json` in the data root crashed the copy with
  `at openDataRoot (…/chunks/inputGrants-B09qKGjl.js:1:3409)`. `pnpm --filter @acorn/node locate-stack`
  mapped that frame to `packages/node-core/src/server/storage/dataRoot.ts:194:15`, the `throw`, and the
  next frame to `apps/node/src/entries/standalone.ts:54:14`. A frame from a chunk name the build
  lacked printed `[no map in this build]`.
- `build:plugin rollbar --sourcemap` rebuilt a `node.js` byte-identical to the staged package, and
  the lookup resolved a frame in it through the plugin's map.
- `pnpm pack:node`, with the terminal ceiling raised for the run.
- `pnpm --filter @acorn/desktop test`: 205 and 11 tests, and 66 Rust tests, against the minified
  staged service and plugins.
- `pnpm test --filter=@acorn/node`: 278 of 279. The failure is the route golden list, which lacks the
  GitHub plugin's committed `pulls/search` route and fails without this phase's changes.
- `pnpm --filter @acorn/arch-tests test`: 86 of 87. The failure is the 200-line limit on
  `docs/api-reference/plugin-routes.md`, which this phase didn't touch.
- `pnpm test --filter=@acorn/tui`: 717 of 719, with two skipped. Both failures are in
  `src/chrome/chrome.test.tsx`, which doesn't load the build or its graph.
- `pnpm lint` for every package this phase touched. The run failed only on a type error in
  `plugins/workflows/src/server/dispatch/workflowMapLifecycle.test.ts`, which this phase didn't touch.

These weren't run:

- A packaged desktop build, `verify:bundle`, or installer and update archive sizes.
- An extracted standalone tarball with `npm ci`. The desktop copy above ran the same minified
  service with staged runtime dependencies.
- Cross-checkout reproducibility. The output embeds no absolute paths, but only same-checkout rebuilds
  were compared.
- Linux and Windows targets.
