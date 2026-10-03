# Profiling startup and task switches

This page explains how to time a cold start and a task switch on your own machine. Read it before you
quote a startup number or chase a slow launch.

## Timing a cold start

Each of the four processes logs its own boot. Every line carries `+Nms` from that process's start and
`(Nms)` for the step alone, so the slow step is the one wide number.

### The Node's marks

The Node always prints its `[service:boot]` marks, with no switch, so a slow bind says so without
anyone asking. The steps, in order:

1. `login-shell`, `bundled-packages`, `migrate`, and `graph`. `graph` is the plugin loader importing
   whatever is installed in the data root.
2. One line per plugin per pass, such as `plugin github init` and `plugin x ready`.
3. `install`, `cert`, `bind`, `listener-up`, and `scheduler`.
4. The four `reconcile.*` steps, then `teardown`.

The per-plugin lines exist because `install` alone can't say which plugin was slow.

Read three labels with care:

- **`login-shell`** marks when the `PATH` probe started, not when it finished. The probe runs behind
  the boot, and the first process the Node spawns waits for it. [Node distribution](../node-distribution.md)
  § Boot order explains why. The step takes a fraction of a millisecond even when the probe takes half
  a second.
- **The per-plugin lines** are wall-clock slices, not per-plugin costs, because the whole `init` pass
  runs at once. A plugin's line says when it finished. If a plugin awaits something, the plugin that
  finishes next takes the credit for the gap.
- **`migrate`** covers `makeRuntime`, which opens and migrates `core.sqlite` and then builds the other
  runtime bindings. A slow `migrate` isn't necessarily a slow migration. Drizzle's `migrate` against an
  up-to-date journal is one `SELECT`.

The Node's clock starts inside `startServiceRuntime`. Spawning the process and evaluating the service
bundle happen before `+0ms`. On an M2 Pro that gap is about 100 ms, mostly evaluating the service
chunk. Calling `startServiceRuntime` under `tsx` instead of launching the app inflates `graph` about
sevenfold, because the loader then transpiles as it imports.

`graph` also depends on the data root. A fresh root, like the one `apps/desktop/test/boot.test.ts`
uses, takes a few milliseconds. A root that has run the app holds the bundled loaded plugins, and
`graph` then starts an isolated worker for each one with a Node half. On an M2 Pro that's about 110 ms
for seven plugins. Time a launch against an established root, such as a
`pnpm dev:agent -- --reuse` session, before you quote a Node boot figure.

### The other processes

Everything else prints only with `ACORN_PERF=1`, because those streams are the ones a developer
watches while using the app:

| Process | Turn it on | Prints |
| --- | --- | --- |
| Helper | Set `ACORN_PERF=1` in the environment that starts the shell | `[helper:boot]` on stderr: handshake, plugin-cache sweep, bundled plugins trusted, `service.start`, Node adopted, WebSocket bound, and the ready line. Stdout is the line protocol Rust parses. |
| Node | The same variable | `[perf:request]` per request, with method, route pattern, status, milliseconds, response bytes, and request ID, plus `git` and SQLite histograms. Response bytes come from `content-length`, and `-1` means none was declared, which is what a stream looks like. |
| Renderer | Run `localStorage.setItem('acorn.perf', '1')` and reload | `[renderer:boot]` in the devtools console: script start, Node selected, plugins applied, tree built, first paint, and `nodeReady`. |
| `acorn` | Nothing | `[acorn:boot]` on exit: Node open, App imported, tasks read, renderer created, and first draw. |

The renderer uses a `localStorage` switch because a webview has no environment. Rust loads it from a
custom scheme instead of spawning it. Its `performance.mark` calls happen either way, so the devtools
performance panel shows the same labels with the switch off. With telemetry on, the marks up to
`nodeReady` also go to sinks as a `renderer.boot` span. [Telemetry](../telemetry.md) § Renderer seams
covers those.

`acorn` holds its lines until exit, because stderr is the terminal the renderer draws on. A line
written mid-session would corrupt the screen. It prints them after `renderer.destroy()`, beside any
held Node warnings.

The Node's histograms count work repeated with nothing else counting it: `git status` and `git diff`
as `git.<subcommand>`, and SQLite statements as `sql.<verb>`. They print when the Node drains.
`kill -USR2 <pid>` dumps and clears them mid-session, so a second dump covers only the interval.

`ACORN_PERF=1` prints from the telemetry collector, so it also turns collection on with no sink and
no preference. `packages/node-core/src/server/telemetry/collector.ts` owns this, and
[telemetry](../telemetry.md) § The switch describes it. The request line prints when the request
ends, not at the collector's flush, so you see it right away instead of in a burst five seconds later.

Every other line the Node writes goes to stderr through `createLogger`. Stdout carries only two
things, both from `apps/node/src/entries/standalone.ts`: the handshake JSON and the pairing banner.

### Read a desktop cold start

A desktop cold start combines three accounts:

1. Rust spawns the helper. The helper's `[helper:boot] ready line` is all Rust waits for.
2. The window opens as soon as the helper listens, and shows the startup loader. The Node boots
   behind it, so `[service:boot] listener-up` isn't inside Rust's wait.
3. The renderer's clock starts at its document's navigation, after Rust creates the window.

The accounts meet at `[helper:boot] service.start`, where the Node reports that it's listening. The
span from `ready line` to `service.start` is the Node's share of the launch. `node selected` is the
fleet selection, which happens before the Node is up. `nodeReady` is the local Node's first status
reaching the renderer, which is when the shell mounts and sends its first reads.
[Frontend](../frontend.md) § Startup readiness describes the loader.

`[renderer:boot] first paint` doesn't print from a background window. It's a `requestAnimationFrame`
callback, and macOS pauses those while the window is hidden. Bring the window to the front before you
reload, or read `tree built` instead. That line prints when `render` returns, wherever the window is,
and it marks the end of the renderer's own work.

## Timing a task switch

Renderer spans such as `nav.change`, `pane.region`, `pane.model`, and `api.request` go to telemetry
sinks. The one shipped sink sends them to Sentry. To read them locally:

1. Run `localStorage.setItem('acorn.perf', '1')` and reload.
2. Turn telemetry on in Settings → Telemetry.

Every span is then also a `performance.measure` named `acorn:<span name>`, with its attributes as
`detail`. `setSpansOnTimeline` in `packages/client-core/src/infra/telemetry/emitter.ts` does this. The
devtools performance panel draws them, and `performance.getEntriesByType('measure')` returns them. A
WebDriver script against `pnpm dev:agent` can read a switch this way without a round trip inside the
timed window. An `api.request` entry carries `responseBytes`, which the Node's `[perf:request]` line
can't give for a response with no `content-length`.

The spans stop at their own seams. `pane.region` ends when a region's content mounts, and
`nav.change` ends on the second animation frame, so neither waits for a pane's data. A pane that draws
from a store instead of a query, such as the agent transcript, fills in after both end. To time a
switch to a populated pane, watch the pane's content and take the moment it stops changing.

Keep the window visible for the whole run. WebKit runs no animation frames for a window behind
another window or on a locked screen. `nav.change` never ends there, virtualized lists such as the
diff rows never draw, and timers slow to about one a second. Synchronous work and request counts
still measure correctly in a hidden window.
