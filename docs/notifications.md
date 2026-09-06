# Notifications

One reading of what an agent is doing, three changes worth interrupting somebody for, and one gate
that decides what each change does. Sound, a system notification, the number on the app icon, and
the terminal's own escape sequences all hang off that gate, and a Settings page switches each.

This document owns the model. [plugin-map.md](./plugin-map.md) § Notifications owns the decision a
plugin author makes, which call to reach for. [shell.md](./shell.md) § The renderer bridge owns the
desktop half of the `notify` seam group and [tui.md](./tui.md) § What is drawn bespoke owns the
terminal client's chrome.

## A notice is not an attention item

The top bar's bell draws two kinds of row, and the difference decides where a thing belongs.

A **notice** is an event that already happened: a run finished, a build failed, an agent asked a
question. It is client-local, it carries a `read` flag, and it is gone once the 50-row ring rolls
over it. `packages/client-core/src/features/notifications/notifications.ts` is the ring.

An **attention item** is a state that lasts until something changes on the node. A pending approval
is still pending after you dismiss it, so it comes back on the next fetch. That is why items are
fetched per node rather than pushed, why they carry no `read` flag, and why a plugin contributes
them through `ctx.attentionSources`
(`packages/client-core/src/host/registries/rail/attention.ts`,
[contribution-kinds.md](./contribution-kinds.md)). The bell's "Needs you" section is those rows,
merged across every node.

Both come from the same reading of a session.

## Five states

`packages/client-core/src/features/notifications/attention.ts` collapses every agent session,
managed or PTY, onto one of five states:

| State | Meaning |
| --- | --- |
| `working` | The agent is doing something, or has produced output nobody has asked about. |
| `blocked` | The agent is waiting on the owner: a permission, a question, a workflow gate. |
| `finished` | The turn ended and the owner has not spoken again. |
| `error` | The session failed or the process exited non-zero. |
| `idle` | Nothing is running and there is nothing to report. |

A snapshot is `{ nodeId, sessionId, taskId, title, state, kind }`, where `kind` is `interactive`,
`workflow`, `imported`, or `pty`. The key is node plus session, because session ids are node-minted
and two nodes may hold the same one.

**The managed adapter** reads `AgentSession` rows as `agent:session` frames upsert them
(`plugins/agents/src/client/sessions/managedStore.ts`). Attention wins over runtime state: the node
sets `attention` from the driver's own events, and a session asking for a permission is blocked
whatever its process is doing ([managed-agents.md](./managed-agents.md) owns that projection).

| `attention` | `runtimeState` | State |
| --- | --- | --- |
| `permission`, `question`, `workflow_gate` | any | `blocked` |
| `completed` | any | `finished` |
| `error` | any | `error` |
| `none`, `unread` | `working`, `waiting`, `cancelling`, `reconnecting`, `connecting`, `replaying`, `creating` | `working` |
| `none`, `unread` | `ready`, `stopped`, `archived` | `idle` |
| `none`, `unread` | `failed` | `error` |

**The PTY adapter** reads `TerminalSession` snapshots as `refreshSessions` produces them
(`packages/client-core/src/features/tasks/agentSessions.ts`), for sessions with `kind: 'agent'`
only. A plain shell exiting is not an agent needing you.

| `status` | `agentState` | `idle` | `exitCode` | State |
| --- | --- | --- | --- | --- |
| `running` | `blocked`, `permission` | any | | `blocked` |
| `running` | anything else | `false` | | `working` |
| `running` | anything else | `true` | | `finished` |
| `exited` | | | `0` or null | `idle` |
| `exited` | | | non-zero | `error` |

## Three edges

An edge is a pair of consecutive snapshots for one session. Three of the 25 pairs are news:

| Edge | Notice kind | Title |
| --- | --- | --- |
| anything to `blocked` | `agent-needs-input` | "<title> needs you" |
| `working` to `finished` | `agent-completed` | "<title> finished" |
| anything to `error` | `agent-error` | "<title> failed" |

Everything else is silence. `blocked` to `working` means you answered, `finished` to `working` means
you spoke, and a first snapshot with no predecessor describes a session that was already in that
state before the app opened.

`working` to `finished` is news only when `kind` is `interactive` or `pty`. A workflow or automation
turn is one step of a run, and the workflows plugin sends `run-done` for the run
([workflows.md](./workflows.md)). Ten steps used to mean ten "finished" rows.

The three kinds carry their glyphs and severities in
`packages/client-core/src/features/notifications/kindContributions.ts`. There are no PTY-only kinds:
a terminal agent and a managed agent read the same way in the bell.

## The gate

`packages/client-core/src/features/notifications/deliver.ts` holds it. Each adapter calls
`observeAttention(snapshots)` with what it has; the gate folds them into one map, raises the edges,
and keeps the result for the re-check below. `deliver(edge, context)` then decides, where the context
is focus, the active task, the settings, and the clock.

**Hold.** An edge waits `HOLD_MS`, one second, and is checked against the latest snapshot before
anything fires. A session that has moved to a different state in that second drops its edge. This is
what swallows a permission that policy auto-answers and a turn that a queued message immediately
follows. A newer edge for the same session replaces a held one, so there is at most one in flight per
session.

**Seen.** An edge is seen when the window is focused and the edge's task is the active task, asked
at the moment the hold releases rather than when the edge arrived. Coming back to the window during
that second counts as watching. Focus is `document.hasFocus()` on the desktop; a host that is not a
document installs its own answer through `setHostFocused`, and unknown counts as focused, which is
the quiet answer.

A seen edge lands in the bell as a notice with `read: true`. The history stays complete and the pill
does not move. It fires no sound, no system notification, no terminal notification, and changes no
badge. An unseen edge lands unread and wakes every channel its settings allow.

Channels beyond the bell row are sinks, registered with `registerNoticeSink`. A sink only ever sees
an unseen notice, so no channel repeats the seen rule.

`deliverNotice` is the half of the gate without the hold: the seen rule and the channels, for a
notice with no session behind it. `pushManagedAgentNotice` and `initWorkflowNotices` both go through
it, so a run that finishes on the task you are watching is quiet for the same reason an agent turn is.

## Acknowledging an attention row

A finished turn is a state the node keeps until the owner speaks again, so it sits in "Needs you"
long after they have read it. So does a memory proposal nobody has reviewed. Looking at the session,
in a focused window, retires it, and so does "Mark all read" in the bell.

`packages/client-core/src/features/notifications/attentionInbox.ts` holds a session-only set keyed by
node id and the row's own id. A row whose key is in the set is hidden from the inbox and from the pill.

The key does not carry the row's `at`, and that is the whole of a bug worth remembering. A timestamped
key looked like it bought re-arming, so that a session completing a second time was news again. For the
source that raises almost every row it bought the opposite: `at` there is the session's `updatedAt`, and
the node bumps that on every event it records, including the usage report that lands after the turn
ended and the controller change a reconnect writes. The key moved when nothing had happened, the ack
stopped matching, and every row the owner had just cleared came back with the next frame — so the bell's
number climbed back past where it started. A session that completes again now keeps its cleared row
hidden, and the completion still raises its own unread notice through the gate, so the pill still moves.

Only a nudge can be retired this way, and `severity` is the word for it: `info` means nothing is
blocked. A permission, a question, a workflow gate, or an error is `warn` or `danger`, and describes a
block that reading about it does not lift — those stay in "Needs you", and in the pill, until the
owner lifts them. The set clears on a node switch, like every other node-scoped signal
([state-ownership.md](./state-ownership.md) § Scope rules).

"Mark all read" is therefore about the whole number the bell shows, not just its lower section: it
marks every notice read and acknowledges every nudge on show. It cannot empty a bell that is holding
a real block, which is the point of the block.

## The channels

| Channel | Fires when |
| --- | --- |
| Bell row | Always. Read if seen. |
| Sound | Not seen, and `sound` is on. |
| System notification | Not seen, and `system` is on, and the host has a `notify` seam or the page fallback. |
| Badge | Whenever the pill changes, if `badge` is on and the host can draw one. |
| Terminal notification | The terminal client's spelling of the last two: an escape sequence, and BEL for the sound. |

**Sound.** `packages/client-core/src/features/notifications/chime.ts` synthesises two chimes from
sine notes and a gain envelope. No audio file ships, which leaves no format, player, or bundling
question, and lets a test assert a chime without an `AudioContext`. `attention` rises a fourth, E5 to
A5, for `blocked` and `error`; `done` falls the same fourth back, for `finished`. Both land inside
320 ms at a gain of 0.1 to 0.12, so a burst of edges reads as separate chimes rather than a chord.
Two tones and not three: `blocked` and `error` both mean "come here", and a third is something to
learn for a distinction the title already draws. `initSoundNotices` registers the sink and resumes a
suspended audio context on the first click or keypress.

**System notification and badge.** Both go through the platform seam's `notify` group,
`showNotification`, `onNoticeActivated`, `canSetBadge`, and `setBadge` in
`packages/client-core/src/infra/platform/index.ts`. A page has `Notification`, so the seam carries
its own fallback: it asks permission once, shows a silent banner tagged with the notice id, and holds
the object until it closes so the click handler survives collection. Its `canSetBadge` answers false
and Settings hides the app-icon row. A shell that installs the group takes the banner over and gains
the badge. For the desktop half, the two Tauri commands and the focus approximation that stands in
for a click callback, see [shell.md](./shell.md) § The renderer bridge.

The banner's body is the notice's `detail` and nothing else. A title is already free of prompt text,
responses, filenames, and paths (`pushManagedAgentNotice`), and the notification centre keeps what it
is shown. An OS banner is the one surface where "what happened" must not become "what it said".

The badge is the pill: `packages/client-core/src/features/notifications/badge.ts` puts
`unreadCount()` plus the attention rows on the icon, the same accessor the bell draws. One number
with one meaning, on the dock and in the terminal client's topbar alike.

**Terminal.** `apps/tui/src/kit/notify.ts` writes an escape sequence and lets the emulator decide
what a notification is. OSC 9 for iTerm2, Ghostty, WezTerm, and Warp; OSC 99 for kitty; OSC 777 for
rxvt; wrapped in a tmux DCS passthrough with every ESC doubled when `TMUX` is set. Title and body are
stripped of anything that could end the sequence early. A terminal on none of those lists gets the
BEL from `apps/tui/src/kit/bell.ts` and nothing else. Whether the terminal is the window the reader
is looking at comes from DEC 1004, which the input parser reports as `focus` and `blur` events;
`apps/tui/src/main.tsx` feeds them to `setHostFocused`.

## Settings

One JSON device preference under `PrefKeys.notifications`, listed in `DEVICE_KEYS`
(`packages/client-core/src/infra/persistence/prefKeys.ts`,
`packages/client-core/src/infra/persistence/devicePrefs.ts`):

```json
{
  "sound": true,
  "system": true,
  "badge": true,
  "events": { "blocked": true, "finished": true, "error": true }
}
```

One key holding six booleans rather than six keys, because a value that is read together is stored
together. Every field that is missing, or is not a boolean, reads as `true`, so a fresh install and a
blob written by an older build both behave as the design intends. Only an explicit `false` turns a
channel off.

The three event switches turn an edge off entirely, row included. Off means the owner does not want
to hear about it, and a row that lands silently but still counts in the pill is hearing about it.

Settings shows five checkboxes, plus the app-icon row where `canSetBadge()` is true, and a
**Send a test notification** button that runs a synthetic unseen edge through `deliverNotice`
(`packages/client-core/src/features/settings/NotificationSettings.tsx`). The button is also where the
browser asks for notification permission.

The gate reads `localStorage` directly rather than the prefs query. It is a plain module with no
component around it and no query client to hand, and this key never reaches a node. The Settings page
reads through the query, because it wants the reactivity.

The terminal client has no device preference store, so the environment is the switch:
`ACORN_TUI_NOTIFY` takes `off`, `bell`, `terminal`, or `both`, and defaults to `both`, the same shape
as `ACORN_TUI_OSC52`. Its badge is always on: there is nothing to switch, and the count is in your
own topbar rather than interrupting you. See [tui.md](./tui.md) § Doors left open for the file-backed
store that would let the Settings page work there.

## The invariants

`packages/client-core/src/features/notifications/invariants.test.ts` holds these as properties over
generated sequences, so an adapter or sink added later cannot break one quietly. Each part of the
model also has its own tests with worked examples.

1. **Standing still is not news.** Two consecutive snapshots with the same state produce nothing.
2. **A first sighting is not news.** A snapshot with no predecessor produces nothing.
3. **Three edges only.** Over every pair of the five states, exactly the transitions into `blocked`,
   into `error`, and `working` to `finished` produce a notice.
4. **Seen means quiet.** Focused, on the edge's own task, implies `read: true` and no channel.
5. **A held edge that changes is dropped.** A snapshot arriving inside the hold with a different
   state cancels the held edge.
6. **The badge is the pill.** The number on the icon is the number in the bell, or there is no badge
   because the host cannot draw one.
7. **Off means off.** A disabled event produces no row and no channel.
8. **Both adapters, one vocabulary.** A managed `permission` and a PTY `blocked` produce a notice of
   the same kind, with the same glyph and severity.
