# Phase 5: loaded plugins

Status: **shipped 2026-08-31.** What shipped, and where it differs from the plan, is at the bottom.

Read [findings.md](./findings.md) first. One line of it is now wrong and phase 5 is what corrected it:
the host half needs no permission flags at all, because a worker thread's grants turn out to be its
own.

## Goal

A loaded plugin's tree renders in the TUI from a Node worker under permission flags, its bundle held
in a file cache the TUI hashed, its trust prompt drawn as a kit tree, and `docs/security.md` says
where the terminal sits.

## Why this phase, and why now

Phases 0 to 4 are first-party. Third-party plugins are what the tree protocol exists for, and the
sandbox they need on a terminal is the same object node-half containment needs
(`docs/security.md § The containment ladder`, rung 2). Building it here, for a host that cannot fall
back to an iframe, means the node half inherits a tested design.

## Scope

In:

- A `worker_threads` factory through `_setWorkerFactory` in
  `packages/client-core/src/host/tree/workerHost.ts`, loading a bundle by path from the cache
  under `--permission` with no grants.
- The tree host's rendering shell on the TUI: `RemoteTree` and `Slot` siblings that apply
  `acceptable()`/`apply()` to a Solid store and draw through the TUI's `KIT_COMPONENTS`, with the
  renderer's tick in place of `requestAnimationFrame`.
- `PluginCustody` over files: content-addressed cache, acknowledgement file, `(pluginId, hash)`,
  `{ path }` sources allowed.
- The `plugins` seam group provided; loaded plugins appear.
- The trust prompt as a kit tree in a `Modal`.
- The bridge port's fourteen effects and three pushes over the worker's `MessagePort`.
- A decision, recorded, between a worker thread and a child process after measuring `--permission`.
- `docs/security.md`'s third column, per [06-isolation.md](./06-isolation.md).

Out: the node half moving out of process (this phase designs for it and builds none of it), signing,
discovery.

## Design detail

**The factory.** `workerHost.ts` builds `new Worker(url, { type: 'module' })` at one line and exposes
`_setWorkerFactory` for tests. The TUI's factory builds `new (await import('node:worker_threads')).Worker(path, { execArgv: ['--permission'] })`
and adapts `postMessage`/`on('message')` to the `MessagePort` shape the host expects. Everything
above the factory is shared.

**The two paths, again.** `twoPaths.test.tsx` renders the agents tool card once through the DOM
`KIT_COMPONENTS` and once through a batch into `TreeHost`, and asserts the same DOM. The TUI gets the
same test against the TUI table asserting the same cells. This is the test that says a loaded plugin
and a compiled one are indistinguishable in a terminal.

**Custody.** `apps/tui/src/plugins/custody.ts` (new) implements the four members. The cache is
`<config>/plugins/cache/<hash>.js`, written after hashing and compared to the manifest's hash; the
acknowledgement file is `<config>/plugins/trust.json`, the desktop's trust store schema from
`@acorn/protocol`. `packages/client-core/src/host/plugins/host.ts` remains the only caller of `pluginCustody()`.

**Permission flags.** `--permission` is process-wide in Node and a worker thread inherits the
parent's grants, which means the TUI process itself would run under `--permission` with grants for its
own config directory and the node's endpoint. Measure whether that is workable; if not, a child
process per plugin with the two ports over IPC. Record the answer in `docs/security.md § Rung 0` for
the terminal and in `docs/future/ecosystem/blockers.md` for rung 2.

## Code touched

- `apps/tui/src/plugins/{workerFactory,custody,RemoteTree,Slot,TrustPrompt}.ts(x)` (new).
- `packages/client-core/src/host/tree/TreeHost.tsx`: the coalescer takes a scheduler; the
  rendering shell is separated from `acceptable()`/`apply()` if it is not already.
- `packages/client-core/src/host/tree/workerHost.ts`: no change expected beyond the factory seam.
- `docs/security.md`: five sections.

## Tests

- The TUI twin of `twoPaths.test.tsx` and `remoteSolid.test.tsx`.
- A worker under `--permission` that tries `fs.readFile` outside its bundle path fails the slot with
  a roster row and the tree draws the placeholder.
- A bundle whose bytes do not match its hash is refused and never cached.
- The trust prompt draws the three tiers and the key diff from a fixture `trustModel` record; accept
  writes the acknowledgement; refuse does not.
- Heartbeat and grace: a worker that stops answering pings is stopped and its slots fail.

## Docs owed

- `docs/security.md § Trust boundaries`, `§ Transport and auth`, `§ Third-party plugin bundles`,
  `§ The containment ladder`, summary table: the terminal column.
- `docs/plugins.md § The tree contract`: "a second host exists and applies the same mutations to
  cells".
- `docs/future/ecosystem/blockers.md`: rung 2 has a down payment.
- `docs/future/client-plugins/07-hosts.md`: the terminal host exists; its custody is this.

## Doors left open

- The node half out of process: the factory, the flags, and the ports are the design; the node's
  context-as-calls is the remaining work.
- Device-held plugins on the TUI: `{ path }` install through the same custody, the client-plugins
  programme's phase 0 on this host.

## Done when

A loaded plugin built with `create-acorn-plugin` and installed by path draws its pane in the TUI after
the trust prompt, its `onPress` reaches the worker and back, and a plugin that reads a file it was
not granted is refused and shown as a placeholder.

## Verify before building

- `packages/client-core/src/host/tree/workerHost.ts` still exposes `_setWorkerFactory`.
- `TreeHost.tsx` still separates `acceptable()` and `apply()` from the JSX.
- `packages/client-core/src/host/plugins/host.ts` is still the only caller of `pluginCustody()`.
- Node's `--permission` model at the pinned runtime version: check whether worker threads can be
  granted less than the parent.

## What shipped, and where it differs

Five departures from the plan above, in the order they matter.

**A worker thread, and no measurement worth recording as a trade-off.** The plan said to measure
whether `--permission` being process-wide made a worker thread unworkable, and to fall back to a child
process per plugin with the two ports over IPC. Measured on Node 24.11 and 26: `execArgv` applies the
permission model to the thread, and the worker is denied a read the parent is allowed. So the answer is
the worker thread, the fallback is not built, and the TUI process runs with no flags of its own. The
grants are the bootstrap and the bundle, `realpathSync`'d, and nothing else.

**The network hole, closed in the sandbox.** Node's permission model does not cover the network, which
is what the DOM worker's CSP gave away free. `apps/tui/src/plugins/pluginWorker.js` runs before a
stranger's module scope and installs a `module.registerHooks` resolver refusing fourteen builtins —
`node:module` and `node:worker_threads` among them, so a bundle cannot undo the hook or start a thread
that inherited none of it — and deletes five globals. This was not in the plan and it is the difference
between "contained" and "contained except for the internet".

**`TreeHost.tsx` split rather than parameterised.** The plan said "the coalescer takes a scheduler; the
rendering shell is separated from `acceptable()`/`apply()` if it is not already". It was not. The store,
the pre-flight check, the apply, the prop sanitiser and the coalescer are
`client-core/host/tree/treeState.ts` with no JSX in them, and both hosts write a shell over it. That is
a bigger change than a scheduler parameter and a smaller one than two tree hosts: two copies of the
batch rules would have been two copies of a security decision.

**Two more host seams than the plan named.** `frames/register.ts` reached for the DOM's `RemoteTree`
and the DOM's layout table by name, which is exactly the finding phase 0 recorded one registry over.
Both are host-supplied now with the DOM's as the fallback. And `createFrameServices` took
`navigator.clipboard` and `window.open` as given; `FrameServiceHost` has an optional `copy` and
`openExternal`, so this host answers with OSC 52 and a notification.

**`Slot` is not built.** The plan's file list named it. It has no consumer: a surface owner reaches it
through `@acorn/plugin-api/ui/host`, a DOM-heavy barrel this host does not alias, and a tree bundle
cannot emit a `Slot` node by design. The pane sweep is where that barrel crosses, so it goes there.

## What this phase deliberately left

- **A device-held install.** `{ path }` is a form the custody accepts and nothing offers, because there
  is no surface to reach it from. `docs/future/client-plugins/`'s phase 0, on this host.
- **The node half out of process.** As scoped: this phase is the design's proof and none of its
  implementation. What rung 2 still owes is `ctx` as authorised calls and the plugin-scoped token behind
  them, and `docs/security.md § Rung 2` now says which of its open questions this settled.
- **A real bundle through the whole path.** The two plugins that ship a tree bundle are built by the
  packaged-build pipeline rather than by `pnpm build`, so every claim here is tested against a bundle
  the suite wrote. The first real one through will be found by phase 6 or phase 7.
