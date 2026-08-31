# Phase 5: loaded plugins

Status: not started. Waits on phase 2. Runs beside phase 6.

Read [findings.md](./findings.md) first: the host half now needs `--allow-ffi` and `--allow-worker` of its own before a plugin worker gets none.

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
