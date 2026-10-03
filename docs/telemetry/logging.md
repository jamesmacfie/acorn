# Logging

This page covers the two loggers, the architecture rule that keeps `console.*` behind them, and what
a log line looks like. Read it before you write a log line or add an exception to the rule. It's part
of [telemetry](../telemetry.md).

## The rule

`packages/node-core/src/server/telemetry/logger.ts` is the only file that may call `console.*` under
`packages/node-core/src`, `apps/node/src`, `packages/custody/src`, and `apps/desktop/src/helper`.
`packages/client-core/src/infra/telemetry/logger.ts` is the only one under `packages/client-core/src`,
`apps/desktop/src/client`, `apps/desktop/src/shell`, and `apps/tui/src`. `tools/arch/boundaries.test.ts`
holds both with a shrinking baseline.

A third rule covers `plugins/*/src`, and its baseline is empty. A plugin writes through `ctx.log` when
a context is in reach, and through `createLogger(tag, '<plugin id>')` from `@acorn/plugin-api` when one
isn't.

Everything else in the baseline writes something that isn't a log line:

- `apps/node/src/entries/standalone.ts` and `apps/desktop/src/helper/helperMain.ts` write handshake
  JSON a launcher parses off stdout.
- `apps/node/src/entries/standalone.ts`, `apps/tui/src/node/pair.ts`, and `apps/tui/src/node/open.ts`
  print a pairing banner for the person at that terminal.
- `apps/tui/src/platform.ts` prints the data-root path, which is what "open the data folder" means in
  a terminal.

## What a line looks like

`createLogger('schedules').warn('github:refresh timed out')` prints
`[schedules] github:refresh timed out`. Attributes render as `key=value` at the end of the line, so a
line stays one line and stays greppable.

The Node logger scrubs its tag, message, attribute keys, and string values before it writes stderr or
emits a record, even when collection is off. Tags keep at most 512 characters and messages 2,000, and
attributes use the collector's limits. Stderr shows at most 200 characters per string attribute and
4,000 UTF-8 bytes for the whole line, without splitting a multibyte character. Tabs and line breaks
become spaces. The performance printer scrubs its text and metric names too.

Everything goes to stderr, `info` and `debug` included, because stdout is a wire in the standalone
entry and the desktop helper. The logger calls `console.error` and `console.warn` rather than
`process.stderr.write`, because many Node tests spy on those two, and a logger writing underneath them
would pass those tests vacuously.

The client logger writes to the devtools console, and keeps `console.warn` and `console.error` for the
two levels the console filters on. It takes a second argument the Node's doesn't: a caught error, so
the console can show its expandable object. The record takes that error's name and message as two
attributes, because a record can't carry an object.

A line written through `ctx.log` carries the plugin id the host bound, reaches every sink, and is
scrubbed on the way, which is what makes it different from `console`.

`kit/` is the exception to the client rule's remedy. It may import only `kit/` and the highlighter,
because `@acorn/plugin-api/ui` re-exports it, so a boundary in there can't reach the emitter.
`kit/lib/telemetry/contributionErrors.ts` is the seam: the boundary reports through it, and telemetry
start-up installs the handler.
