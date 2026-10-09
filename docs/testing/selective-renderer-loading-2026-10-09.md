# Selective renderer loading evidence, October 9, 2026

This page records what loading renderer implementations on first use changed in the renderer and
terminal client startup graphs, and what a real desktop session showed. The figures are dated
evidence. Don't edit them. The budget rules are in [startup budget](../frontend/startup-budget.md).
Phase numbers below refer to the October 2026 performance programme. Its plans were deleted on
October 9, 2026, and remain in git history.

## Setup

- Checkout: `b8998355d` with phase 05 applied and uncommitted.
- Platform: macOS 27.0 on Apple silicon (`darwin-arm64`). The build ran Node 24.11.0. The terminal
  client suite ran under Node 26.8.1, because loaded plugin workers refuse an unpatched runtime.
- Toolchain: Vite 8.0.16 and Rolldown 1.0.3, minifying with Oxc.
- Each "before" figure comes from the same checkout with the phase's changes reverted, built the
  same way.

## Startup graphs

Minified script bytes from `check-renderer-budget.mjs` and `check-startup-graph.mjs`:

| Graph | Before | After | Ceiling after |
| --- | ---: | ---: | ---: |
| Renderer startup scripts | 808,886 | 703,911 | 740,000 |
| Compiled roster beyond startup | 242,405 | 219,353 | 230,000 |
| Renderer total before restore | 1,051,291 | 923,264 | None |
| Terminal client startup closure | 730,269 | 673,918 | 700,000 |

Both startup figures failed their ceilings before, 775,000 B and 723,000 B. Renderer styles stayed
at 122,185 B.

## Where the bytes went

A scratch build recorded each module's rendered length and import edges, before minification. Three
edges held the loaded-plugin host on the renderer's startup graph:

| Edge | What it held |
| --- | --- |
| `reload.ts` to `syncContributions.ts` | Frame and chrome registration, `chromeData`, chrome commands and actions |
| `distribution.ts` to `workerHost.ts` | The worker host, the frame broker, and frame scopes |
| `App.tsx` to `PromoteToTaskModal.tsx` | The promotion modal |

Cutting those three alone removed 174,778 B of source from startup and added 145,848 B to the
roster. The changes model and context model reached the same modules through
`@acorn/plugin-api/ui/host`. With their imports moved to `@acorn/plugin-api/client`, nothing moved
into the roster, and the roster lost 61,252 B of source. The workflow run model's `kindLabel` import
held `stepFields`, about 8 KB minified.

## Real-app checks

A fresh `pnpm dev:agent -- --session p05` session, with this checkout as its project:

- The shell restored to Home. All six bundled loaded plugins were accepted.
- A new task's pane switcher listed **API**, the HTTP plugin's loaded pane. Opening it drew its
  remote tree, which loads the worker host on first use.
- A reload with **API** open restored the task with the pane drawn, after its late registration.
- **Editor**, **Changes**, and **Agent** opened and drew their content.
- **Settings** listed the loaded plugins' pages, **API requests** and **Sentry export**.

Warm reloads in the same window, reading the startup marks, in milliseconds. Each run is six
reloads. The renderer bundle on disk was swapped between runs without restarting the app.

| Mark | Before, median | After, median of 12 |
| --- | ---: | ---: |
| `startup:restored` | 330 | 315 |
| `startup:usable` | 409 | 394 |

The window ran in the background, so `startup:first_frame` ranged from 48 to 753 ms on both builds
and isn't comparable. Cold launches, slow imports, and an offline Node weren't measured. Phase 07
owns visible cold-launch evidence.

## Test results

New or changed tests cover loader retry after a failed import, synchronous passes once the hosts
load, deep links waiting for the import, synchronous worker teardown on withdrawal, the selected
Node committing before a slow remote read, concurrent reads, and the hover code warm.

Failures that were present before the change, confirmed on the reverted checkout or in files the
change doesn't touch:

- `@acorn/plugin-agents`: `tsc` errors in `AgentPane.test.tsx` and a failing
  `managedBridge.test.ts` case.
- `@acorn/plugin-workflows`: a `tsc` error in `workflowMapLifecycle.test.ts` and a failing
  `generate.test.ts` case.
- `@acorn/tui`: two cases in `chrome.test.tsx`.
- `@acorn/arch-tests`: `docs/api-reference/plugin-routes.md` is 201 lines.
