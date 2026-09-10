# Phase 3: the terminal client, the helper, and the shell

Status: not started. Waits on phase 1.

## Goal

The three runtimes that carry no plugins still report. The terminal client emits a frame-paint
histogram and a key-dispatch histogram, and its held console lines become log records. The desktop
helper emits its boot marks as spans, its broker health as events, and a proxied-request histogram.
The Rust shell writes a crash record on panic that the helper forwards on its next boot. All three
post batches to the node over the phase 1 route.

## Why this phase, and why now

A frame that takes 40 ms in the terminal, a broker that misses pongs, and a shell that panics are the
three failures nobody can see today. The helper and the terminal client are both client-core with
custody in-process, so they reuse the phase 1 emitter and change only how a batch leaves.

## Scope

In:

- `apps/tui/src/renderer.ts` `frame()`: a `tui.frame` histogram, split into layout, paint, and flush
  if the split costs less than a microsecond each. `apps/tui/src/keys/install.ts`: a `tui.key`
  histogram from the `key:after` intercept, with the step count when the counter is on.
- `apps/tui/src/main.tsx`: the held console lines go through the logger; the hold stays, because
  stderr is the screen. Boot marks become spans.
- `packages/custody/src/bootMarks.ts`: marks become spans under one `helper.boot` root.
  `packages/custody/src/broker/nodeBroker.ts`: `broker.request` histogram; `broker.reconnect`,
  `broker.degraded`, `broker.shed`, `broker.missed-pong` events.
  `packages/custody/src/supervision/crashBudget.ts`: `node.crash` event; a fatal error when the
  budget is exhausted. `apps/desktop/src/shell/bridge.ts`: `bridge.call` histogram.
- The helper posts its batches to the active node over the broker with the device token.
- `apps/desktop/src-tauri/src/lib.rs`: `std::panic::set_hook` writing `<dataRoot>/shell-crash.json`
  with the message, location, thread, and app version. The helper reads and deletes the file on boot
  and emits a fatal error with `runtime: shell`.
- The 57 console sites in `packages/custody/src`, `apps/tui/src`, and `apps/desktop/src`.

Out: telemetry from the shell over any network path of its own; a profiler for the terminal client.

## Design detail

**Nothing synchronous on the paint path.** The key trace already writes through an appending stream
because a synchronous write on the loop that draws measures itself. The frame histogram is two
`performance.now()` reads and an array push; the batch leaves on a timer, never inside `frame()`.

**The shell has no runtime to post from.** A panic hook runs while the process is dying; it can
write a file and nothing else. The helper is the shell's child and is gone too. So the record waits on
disk for the next boot, which is the same pattern the crash budget uses for its window.

**The helper is the device.** It holds the device token and the broker, so it posts to the node the
way the renderer does, with `runtime: helper`, and forwards the shell's crash file with
`runtime: shell`. The node re-stamps `runtime` from the batch only for the helper principal, because
only the helper can speak for the shell.

## Code touched

- `apps/tui/src/renderer.ts`, `apps/tui/src/keys/install.ts`, `apps/tui/src/main.tsx`,
  `apps/tui/src/node/` for the poster.
- `packages/custody/src/bootMarks.ts`, `packages/custody/src/broker/nodeBroker.ts`,
  `packages/custody/src/supervision/crashBudget.ts`, `packages/custody/src/telemetry.ts` (new) for
  the poster and the crash-file reader.
- `apps/desktop/src/shell/bridge.ts`, `apps/desktop/src/helper/helperMain.ts`.
- `apps/desktop/src-tauri/src/lib.rs`, `apps/desktop/src-tauri/src/crash.rs` (new).
- The console sites.

## Tests

- Terminal: a fixture run with `ACORN_FIXTURE_DELAY_MS` produces `tui.frame` samples; a key press
  produces one `tui.key` sample; no record is built when disabled.
- Helper: `bootMarks` produce spans in mark order; a missed pong produces an event; a crash file on
  disk produces one fatal error and the file is gone.
- Rust: a unit test that the hook writes a well-formed file to a temp data root.
- The desktop boot test still sees `[helper:boot]` lines in order.

## Docs owed

`docs/telemetry.md` (new in phase 0) gains a section per runtime; `docs/tui.md` and `docs/shell.md` get theirs.

## Doors left open

1. The crash file's shape is the error record's, so a future crash reporter in the shell (a native
   dialog offering to send it) reads the same file.
2. `broker.request` carries the node id, so a fleet view of slow nodes is a query.

## Done when

- `acorn` in a terminal with telemetry on produces `tui.frame` and `tui.key` histograms at the node.
- Killing the node under the helper produces a `node.crash` event; exhausting the budget produces a
  fatal error.
- A forced panic in a dev build of the shell produces a fatal error with `runtime: shell` on the next
  boot, and the file is gone.
- `rg "console\." packages/custody/src apps/tui/src apps/desktop/src` finds only the logger and the
  helper's stdout handshake.
- `pnpm lint`, `pnpm test`, and `pnpm --filter @acorn/desktop test` are green.

## Verify before building

- `apps/tui/src/renderer.ts` emits a `frame` event after each paint and `apps/tui/src/main.tsx`
  holds console lines until `quit()`.
- `apps/tui/src/keys/install.ts` installs a `key:after` intercept behind `ACORN_TUI_KEYS_TRACE`.
- `packages/custody/src/bootMarks.ts` prints `[helper:boot]` to stderr and the boot test reads it.
- `apps/desktop/src-tauri/src/lib.rs` has no `panic::set_hook`.
