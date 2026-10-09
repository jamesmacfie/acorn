# Selective server loading evidence, October 9, 2026

This page records what performance phase 06 ([selective server loading](../future/performance/06-selective-server-loading.md))
changed in the Node service's startup graph, and what a real desktop session showed. The figures are
dated evidence. Don't edit them. The budget rules are in
[startup budget](../frontend/startup-budget.md#the-node-service), and the helpers are in
[load a route on first use](../plugin-authoring/the-node-half.md#load-a-route-on-first-use).

## Setup

- Checkout: `b8998355d` with phase 05 and phase 06 applied and uncommitted.
- Platform: macOS 27.0 on Apple silicon (`darwin-arm64`). The build ran Node 24.11.0. The Node, Node
  core, agents, and workflows suites ran under Node 26.8.1, because loaded plugin workers refuse an
  unpatched runtime.
- Toolchain: Vite 8.0.16 and Rolldown 1.0.3, minifying with Oxc.
- The "before" figure comes from the same checkout with the four plugin and transport edits reverted,
  built into a side folder. Its graph measured 1,824,878 B, the same as the phase 03 figure.

## Startup graph

Minified bytes from `check-service-budget.mjs`:

| Graph | Before | After | Ceiling after |
| --- | ---: | ---: | ---: |
| Node service static graph | 1,824,878 | 1,702,960 | 1,705,000 |

The GitHub cut alone measured 1,787,504 B, a 37,374 B saving. The emitted `mirrorRoutes` chunk is
39.48 kB.

## What moved, and why

A scratch build recorded each module's rendered length and static import edges. For each module, it
removed that module from the graph and counted the source bytes that became unreachable. That count
is what a cut can save. The figures below are rendered source, before minification:

| Cut | Source bytes off boot | Why it belongs on first use |
| --- | ---: | --- |
| GitHub mirror routers under `/repos` | 62,740 | Thirteen routers that answer only when a client asks for GitHub data. The data source handlers were already lazy and now share one load. |
| The preview tunnel's `ws` server | 88,601 | `wsHub.ts` already loaded `ws` on its first upgrade. The tunnel's static import kept the whole package on boot. |
| Workflow file authoring and export | 28,263 | A device-only action a person starts from the workflow editor. |
| Claude and Codex usage probes | 26,860 | Each collection spawns the provider's command-line tool and takes seconds. |

These stayed at boot:

- **Dashboard planning**, `packages/dashboards-core/src/plan.ts`, about 70 KB of source with its own
  imports. Seven core modules import it, including the dashboards store, which calls
  `upgradePanelContent` as it reads rows. A cut needs that call split out first.
- **The plugin installer**, about 17 KB. The loader, the bundled-plugin setup, and development mode
  read its paths and lockfiles during boot. A cut needs the install operations split from those
  readers.
- **`pg`, `jose`, and the database pools.** Commit `c0c26af7b` measured them as cheap to load.
- **Agent and workflow recovery, stores, schedules, and tool registration.** These run before the
  listener binds or right after it, by design.

## Real-app checks

A fresh `pnpm dev:agent -- --session p06` session, with this checkout as its project and no GitHub
connection. The requests went through the desktop's own Node transport from the renderer, timed in
the renderer, so each figure includes the bridge round trip:

| Request | Status | Time |
| --- | --- | ---: |
| `GET /v1/p/github/pins`, a static route | 200 | 4 ms |
| `GET /v1/p/github/repos/acme/web/pulls/1/conflicts`, first mirror request | 200, `available: false` | 7 ms |
| The same request, second and third | 200 | 3 and 4 ms |
| `GET /v1/p/github/repos`, with no GitHub connection | 401 `reauth` envelope | 35 ms |
| `GET /v1/p/github/repos/acme/web/nothing` | 404 from the app | 4 ms |

The Node log had no errors. The pull request list, files, actions, and creation screens weren't
driven, because the isolated session has no GitHub sign-in. The suites below cover them through the
assembled app and the plugin's own tests.

Time to listen wasn't measured. One boot of each build took 194 ms and 191 ms, which says nothing
on its own. Phase 03 found that halving the graph's bytes made no measurable change in time to
listen.

## Checks

These passed:

- `pnpm --filter @acorn/node build`, with the lowered ceiling.
- `pnpm test --filter=@acorn/plugin-api`, `@acorn/plugin-github`, and `@acorn/node-core`.
- `pnpm test --filter=@acorn/node`, after regenerating the route and plugin-disable goldens. Each lost
  the mirror's individual routes for the one lazy mount.
- `oxlint` and `tsc --noEmit` in every package this phase touched.
- `pnpm --filter @acorn/desktop test`: 231 JavaScript tests and 66 Rust tests.

These failed with and without the phase's changes:

- `plugins/agents/src/server/routes/managedBridge.test.ts`, one case.
- `plugins/workflows/src/server/authoring/generate.test.ts`, one case.
- `tsc` in `plugins/agents/src/client/sessions/AgentPane.test.tsx` and
  `plugins/workflows/src/server/dispatch/workflowMapLifecycle.test.ts`.
- The architecture suite's 200-line rule, on `docs/api-reference/plugin-routes.md` at 201 lines.
