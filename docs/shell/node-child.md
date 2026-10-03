# The Node child and shell telemetry

This page covers how the helper starts and supervises the local Node, the service protocol between
them, and what the helper and the Rust shell report. It's part of [desktop shell](../shell.md).

## Node child

The helper starts the staged `service.js` under the runtime it runs on, the bundled Node:

```ts
spawn(process.execPath, [entry], {
  env: { ...process.env, NODE_COMPILE_CACHE: compileCache },
  stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
})
```

`NODE_COMPILE_CACHE` points at `<userDataDir>/compile-cache/<build>`, where Node keeps V8's compiled
code between launches. `<build>` is a hash of `service.js`, which names every chunk the service
loads, and `@acorn/custody/supervision/compileCache.ts` removes other builds' directories before the
spawn, because Node never removes an entry. Node checks each entry against its source, so a stale
cache costs a compile, not a wrong program. The directory is in the custody root, because it's the
app's disposable copy, not your data.

The Node sends a versioned service-protocol `start` response with its `nodeId`, endpoint, certificate
fingerprint and PEM, and local device token. The helper adds that record to the broker only after the
listener is ready. Startup failures fail closed.

The crash budget (`@acorn/custody/supervision/crashBudget.ts`) allows five restarts in a ten-minute
window, waiting 1, 2, 4, 8, then 16 seconds before each. A sixth crash in the window shows the
recovery screen instead of restarting into the same fault. Each start reuses the device token the Node
used before, so a restart never mints a new device row. The recovery screen is a native dialog,
because the shell that would draw it is behind the gate. Its **Retry** forgives the spent budget,
because you may have freed the port. It also shows why the last attempt failed when the service
said, such as another Node holding the data root or a port it couldn't bind.

The Node owns SQLite, migrations, HTTP and WebSocket listeners, PTYs, tmux, worktrees, Git,
processes, workflows, Docker, provider clients, reconciliation, and shutdown draining. Quit asks it to
close the listener, dispose plugin engines, close SQLite, and release the data-root lock, within 30
seconds.

Nothing may outlive what supervises it. A Node that survives its helper keeps the data root's lock,
and the next launch fails with "Another acorn node already holds `<dataDir>`". Two rules prevent that:

- `ServiceHost.stop` waits for the child to exit and keeps its SIGKILL timer referenced, because the
  helper runs `process.exit` as soon as `dispose` resolves. Waiting also makes `restartLocalNode` safe:
  it stops and then starts, and the new Node needs the old one's lock.
- `Helper::stop` in Rust waits for the process group to empty, then sends SIGKILL to whatever is left.
  This backstop works even when the helper crashes outright.

A wedged Node costs about eight seconds at quit, the Rust escalation deadline. Two Rust tests cover a
child that outlives its parent and a child that ignores SIGTERM.

The supervised child and the standalone Node use the same `apps/node/src/composition/composition.ts`
graph and the same reconciliation and drain plan.

## Service protocol

`packages/protocol/src/device/serviceProtocol.ts` defines the versioned lifecycle messages between the
helper and its Node: `service.start`, `service.stop`, and `service.preview-rules`. Both ends validate
messages with Zod, and pending calls reject on timeout or peer exit. Every method is one the helper
calls on the Node, and the Node receives no window, webview, or shell object. Product requests use
`/v1` over the broker.

## What the helper reports

Telemetry is off by default, and when it's on the helper builds the same five record kinds as every
other runtime ([telemetry](../telemetry.md)). The helper uses the Node's collector
(`packages/node-core/src/server/telemetry/collector.ts`), because it already depends on
`@acorn/node-core`, and its logger writes to stderr, which suits a process whose stdout is a wire.

| Seam | Where | What it emits |
| --- | --- | --- |
| The boot account | `packages/custody/src/bootMarks.ts` | Span `helper.boot` with a `helper.boot.mark` child per mark |
| Every request to a Node | `packages/custody/src/broker/nodeBroker.ts` | Histogram `broker.request` with the Node ID and the method |
| The socket's health | The same file | Events `broker.reconnect`, `broker.degraded`, `broker.shed`, and `broker.missed-pong`, each with the Node ID |
| A Node that died | `packages/custody/src/supervision/crashBudget.ts` | Event `node.crash` with the count in the window, and a fatal error when the budget is spent |
| Memory, every 30 seconds on macOS | `packages/custody/src/telemetry.ts`, answered by the shell | Gauge `runtime.memory.footprint` in bytes, for the helper and, in its own batch, the renderer |
| Every bridge call | `apps/desktop/src/shell/bridge.ts` | Histogram `bridge.call` with the helper method, from the renderer |
| Console lines | `packages/custody/src` and `apps/desktop/src/helper` | Log records through `createLogger(tag)` |

`bridge.call` is the renderer's record, because the bridge runs in the window. A slow `bridge.call`
beside a fast Node says the broker is where the time went.

### The switch, over the wire

Collection needs the `telemetry.enabled` preference and a sink, and the helper has no database to read
the preference from. So `packages/custody/src/telemetry.ts` asks the local Node over the broker: once a
minute while it's off, and every five seconds once it's on, the collector's flush tick. The sink is
registered on yes and dropped on no, so a helper nobody collects from has no flush timer. A batch that
fails to post is kept for the next attempt, up to 500 records, because a restarting Node is when the
records matter. The boot marks become spans after the fact, because the answer arrives after boot.
`ACORN_PERF=1` prints them ([profiling](../local-development/profiling.md#timing-a-cold-start)).

## What the shell reports

The Rust shell reports a crash record, late, and memory readings when the helper asks.

A panic hook can only write a file while the process dies, and the helper dies with it. So
`apps/desktop/src-tauri/src/crash.rs` installs `std::panic::set_hook` once `boot` has resolved the two
roots, and a panic writes `shell-crash.json` into the custody root with the message, the file and line,
the thread, and the app version. The helper reads it on its next boot, posts it as one fatal error with
`runtime: shell` in a batch of its own, and deletes it whether or not the post worked. The file has the
telemetry error record's shape, minus `kind`.

WebKit gives a page no way to read its own process's memory. Every 30 seconds while telemetry is on,
and only on macOS, the helper prints `{"acorn-helper":"footprint-request"}` on stdout.
`apps/desktop/src-tauri/src/footprint.rs` answers on the helper's stdin with
`{"command":"footprint","renderer":<bytes>|null,"helper":<bytes>|null}`. The helper emits its own
number and posts the renderer's in a batch named `renderer`, both as `runtime.memory.footprint`
([diagnosis](../telemetry/diagnosis.md#memory-over-a-day)).

The shell reads the main window's web content process through `_webProcessIdentifier`, a private
WKWebView selector, because wry and Tauri expose no public way. It checks that the view answers the
selector first, because an unknown selector raises an Objective-C exception that would abort the
process. It reads the PID on every request, on the main thread, because WebKit replaces a crashed
content process under a new PID. The footprint is `ri_phys_footprint` from
`proc_pid_rusage(pid, RUSAGE_INFO_V4)`. A process that can't be read answers null. Child webviews
aren't measured.

### Active renderer responsiveness

The optional `reportResponsiveness` platform capability sends `renderer-pulse` over the helper socket.
The renderer decides consent, visibility, and focus, and supplies its current operation name, owner,
and trace IDs. The helper keeps a watchdog per socket, removed on close. It runs outside the renderer,
so a stuck render span isn't the only evidence of a frozen UI
([diagnosing an unresponsive view](../telemetry.md#diagnosing-an-unresponsive-view)).
