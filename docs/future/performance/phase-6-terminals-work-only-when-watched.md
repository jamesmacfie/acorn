# Phase 6: terminals do work only when watched

Status: **shipped 2026-09-03**, whole. The emulator is built by the first attach and disposed by the
last detach, the ring is a chunk list with a byte budget, every open terminal tab keeps its surface with
the inactive ones hidden, and `term:out` is a binary frame on the node-to-helper and helper-to-renderer
hops. Phase 5's `seq` accounting had shipped, so the reconnect this phase relies on being rare is rare.
The `Done when` line about the phase 0 histogram was answered the other way the phase file allows: the
parser is counted at the seam in a test rather than sampled through `ACORN_PERF=1`, because phase 0's
histograms are on the git and SQLite seams in node-core and `terminal.write` is inside a plugin. Numbers
in [measurements.md](./measurements.md) § 2026-09-03 — phase 6.

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

## What the checks turned up

All three held, with one thing worth writing down.

- **`attach()` is still the emulator's only consumer.** `TerminalDisplay` is named by `terminal.ts` and
  by its own test and nowhere else, and `screen.snapshot()` is reached from `attach` alone.
- **`plugins/agents` has not grown a screen reader**, but it does run `@xterm/headless` of its own.
  `plugins/agents/src/server/usage/processRunner.ts` builds one over a throwaway pseudo-terminal to read
  a provider's usage screen. That is its own emulator over its own process, not a reader of a terminal
  session's display, so this phase does not touch it and the claim stands as written.
- **`TerminalPanel.tsx` still mounted one tab with `keyed`**, on `activeId()`.

Two decisions the phase file left open:

- **`<For>` over the session ids, not over the session rows and not `<Index>`.** The Design section says
  "`<For>` with a `hidden` attribute", and `<For>` is right — but only over the ids. The roster is
  replaced wholesale by every `refreshSessions`, so `<For>` over the rows compares new objects and
  rebuilds every surface, which is the opposite of the phase's point; `<Index>` keys by position, so
  closing the first tab would hand the second session to the first tab's live xterm. An id is a string,
  which `<For>` compares by value, so a refresh that changed nothing keeps every element.
  `TerminalPanel.test.tsx` fails under either alternative.
- **A surface builds its xterm on the first frame it is shown on, rather than when it mounts.** xterm
  measures its cell size from a laid-out box and a `display: none` box has none, so mounting every tab's
  xterm at once would have measured them all at zero. Deferring also means a tab nobody opens costs
  nothing. After the first showing the xterm is kept, which is the whole phase.

Out of scope and left alone as the file says: the agents plugin's ring reads and the terminal client's
third parse into `EmbeddedTerminalRenderable`.

One line in the Scope is wrong and is worth correcting rather than quietly satisfying. **The `$EDITOR`
and Docker exec rectangles do not "inherit the change".** They are not sessions in the terminal engine:
each is a throwaway pseudo-terminal on its own plugin-owned channel (`editor:pty`, `docker:exec`), with
no `TerminalDisplay`, no ring, and no `term:out` frame. So they never paid the cost this phase removes
and they do not get the binary frame either — their output is still JSON on their own channel. Nothing
regresses for them, and a later phase that wants their bytes on the binary frame has the format to
reuse. What they do inherit is `hidden` on the kit's rectangle, which neither passes.
