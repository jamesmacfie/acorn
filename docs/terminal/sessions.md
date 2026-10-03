# Terminal sessions

This page covers how the Node stores, attaches, and retires terminal sessions, what the screen costs,
and how setup and teardown report through a session. The engine is
`plugins/terminal/src/server/terminal.ts`.

## Sessions

Session metadata is stored in `plugins/terminal.sqlite`. PTY output and screen state are runtime data.
A session is an ephemeral PTY or a durable tmux session. The Node reconciles tmux at startup, keeps a
bounded replay tail, and serves attach, detach, input, resize, and kill over the authenticated
`/v1/events` socket and the terminal routes.

Reattach sends the reset and framebuffer, then output buffered during serialization, then live output.
Raw output isn't replayed as screen history. A lost stream doesn't mean the process died.

A `term:attach` frame can carry the viewer's `cols` and `rows`. The Node resizes the PTY and screen
before it takes the snapshot, so a surface attaches in one message. A frame without them attaches at
the session's last size. The drawer compares the size in `ready` with its own and resizes when they
differ.

An opted-in logical viewer owns its own sink. A viewer that joins after another gets its own restore
without resetting the first, and detaching one leaves the others live. The socket's last viewer
releases its holds. Older clients keep single-viewer attachment
([logical event viewers](../api-reference.md#logical-event-viewers)).

The terminal plugin owns the `term:<sessionId>` subscription hint. A size change updates the saved
size through one attach control frame before the HTTP resize. Equal sizes send nothing. So broker
replay and reconnect both use the latest size, with one fresh snapshot after a reconnect.

The Node batches PTY output into one `output` frame about every 16 ms, not one per PTY chunk.

## Lifecycle

An agent PTY exit emits `plugin:terminal:completed` with the task and session IDs, exit code, and time.
The engine publishes each creation and removal at its roster boundary, once per batch for a task drop
or reconciliation. If a durable delete fails after the roster changed, clients still get the roster
event and the caller gets the failure.

A session owns its PTY listeners, output timer, delayed submit timers, and teardown waiters.
Retirement releases each one even if another fails. Node shutdown closes the tmux attachment process
and keeps the detached tmux session and its row for reconciliation. It ends an ephemeral PTY. Explicit
kill or removal destroys the tmux session. Delayed creation and reconciliation stay bound to their
boot. A session waiting on its durable insert is hidden from rosters. A failed tmux admission rolls
back only after the database confirms no row, and otherwise keeps the tmux session and logs it.

Teardown resolves on exit, removal, engine disposal, or its deadline. Removal and disposal return a
null exit code. At the deadline, teardown stops the process and keeps an exited row with a null exit
code and its bounded output tail.

## The screen, and who pays for it

The Node runs a terminal emulator only while an attach is restoring a screen. PTY output is a stream
of cursor operations, not a screen you can replay from an offset, so an attach builds an
`@xterm/headless` framebuffer with 1,000 lines of scrollback (`terminalDisplay.ts`), replays the raw
ring into it, and serializes it. Once no attach is waiting, the emulator goes. An attached client has
every byte in its own emulator. So a session costs the Node its ring and nothing more.

Running the parser for every session cost 45 to 120 ms of Node CPU per megabyte of a build's output,
against 1 to 2 ms to keep the ring. The desktop keeps every open tab attached, so a parser per attached
session would have run for every tab.

The price is scrollback. An attach rebuilds from what the ring holds, so history older than 256 KiB is
gone, and an alternate-screen program that depends on older bytes redraws from its next output. If a
kind of session needs full history, give it a bigger ring. A rebuild from a full ring takes 15 to
25 ms, paid once per tab and again after a reconnect.

The ring (`RING_CAP` in `terminalUtils.ts`) keeps the last 256 KiB in at most 64 lazily allocated
4 KiB blocks. Small PTY callbacks share blocks, and an oversized callback copies its suffix in. A
reader joins the bytes before one UTF-8 decode, so a byte limit can cut the first character.

## Binary output frames

`term:out` is the one channel on the authenticated socket that isn't JSON. A frame is a fixed-width
session ID and then the PTY's bytes, as the comment in `packages/protocol/src/transport/ws.ts`
describes. It's built once per broadcast and
forwarded through the desktop broker unread. An ID that doesn't fit falls back to JSON. A binary frame
carries no `seq`. `ready`, `exit`, and `error` stay JSON. On an opted-in socket, the hub wraps the frame
with a 36-byte viewer UUID, which the broker strips before the helper adds its Node UUID header.

The client-core socket filters by Node and dispatches envelopes. The terminal plugin registers the
`term:out` and binary handlers, and owns attach, detach, and input for the active Node. Its session
store registers a summary source that the send picker, task rail, and quit prompt read.

## Session state vocabulary

Every session, terminal or managed, reports state from `AgentState` in
`packages/protocol/src/agents/sessionActivity.ts`: `starting`, `working`, `waiting`, `idle`, and
`blocked`. A transport reports the subset it can detect. A plain PTY emits `working`, `idle`,
`blocked`, or `unknown`. A managed driver reports the full set.

## Task script evidence

Setup and teardown run as ordinary task terminal sessions, and their lifecycle comes from core's
task script service ([task script results](../workspaces-and-tasks/task-scripts.md)). The terminal
plugin reports process start, output, confirmed exit, spawn failure, removal, shutdown, and teardown
timeout through `CoreServices.taskScripts`. Callbacks capture the attempt before session admission
finishes, so an immediate exit isn't lost. Core fences late callbacks by attempt and generation. The
plugin doesn't write core's table, and loaded plugins don't get this facet.

Explicit removal interrupts an active attempt before cleanup. A teardown timeout fails with reason
`timeout`, and an attachment exit with no command evidence is interrupted. Archive can delete the
session while core keeps its output tail.
