# Phase 06: Load substantial server handlers on first use

Date: October 9, 2026. Status: implemented October 9, 2026. Depends on: phases 01 and 03.
Source baseline: `989b069c389df6143b90ffb9889dfeaae5db6010`.

Implement promise-cached lazy route handlers and remove measured optional operations from the Node
startup graph. Preserve migrations, recovery, route authorization, and required registrations.

## Outcome

The Node service's static graph dropped from 1,824,878 B to 1,702,960 B of minified JavaScript, and
the ceiling went from 1,827,000 B to 1,705,000 B. The GitHub mirror accounts for 37,374 B of that.
The [evidence](../../testing/selective-server-loading-2026-10-09.md) has the method, the cuts made and
refused, and the real-app checks. The owning reference is
[load a route on first use](../../plugin-authoring/the-node-half.md#load-a-route-on-first-use).

Decisions made during implementation:

- The plan's fetch carrier can't serve the GitHub mirror. Its routers read `ownerId(c)`, `c.env.BLOBS`,
  and stored credentials off the host's request context, and `ctx.routes.fetch` hands a handler only
  a plugin request context. `lazyRouter` keeps the mount under `ctx.routes.register` and runs the
  loaded router with the host's variables, bindings, error handler, and fall-through.
- Both helpers live in `packages/node-core/src/server/pluginHost/lazyRoutes.ts`. The plugin API
  facade re-exports them, because the boundary test keeps implementation out of the facade.
- The mirror's thirteen routers build in one module, `plugins/github/src/server/routes/mirrorRoutes.ts`,
  in their former order. A test pins that order, because the Node's route golden now lists one
  `ALL /v1/p/github/repos/*` mount.
- Step 5 cut three more paths: the preview tunnel's static `ws` import, workflow file authoring and
  export, and the Claude and Codex usage probes. It refused dashboard planning and the plugin
  installer, which boot code still calls, and left `pg` and `jose` static.
- The lazily built handlers and routers hold in-memory maps and closures over handles `init` opened,
  and no connections, timers, or subscriptions. Each plugin instance builds its own, so a reload
  starts fresh and disposal needs no new owner.
- Time to listen wasn't measured beyond one boot of each build. The PR screens weren't driven,
  because a `dev:agent` session has no GitHub sign-in.

## Starting point and owners

`plugins/github/src/node/index.ts` imports its routers statically and has three handwritten lazy
data handlers. Those handlers cache the resolved function, allowing concurrent first requests to
construct separate handlers. [Lazy plugin code](../lazy-plugin-code.md) specifies a promise-caching
`lazyFetch` helper and the GitHub mirror conversion; this phase is its implementation assignment.

The helper belongs in `packages/plugin-api/src/node.ts`, with its public snapshot in
`packages/plugin-api/src/surface.snapshot.txt`. `packages/node-core/src/server/pluginHost/fetchRoute.ts`
owns fetch dispatch and failure handling. `packages/node-core/src/server/routes/registry.ts` owns
mount ordering. `apps/node/scripts/measure-service-graph.mjs` explains static import chains.

The October 8 static module report attributed roughly 493 KB to Agents, 397 KB to Workflows, and
114 KB to GitHub. These are rendered module contributions, not guaranteed removable emitted bytes.
Agents and Workflows also perform recovery and register required services during boot.

## Implementation

1. Remeasure with `pnpm --filter @acorn/node measure:service-graph`. Use its `--why` option to trace
   candidates. Distinguish substantial optional implementations from declarations and operations
   called during normal boot. Measure emitted static bytes after phase 03's minification.
2. Add `lazyFetch` with one cached load promise. Concurrent calls must share construction; rejected
   loading clears the promise so a later request retries. Pass request and context through unchanged.
   Update the public export snapshot and follow the established plugin API test conventions.
3. Convert the three GitHub data handlers. Verify simultaneous first requests, rejected loading,
   Node shutdown/reload ownership, and no retained handler using a closed database.
4. Group lazy GitHub mirror routers in one feature-owned server module and preserve their registration
   order. Register a fetch dispatcher at the established prefix with an informative route note.
   Recheck overlaps with static mounts, device auth, imports, and task routes before switching carriers.
5. Select further cuts using demonstrated static reachability. Consider optional action handlers,
   dashboard query planning, workflow authoring, and uncommon agent operations. Register tool names
   and schemas, capability contracts, sources, hooks, and schedule keys eagerly; load their substantial
   implementations only when invoked. Record why each cut belongs on first use.
6. Keep store opening, migrations, interrupted-run recovery, required ready work, and scheduling
   obligations at their lifecycle point. Do not delay workflow recovery until a UI pane opens, and
   do not introduce a blanket lazy plugin-init rule or a 503-until-ready API contract.
7. Compare graph bytes, Node listener readiness, desktop usability, and first-request latency. Lower
   ceilings after measured savings. Add the helper and first-use diagnostics to the owning authoring
   reference and budget failure advice.

The previous lazy-route design measured a possible 76,793 B GitHub cut on October 6. Repeat that
measurement; minification, shared callers, and later changes affect the result. The same design
measured pg and jose as cheap to load and intentionally kept them static. Do not split small routes
or established fast imports for appearance alone.

## Verification and completion

Test the shared helper for concurrent construction, rejection/retry, and unchanged inputs. Exercise
route carrier ordering and authentication through the plugin host, not only by importing routers
directly. First-use failure must return the established error envelope and log its owner without
an unhandled rejection. A shutdown or reload must dispose any lazily created resources.

Run `pnpm lint`, `pnpm test --filter=@acorn/plugin-api`, `pnpm test --filter=@acorn/plugin-github`,
`pnpm test --filter=@acorn/node-core`, `pnpm test --filter=@acorn/node`, changed plugin/consumer suites,
`pnpm --filter @acorn/desktop test`, and `pnpm --filter @acorn/arch-tests test`.
Run `pnpm --filter @acorn/node build` and repeat the static graph report; both must pass.

In `pnpm dev:agent`, exercise PR list, files, conflicts, actions, and creation through the lazy path.
Verify active workflow and agent recovery after restarting an established disposable Node. Capture
first-use and repeated latency with phase 01 records. Finish with equivalent routes and recovery,
measured graph savings, and clear logged failures.

Update [the Node authoring guide](../../plugin-authoring/the-node-half.md),
[plugin API](../../plugins/plugin-api.md), and [profiling](../../local-development/profiling.md).
Reconcile the single-file lazy-route proposal after implementation so it cannot assign duplicate work.

## Recheck before implementation

If route overlap changes dispatch, or another static caller retains the module, resolve that before
conversion. If loading creates a subscription or connection, give disposal a lifecycle owner; a
cached promise alone is not resource management.
