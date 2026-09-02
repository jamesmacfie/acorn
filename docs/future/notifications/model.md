# The model: state in, edges out, one gate

The target, 2026-09-02. Every phase points here. Where a phase disagrees with this file, fix one of
them in the same commit and say why.

## Five states

Every agent session, managed or PTY, collapses to one of five states on the client:

| State | Meaning |
| --- | --- |
| `working` | The agent is doing something, or has produced output nobody has asked about. |
| `blocked` | The agent is waiting on the owner: a permission, a question, a workflow gate. |
| `finished` | The turn ended and the owner has not yet spoken again. |
| `error` | The session failed or the process exited non-zero. |
| `idle` | Nothing is running and there is nothing to report. A session at rest, or exited cleanly. |

A snapshot is `{ nodeId, sessionId, taskId, title, state, kind }` where `kind` is `interactive`,
`workflow`, `imported`, or `pty`.

### The managed adapter

Reads `AgentSession` rows as `agent:session` frames upsert them (`plugins/agents/src/client/sessions/managedStore.ts`):

| `attention` | `runtimeState` | state |
| --- | --- | --- |
| `permission`, `question`, `workflow_gate` | any | `blocked` |
| `completed` | any | `finished` |
| `error` | any | `error` |
| `none`, `unread` | `working`, `waiting`, `cancelling`, `reconnecting`, `connecting`, `replaying`, `creating` | `working` |
| `none`, `unread` | `ready`, `stopped`, `archived` | `idle` |
| any | `failed` | `error` |

`kind` is the row's `kind`.

### The PTY adapter

Reads `TerminalSession` snapshots as `refreshSessions` produces them
(`packages/client-core/src/features/tasks/agentSessions.ts`), for sessions with `kind: 'agent'`:

| `status` | `agentState` | `idle` | `exitCode` | state |
| --- | --- | --- | --- | --- |
| `running` | `blocked`, `permission` | any | | `blocked` |
| `running` | anything else | `false` | | `working` |
| `running` | anything else | `true` | | `finished` |
| `exited` | | | `0` or null | `idle` |
| `exited` | | | non-zero | `error` |

`kind` is `pty`.

## Three edges

An edge is a pair of consecutive snapshots for one session. Three edges are news:

| Edge | Notice kind | Title |
| --- | --- | --- |
| anything → `blocked` | `agent-needs-input` | "<title> needs you" |
| `working` → `finished` | `agent-completed` | "<title> finished" |
| anything → `error` | `agent-error` | "<title> failed" |

Everything else is not news: `blocked → working` (you answered), `finished → working` (you spoke),
`finished → idle`, `working → idle` on a clean exit, and a first snapshot with no predecessor.

`working → finished` is news only when `kind` is `interactive` or `pty`. A workflow or automation
turn is one step of a run, and the workflows plugin sends `run-done` for the run.

The three existing kinds keep their glyphs and severities in
`packages/client-core/src/features/notifications/kindContributions.ts`. The PTY kinds `finished`,
`needs-input`, and `exited` are retired, so a PTY agent and a managed agent read the same way in the
bell.

## The gate

One function decides what an edge does: `deliver(edge, context)`, where context is
`{ focused, activeTaskId, settings, now }`.

**Hold.** An edge is held for `HOLD_MS = 1000` and re-validated against the latest snapshot before
anything fires. If the session has moved to a different state in that second, the edge is dropped.
This is herdr's `delay_seconds` and it swallows a permission that policy auto-answers and a finished
that a queued turn immediately follows.

**Coalesce.** A newer edge for the same session replaces a held one. At most one held edge per
session.

**Seen.** An edge is seen when the window is focused and the edge's task is the active task. Focus
is `document.hasFocus()` on the desktop and the terminal's DEC 1004 report through OpenTUI's
`FOCUS` and `BLUR` events on the terminal client, with unknown counting as focused. A seen edge:

- lands in the bell as a notice with `read: true`, so the history is complete and the pill does not
  move;
- fires no sound, no system notification, no terminal notification, and changes no badge.

An unseen edge lands unread and fires every channel its setting enables.

**Channels.** The setting is a device preference (below). The matrix:

| Channel | Fires when |
| --- | --- |
| Bell row | Always. Read if seen. |
| Sound | Not seen, and `sound` on. Two tones: one for `blocked` and `error`, one for `finished`. |
| System notification | Not seen, and `system` on, and the host has a `notify` seam or a web fallback. Click focuses the window and opens the notice target. |
| Badge | Whenever the pill changes, if `badge` on and the host has `setBadge`. The number is the pill's number. |
| Terminal notification | The terminal client's spelling of "system notification": OSC 9, 99, or 777 to the host terminal, and BEL as the terminal client's spelling of "sound". |

Per-event toggles `events.blocked`, `events.finished`, and `events.error` switch each edge off
entirely: no row, no channel. Off means the user does not want to hear about it, and a silent row
that still counts would contradict that.

## Acknowledge on view

The "Needs you" section is state fetched from the node, and `completed` is a state the node keeps
until the next `user_message`. The client records that a `completed` row was viewed: a session-only
set keyed by `nodeId`, `sessionId`, and the row's `updatedAt`, written when the session is on screen
in a focused window. A `completed` row whose key is in the set is hidden from the inbox and the pill.
`permission`, `question`, `workflow_gate`, and `error` rows are never hidden: they describe a block
that only the owner can lift. The set clears on a node switch like every other node-scoped signal
(`docs/state-ownership.md` § Scope rules).

This is gouda's rule in the smallest form that fits: the key includes `updatedAt`, so a session that
completes again after you looked shows up again.

## Settings

One JSON device preference under `PrefKeys.notifications`, key `notifications`, listed in
`DEVICE_KEYS`:

```json
{
  "sound": true,
  "system": true,
  "badge": true,
  "events": { "blocked": true, "finished": true, "error": true }
}
```

Every field defaults to `true` when absent, so an install with no preference behaves as the design
intends and a partial blob from an older build reads as intended too. Settings → Notifications draws
six checkboxes and a **Send a test notification** button that runs a synthetic unseen `blocked` edge
through the gate, which is also where the system notification permission gets asked for.

The terminal client has no store for a device preference (analysis finding 14) and no settings
surface. It reads `ACORN_TUI_NOTIFY` with values `off`, `bell`, `terminal`, or `both`, default
`both`, the same shape as `ACORN_TUI_OSC52`.

## A worked example

You have task A open with a managed Claude session in its agents pane. The window is focused.

1. Claude asks to run a command. The row's `attention` becomes `permission`. Edge: `working →
   blocked`. Held one second, still blocked. Seen, because the window is focused and A is active. A
   read row "claude needs you" lands in the bell. Nothing sounds. The pill stays at 0. The "Needs
   you" section shows the permission row, as it does today.
2. You approve. `attention` becomes `none`. Edge: `blocked → working`. Not news.
3. You switch to task B. Claude asks again. Edge: `working → blocked`. Not seen. The row lands
   unread, the blocked tone plays, a system notification says "claude needs you", the badge shows 1.
4. You click the system notification. The window focuses, task A activates, `markTaskRead` marks
   the row read, the pill and badge read the attention row only, which is 1 until you answer.
5. You answer and switch back to B. Claude finishes. Edge: `working → finished`. Not seen. Unread
   row, finished tone, system notification, badge 2 (one notice, one `completed` attention row).
6. You open A. The notice is marked read, and the `completed` row's key enters the seen set. Pill 0,
   badge 0. The node's `attention` is still `completed`, and that is fine: the next fetch still
   returns the row and the client still hides it.
7. You send another message. `attention` becomes `none`, the row leaves the fetch, and the seen set
   entry is dead weight until the node switch clears it.

## Invariants

Each of these is a test in phase 6, and phases 1 to 5 each hold the ones they touch.

1. **Same state, no edge.** Two consecutive snapshots with the same state produce nothing.
2. **First sight is not news.** A snapshot with no predecessor produces nothing.
3. **Three edges only.** Over every pair of the five states, exactly the transitions into `blocked`,
   into `error`, and `working → finished` produce a notice.
4. **Seen means quiet.** For any edge, focused and active-task implies `read: true` and no channel.
5. **A held edge that changes is dropped.** A snapshot arriving inside the hold with a different
   state cancels the held edge.
6. **The badge is the pill.** At every point the badge number equals the bell's pill number, or the
   badge is absent because the host cannot draw one.
7. **Off means off.** A disabled event produces no row and no channel.
8. **Both adapters, one vocabulary.** A managed `permission` and a PTY `blocked` produce a notice of
   the same kind with the same glyph and severity.
