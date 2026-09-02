# Phase 2: paint before the node

Status: not started. Waits on phase 0 for the timeline that proves it.

## Goal

The desktop window opens before the node has finished booting, the shell draws from the persisted
query cache with the node still absent, and the node's arrival is a status push the renderer already
handles. This is the desktop's half of [decisions.md](./decisions.md) decision 2; phase 3 is the
node's and phase 4 the terminal client's.

## Why this phase, and why now

A cold desktop start is one serial chain before a pixel. `apps/desktop/src-tauri/src/lib.rs` calls
`boot()` in `setup` and blocks the Rust main thread on the helper's ready line
(`apps/desktop/src-tauri/src/helper.rs`, 90-second timeout). The helper's `boot()` in
`packages/custody/src/index.ts` sweeps the plugin cache, rewrites the bundled plugin bundles, awaits
`helper.start()`, which is the node's entire boot over the service protocol, then binds its WebSocket
server and prints ready. Only then does the window open. The renderer then fetches 143 module
scripts through the `app://acorn` scheme handler, which reads each one synchronously off disk with
`cache-control: no-store`, and `apps/desktop/src/client/index.tsx` awaits `selectActiveNode()` and
`applyNodePlugins()` before `render()`. `App.tsx` gates the shell on `nodeReady()` behind that.

Every piece of the alternative exists. The fleet is `fleet.json` on the helper's disk, not a node
answer. `packages/client-core/src/infra/node/nodePlugins.ts` reads the roster failure-tolerantly.
`apps/desktop/src/shell/bridge.ts` wires the `node-status` push and the `node-replaced` reload. The
persisted cache and its `isRestoring` gate are in place. `apps/desktop/src/client/activate.ts`
argues in its own comment that registering plugins and correcting later beats waiting. And
`startHelperServer` takes the helper object and looks `push` up lazily ("the listener does not exist
yet"), so it has no dependency on `helper.start()` having resolved. The work is moving lines, not
building machinery.

## Scope

In:

- The helper binds its WebSocket server and prints the ready line before `helper.start()`. The node
  boot continues behind it, and the helper pushes `node-status` as it always has.
- The Rust shell opens the window on that earlier ready line. Nothing else in `lib.rs` changes.
- `index.tsx` drops `await selectActiveNode()` and `await applyNodePlugins()`. Both still run; neither
  gates `render()`.
- The cache partition key no longer waits on the fleet answer. `packages/client-core/src/infra/node/fleet.ts`
  derives it from the active node id, so the last-known active node id is read synchronously from
  the persisted selection (it is already persisted; see `docs/state-ownership.md`) and corrected
  when the fleet answers.
- The shell paints from the persisted cache behind the existing `isRestoring` gate, with a skeleton
  where the cache is cold and a footer or topbar state that says the node is starting. `NodeGate`
  in `App.tsx` becomes that state rather than a wall.
- `app_scheme.rs` serves asynchronously off the scheme callback thread, and a packaged build serves
  hashed `/assets/*` with `cache-control: public, max-age=31536000, immutable`. A dev build keeps
  `no-store`, because its files change under it.

Out: the node's own boot (phase 3). The 143-request waterfall's size (phases 0 and 1). Any change to
the service protocol.

## Design

**The ready line means "the helper is listening", not "the node is up".** That is what the renderer
needs, because the renderer's first act is to ask the helper for the fleet, and the fleet is the
helper's. `boot()` in `custody/src/index.ts` reorders to: legacy adoption, env files, `createHelper`,
`startHelperServer`, `bootComplete()` and the ready line, then `void helper.start()` with its failure
routed to the same recovery screen it reaches today. The crash budget and the recovery dialog are
unchanged; a node that fails to start after the window opened shows the dialog over the shell instead
of instead of it.

**The renderer treats the node as late by default.** `selectActiveNode()` and `applyNodePlugins()`
run as they do, un-awaited, and their effects arrive through the signals they already set.
`activate.ts` already registers every compiled plugin before the node answers; `applyNodePlugins`
re-runs the registration with the node's disabled list when it arrives, which is what its comment
says it was built to do.

**The partition key is the last-known node id.** `fleet.ts`'s `clientFor(nodeId)` needs a node id
before the fleet replies. The persisted active-node selection supplies one; if there is none (first
run), the shell renders the onboarding path it renders today when the fleet is empty. If the fleet
later says that node is gone, the existing `node-replaced` reload path handles it.

**A skeleton is the shell with empty lists.** No new component. The rail, topbar, and pane host draw
with `tasks` and `projects` empty and a `starting` status where the node chip is. The persisted
cache fills them on a warm start before the node is reachable, which is the point.

**Immutable assets in a packaged build.** `app_scheme.rs` already distinguishes dev from packaged for
the CSP. The same branch picks the cache header. Hashed filenames make `immutable` safe; `index.html`
keeps `no-store` so a new build's hashes are always read.

## Code touched

- `packages/custody/src/index.ts`: the reorder in `boot()`.
- `apps/desktop/src-tauri/src/lib.rs`, `helper.rs`: nothing structural; confirm the ready-line
  parse tolerates the node not being in the first status.
- `apps/desktop/src/client/index.tsx`, `App.tsx` (`NodeGate`), `activate.ts`.
- `packages/client-core/src/infra/node/fleet.ts`, `activeNode.ts`: synchronous last-known id.
- `apps/desktop/src-tauri/src/app_scheme.rs`: async serve, cache header by build kind.

## Tests

- `apps/desktop/test/boot.test.ts`: the helper's ready line arrives before `service.start` resolves
  (assert on the phase 0 marks' order), and the first `/v2` request still succeeds once it does.
- A Rust unit test in `app_scheme.rs`: a packaged build's `/assets/x-abc123.js` response carries
  `immutable`; `index.html` carries `no-store`; a dev build carries `no-store` for both.
- `fleet.test.ts`: `clientFor` with a persisted node id and no fleet answer yields a client whose
  persister key matches the one the fleet answer later produces.
- jsdom `hosts`: `App` with `nodeReady() === false` and a warm persisted cache renders the rail
  rows from the cache and the `starting` state in the chip.

## Docs owed

`docs/shell.md` § The shell process: boot order is no longer "the reverse of what a Tauri app
usually does"; rewrite the paragraph. `docs/shell.md` § Renderer origin and protocol handler: the
cache header. `docs/frontend.md`: the shell paints before the node. `docs/caching.md` § Renderer
query cache: the partition key comes from the last-known node id.

## Done when

- The phase 0 timeline shows the window open before `[service:boot] listener-up`.
- With a warm cache and the node killed, the shell draws the rail and the last task's panes with
  stale badges and a `starting` chip, and recovers when the node returns.
- A cold cache draws the empty shell, not a blank window.
- The desktop boot test and the Rust suite are green.

## Verify before building

- Confirm `boot()` in `packages/custody/src/index.ts` still awaits `helper.start()` before
  `startHelperServer`, and that `startHelperServer` still looks `push` up lazily. Read at `17a9acdf`.
- Confirm `index.tsx` still has the two top-level awaits and `App.tsx` still gates on `nodeReady()`.
- Confirm the active node selection is persisted and readable synchronously; if it is not, that is
  the first task of this phase.
- Confirm `app_scheme.rs` still reads with `fs::read` in the callback and sends `no-store` for
  everything.
