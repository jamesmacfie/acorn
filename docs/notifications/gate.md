# The notification gate

This page covers the gate that decides what each edge does, how an attention row is acknowledged,
and the properties the tests hold. It's part of [notifications](../notifications.md).

## The gate

`packages/client-core/src/features/notifications/deliver.ts` holds the gate. Each adapter calls
`observeAttention(snapshots)` with what it has. The gate folds the snapshots into one map, raises the
edges, and keeps the result for the hold. `deliver(edge, context)` then decides, where the context
is focus, the active task, the settings, and the clock.

**Hold.** An edge waits `HOLD_MS`, one second. Before anything fires, the gate checks it against the
latest snapshot, and a session that moved to a different state in that second drops its edge. The
hold swallows a permission that policy answers on its own and a turn that a queued message follows
at once. A newer edge for the same session replaces a held one, so each session has at most one edge
in flight.

**Seen.** An edge is seen when the window is focused and the edge's task is the active task. The gate
asks when the hold releases, not when the edge arrived, so coming back to the window during that
second counts as watching. On the desktop, focus is `document.hasFocus()`. A host that isn't a
document installs its own answer through `setHostFocused`. An unknown answer counts as focused,
which is the quiet answer.

A seen edge lands in the bell as a notice with `read: true`. The history stays complete and the pill
doesn't move. It plays no sound, shows no system or terminal notification, and leaves the badge
alone. An unseen edge lands unread and wakes every channel its settings allow.

Channels other than the bell row are sinks, registered with `registerNoticeSink`. A sink only sees
unseen notices, so no channel repeats the seen rule.

`deliverNotice` is the gate without the hold: the seen rule and the channels, for a notice with no
session behind it. `pushManagedAgentNotice` and `initWorkflowNotices` both go through it, so a run
that finishes on the task you're watching stays quiet for the same reason an agent turn does.

## Acknowledging an attention row

A finished turn is a state the Node keeps until the owner speaks again, so it sits in "Needs you"
long after the owner read it. So does a memory proposal nobody has reviewed. Looking at the session
in a focused window retires the row, and so does **Mark all read** in the bell. Looking means the
agent pane is drawn, not that its task is the active one, because the active task stays set behind
Home and the pane's model outlives the pane ([pane models](../panes/models.md) § Pane models).

`packages/client-core/src/features/notifications/attentionInbox.ts` holds a session-only set keyed
by Node ID and the row's ID. A row whose key is in the set is hidden from the inbox and the pill.

The key doesn't include the row's `at` timestamp. For the source that raises most rows, `at` is the
session's `updatedAt`, and the Node bumps that on every event it records, such as a usage report
after the turn ends or a controller change on reconnect. A key with `at` in it changed when nothing
had happened, and every row the owner had cleared came back with the next frame. A session that
completes again keeps its cleared row hidden, and the completion still raises its own unread notice
through the gate, so the pill still moves.

Only a nudge can be retired this way, and `severity` marks it: `info` means nothing is blocked. A
permission, a question, a workflow gate, or an error is `warn` or `danger`. Reading about a block
doesn't lift it, so those rows stay in "Needs you", and in the pill, until the owner acts. The set
clears on a Node switch, like every other Node-scoped signal
([state ownership](../state-ownership.md) § Scope rules).

**Mark all read** applies to the whole number the bell shows. It marks every notice read and
acknowledges every nudge on show. It can't empty a bell that holds a real block.

## Invariants

`packages/client-core/src/features/notifications/invariants.test.ts` checks these as properties over
generated sequences, so a future adapter or sink can't break one without a failing test. Each part
of the model also has its own tests with worked examples.

1. **Standing still isn't news.** Two consecutive snapshots with the same state produce nothing.
2. **A first sighting isn't news.** A snapshot with no predecessor produces nothing.
3. **Three edges only.** Over every pair of the five states, only the transitions into `blocked`,
   into `error`, and from `working` to `finished` produce a notice.
4. **Seen means quiet.** Focused, on the edge's own task, means `read: true` and no channel.
5. **A held edge that changes is dropped.** A snapshot with a different state inside the hold
   cancels the held edge.
6. **The badge is the pill.** The number on the icon is the number in the bell, or there's no badge
   because the host can't draw one.
7. **Off means off.** A disabled event produces no row and no channel.
8. **Both adapters, one vocabulary.** A managed `permission` and a terminal `blocked` produce a
   notice of the same kind, with the same glyph and severity.
