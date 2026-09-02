# Phase 6: terminals do work only when watched

Status: not started. Waits on phase 5's `seq` accounting, because the reconnect this phase makes rare
is the one phase 5 stops triggering.

## Goal

A terminal session nobody is looking at costs the node no parser time. A tab switch in the terminal
panel touches no network. Terminal output crosses the wire once per broadcast as bytes rather than
once per socket as escaped JSON. This is the node-side half of the terminal shape from
[architecture.md](./architecture.md) § 3, written out here so it can be picked up alone.

## Why this phase, and why now

The terminal design is sound and the implementation inverts its costs. The node owns a canonical
screen per PTY through an `@xterm/headless` emulator with 1,000 lines of scrollback
(`plugins/terminal/src/server/terminalDisplay.ts`), so a client can attach late and receive the screen
instead of replaying history. But the emulator runs at full rate for every session whether anyone is
attached, and its only consumer is `attach()`. No agent reads it; agent-facing terminal state comes
from the raw ring in `plugins/terminal/src/server/terminal.ts`. A background task's build pays
continuous ANSI parsing to produce a screen nobody reads.

The common operation is the expensive one. `plugins/terminal/src/client/TerminalPanel.tsx` mounts
only the active tab, keyed by session id, so each switch destroys the xterm and its WebGL context,
asks the node for a full serialise, ships it as one frame, and parses it into a fresh emulator. The
same cost applies on every reload and every reconnect.

Every live byte is parsed by two emulators on the desktop and three in the terminal client, where
`apps/tui/src/kit/pty.ts` writes into OpenTUI's `EmbeddedTerminalRenderable`; that third parse is
how a terminal draws a terminal and stays. Every byte is also JSON-escaped once per attached socket
(`packages/node-core/src/server/transport/wsHub.ts` stringifies per connection) and again on the
helper hop. And the 256 KB raw ring is rebuilt by string concatenation on every PTY chunk to serve
readers that take the last 10 KB.

## Scope

In:

- The headless emulator runs only while `live.size > 0`. On a cold attach the node rebuilds the
  screen by replaying the raw ring through a fresh headless instance. Scrollback is bounded by the
  ring; refused.md § Scrollback beyond the ring records the trade.
- The ring becomes a chunk list with a byte budget; readers concatenate on demand.
- Inactive terminal tabs stay mounted and hidden. `TabsLayout` already names this trade for file
  trees. A switch is a visibility toggle, and the xterm and its WebGL context survive.
- `term:out` moves to binary WebSocket frames, one encode per broadcast, on the node-to-helper hop and
  on the helper-to-renderer hop. `apps/desktop/src/shell/wire.ts` names this upgrade in its own
  header: an id-tagged binary frame beside the JSON reply.

Out: the agents plugin's terminal reads (it uses the ring and is unaffected). The terminal client's
third parse. The `$EDITOR` and Docker exec rectangles, which are PTYs like any other and inherit the
change.

## Design

**Emulation is a consequence of attachment.** `terminalDisplay.ts` gains `ensure()` and `release()`
called from `attach` and detach. `ensure()` on a session with no emulator creates one, replays the
ring into it, and only then starts feeding live bytes. `release()` on the last detach disposes it. A
session with a watcher pays what it pays today; a session without one pays nothing but the ring.

**The ring is chunks.** `terminal.ts` keeps `Buffer[]` with a running byte count and drops from the
head past the budget. `tail(bytes)` walks from the end. Readers see the same strings they see now.

**Hidden tabs keep their surfaces.** `TerminalPanel.tsx` renders every session's `TerminalSurface`
under `<For>` with a `hidden` attribute for the inactive ones, and `attachPty` stays attached. A
hidden xterm still receives `term:out` and stays current, so switching is a repaint. Memory cost is
one xterm per open tab, which is what a terminal emulator app spends and what the previous
implementation avoided for a round trip per switch.

**Binary frames carry an id.** The hub sends `term:out` as a binary frame whose first bytes are a
fixed-width session id, then the raw bytes. The broker forwards it to the helper's socket unchanged.
The renderer's bridge decodes the id and hands the bytes to the subscriber for that session without
`atob`. JSON frames are untouched.

## Code touched

- `plugins/terminal/src/server/terminalDisplay.ts`, `terminal.ts`.
- `packages/node-core/src/server/transport/wsHub.ts`, `packages/custody/src/broker/nodeBroker.ts`,
  `apps/desktop/src/helper/helperServer.ts`, `apps/desktop/src/shell/bridge.ts`, `wire.ts`.
- `packages/client-core/src/infra/node/wsClient.ts`: a binary dispatch path.
- `plugins/terminal/src/client/TerminalPanel.tsx`.
- `apps/tui/src/kit/pty.ts`, `apps/tui/src/platform.ts`: the terminal client receives the same
  binary frames in-process.

## Tests

- `terminalDisplay.test.ts`: a session with no attach has no emulator; the first attach replays the
  ring and matches a session that was emulating throughout, byte for byte on the visible screen; the
  last detach disposes.
- `terminal.test.ts`: the ring's `tail` matches the string implementation across chunk boundaries.
- `wsHub.test.ts`: a `term:out` is one binary frame per attached socket with the same bytes; the
  broker forwards it; the renderer subscriber receives the bytes.
- `TerminalPanel.test.tsx` (jsdom): switching tabs issues no `term:attach` and keeps the inactive
  surface's element.
- The desktop boot test and the TUI boot test.

## Docs owed

`docs/terminal.md`: the emulator lifecycle, the ring's shape, the binary frame, and hidden tabs.
`docs/shell.md` § The renderer bridge: the binary path beside the JSON one. `docs/tui.md`
§ Rectangles: the PTY rectangle receives bytes.

## Done when

- An unwatched session costs no parser time on the node loop (assert with the phase 0 histogram
  around `terminal.write`).
- A tab switch touches no network and keeps the xterm element.
- `term:out` volume on the helper hop drops by the base64 and JSON escaping overhead, measured on a
  session producing known bytes.

## Verify before building

- Re-run the grep that says `attach()` is the emulator's only consumer, and check `plugins/agents`
  has not grown a screen reader. Read at `17a9acdf`.
- Confirm `TerminalPanel.tsx` still mounts one tab with `keyed`.
- Confirm phase 5's `seq` accounting shipped; without it, the reconnect this phase relies on being
  rare is still common.
