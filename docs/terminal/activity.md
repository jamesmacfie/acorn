# Activity and delivery

This page covers how the terminal engine decides a session is idle or blocked, the frames those edges
send, how the Node slows a fast producer, and how other plugins send text into an agent's terminal.

## Activity and status

The engine reads status from PTY output instead of talking to the process. A running agent counts as
idle after `IDLE_MS`, 10 seconds, with no output. It watches for silence, not for transcript text, so
it works for any backend. A shell never counts as idle, because waiting for input matters only for an
agent.

A fresh agent session uses a 3-second first-idle window (`FIRST_IDLE_MS`). Launch context is queued
`after-ready` and sent on the session's first idle edge, and a booting CLI reaches its prompt in about
1 to 2 seconds, so the longer window would only delay the first prompt.

The terminal plugin reads `terminal:launch-context` contributions in order and applies one 256 KiB
budget across them. Memory contributes the task and memory block there. Claude Code's
`launchContextArgs` reads the contribution before spawn and passes it in `--append-system-prompt`.
Other profiles get the queued block ([context integration](../notes-and-memory.md#context-integration)).

A separate blocked status looks for a prompt the agent is waiting on. It scans the last 12 lines, with
ANSI codes and spinner frames stripped, for confirmation patterns such as `(y/n)`, `[y/n]`, "do you
want to proceed", and "press enter", or a trailing `?` on the last line only.

## Frames from these edges

Two frames come out of these edges, split by how often each fires:

- `terminal:sessions-changed` goes out on every edge, including working, which a build crosses
  repeatedly. Only the session roster hears it.
- `worktree:status-changed` goes out on the human edges: a command going quiet, a session exiting, a
  setup script finishing. That's when a `git commit` typed in a shell is done, so the Node drops its
  coalesced `git status` for that folder on the same edge
  ([worktree status reads](../workspaces-and-tasks/worktrees.md#worktree-status-reads)).

A declared run target adds `run:changed { taskId, targetId, running }`. The runtime keeps a reverse
index from session to target, so a PTY exit publishes `running: false` even when nobody pressed
**Stop**. Explicit stop removes the index entry first, which suppresses a duplicate frame. Arbitrary
processes and ports don't become events.

The run buttons in a task's pane switcher read the targets through the query cache, keyed
`['run-targets', taskId]` (`packages/client-core/src/infra/queries.ts`), with the shell's 30-second
stale time. `run:changed` refreshes that task's entry, and `project:changed` refreshes every entry,
because the project row carries the run targets.

## Backpressure

The Node's hub (`packages/node-core/src/server/transport/wsHub.ts`) holds one WebSocket per client and
stamps a per-connection `seq` on every frame. A gap means loss, and the broker's only remedy is to
reconnect, which reattaches every terminal and makes the Node serialize a framebuffer for each.

So the hub doesn't create gaps. When a socket has buffered more than 4 MiB (`MAX_BUFFERED_BYTES`), the
hub pauses the PTY behind the frame it's about to send, sends the frame, and resumes once the buffer
falls below half. `pause()` stops node-pty reading, the kernel pipe fills, and the writing program
blocks. No bytes are dropped. A session attached to two clients stays paused while either is behind,
and a socket that dies holding a pause releases it.

An invalidation ping has no producer to slow, so those are still shed. The hub replaces the first one
in a congested window with a `ws:shed` marker that takes its sequence number, and later sheds in that
window take none. The broker forwards the marker, and the renderer marks what's on screen stale and
refetches, as after a reconnect. Viewer admission errors bypass shedding.

## Sending text to an agent

`sendToAgent` is the one way to push text into an agent's PTY. Review notes, "add file/line to
agent", and the context assembler all use it. It wraps text as one bracketed-paste block, so a
multi-line prompt arrives as one paste. Three submit modes control what happens next:

- `now` submits (`\r`) after a short delay, whatever the session's state.
- `after-ready` submits at once if the session is idle, and otherwise queues the block for the next
  busy-to-idle edge.
- `draft` pastes only, and you press Enter yourself.

Other plugins reach it through the `terminal.sendToAgent` capability
([collaboration rules](../plugins.md)), not by importing the engine.
