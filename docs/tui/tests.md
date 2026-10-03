# Terminal client tests

This page covers the terminal client's test harness, its boot test, and the agent driver. It's part
of [the terminal client](../tui.md). [Test layers](../testing/layers.md#terminal-client) owns the
tiers.

## Tests

The suite has one case per kit node against a cell buffer, and one per layout drawn from its
projection. It has a twin of client-core's `keys.test.tsx` against the terminal adapter, and a pane
file that opens every first-party pane at 80 by 24 and checks that what the pane is for is on the first
screen. A chrome file drives the whole shell, and a reachability file walks every stop on nine surfaces
and checks the invariants after every press ([invariants](./reporting.md#the-invariants)). Five files
need no renderer: the focus invariants about the source, the palette's 16-slot colors, the clipboard
sequence, the plugin sandbox, and the boot test. Nothing skips, and nothing needs a flag.

### The harness

The harness is the real renderer with its two ends replaced. `apps/tui/src/kit/render.tsx` draws one
fragment and `apps/tui/src/harness.tsx` drives the whole shell. Both open the renderer the app opens,
with stdout as a buffer and no terminal. A test reads the frame that was painted, as characters and as
colored runs, so it can check that a focused control is lit.

`press` puts a `KeyEvent` straight onto the key stream, so nothing waits to see whether a lone Escape
starts a sequence. A press waits for the fixture requests it started, held PTY frames, and the render
loop to settle. The fixture reports outstanding requests, including its opt-in delayed transport, and
the frame scheduler rejects an unreleased hold. The harness clears deadline timers and reports an
unsettled key or frame instead of drawing a partial tree. The slow-transport test keeps a 50 ms delay
and checks the two-pane layout at 100 cells and, with `ACORN_TUI_WIDE`, at 120.

### The boot test

`apps/tui/src/node/boot.test.ts` is to this client what `apps/desktop/test/boot.test.ts` is to the
shell. With a fresh data root and config directory, it starts a real standalone Node, uses the real
fleet store, token files, and broker over pinned TLS, and checks three things only this host has: a
second `acorn` attaches instead of starting a second Node, a refused token shows as `revoked` and stops
retrying, and quitting drains the child and releases the root's lock.

### The agent driver

For terminal UX work, the agent driver runs the compiled client in a real PTY and reads its cells
through a headless terminal. It sends raw keyboard input through the parser the harness skips, records
snapshots and resizes, and can run a navigation flow against the shared desktop fixture.
[Agent drivers](../local-development/agent-drivers.md#drive-the-terminal-client) has the commands. A
real terminal emulator and a person still cover color, focus, and host-specific behavior.
