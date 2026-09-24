# Steady state

Date: 2026-09-24. Status: proposal. Read from source, not timed. [Back to the plan](./README.md).

Work the app does while you are not doing anything, and while an agent streams. This is what makes a
click feel slow on a busy afternoon even when every individual path is fast. An agent session
streams about 25 events a second, because the node coalesces text deltas at 40 ms
(`plugins/agents/src/server/sessions/durableEventBuffer.ts`), and a person often has two or three
running.

## S1: Stop every rail row rescanning the agent roster per event

**What was found.** `record()` in `plugins/agents/src/server/sessions/runtimeEngine.ts` sends an
`agent:event` frame and then an `agent:session` frame with the session row, for every event it
records. On the client, `upsertSession` in `plugins/agents/src/client/sessions/managedStore.ts`
replaces the row in the roster array and sorts the whole array again, which gives a new array. Every
reader of `managedAgentStore.sessions()` then runs again.

One of those readers is the agent rail marker (`plugins/agents/src/client/railMarkerContribution.ts`).
It runs inside every task row's render and filters the whole roster twice per row:

```ts
const forTask = (taskId, predicate) =>
  managedAgentStore.sessions().filter((session) => session.taskId === taskId && predicate(session)).length
```

So one streaming session costs rows times sessions times two comparisons, about 25 times a second,
plus a marker allocation pass per row. With 30 tasks and 100 sessions in the roster that is about
150,000 comparisons a second, and every row's marker list is rebuilt. Other readers pay per event
too: `AgentConversation.tsx` finds its row with `sessions().find(...)`, and `AgentCenter.tsx` filters
the roster.

**Change.** Two parts:

1. In the store, keep a memo from task id to that task's sessions, and have the rail marker read it.
   A row whose task's sessions did not change then gets the same array back and does no work.
2. In `upsertSession`, skip the sort when the row's position does not change, which is almost always,
   because `byRecent` sorts on `updatedAt` and the streaming session is already first. Better still,
   compare the incoming row with the held one and skip the write entirely when nothing a reader uses
   has changed.

Check with the node owner whether a session row really needs to be sent after every event. If the
client only needs the row when a field it reads changes, sending it only then removes most of the
traffic at the source. The rebroadcast is also how list-visible columns such as the queued-turn count
reach the client, so any filter on the node has to keep sending the row when one of those changes.

**Done when.** While one session streams, rail rows for other tasks do not re-evaluate their markers,
counted in a `hosts` test with a streaming fixture.

## S2: Keep a session's stream from waking unrelated readers

**What was found.** `snapshots` in `managedStore.ts` is one signal holding every session's snapshot.
`appendEvent` writes a new top-level record for every event. Readers that memo their own session,
such as `AgentConversation.tsx`, stop the change there. Readers that do not are woken by every event
of every session. `AgentTaskSidebar.tsx` reads `managedAgentStore.snapshots()[session.id]?.requests`
inside a render.

**Change.** Audit every read of `snapshots()` and put each behind a memo keyed on its own session.
If there are many, change the store to one signal per session, which removes the class of bug rather
than each instance. Measure S1 first. S1 is where the work is.

## S3: Check the cost of `:has()` selectors while the DOM changes

**What was found.** The built CSS has 24 `:has()` selectors. Most test a direct child
(`:has(>.ui-listdetail)`), which is cheap. Two kinds are not:

- `.ui-listdetail-detail[data-scroll]:has(.ui-listdetail)` tests the whole subtree.
- Two long `:where(...)` lists put `:not(:has(...))` on ancestors and then match any `.ui-row`,
  `.ui-toolbar`, or scroller under them.

In WebKit a `:has()` selector can make a DOM change re-check ancestors. A streaming transcript adds
and changes nodes 25 times a second, inside exactly those regions.

**Change, if it shows up.** Profile style recalculation in Web Inspector's timeline while an agent
streams. If the `:has()` rules show up, have the layout host write a data attribute on the region it
already knows the shape of, and select on that. Do not change them without a profile. The rules are
correct, and replacing them spreads layout knowledge into code.

## S4: Status polling is fine once P5 lands

`taskStatusScheduleContribution` polls task status every 10 seconds, and the changes pane refetches
on every poll. On the node, `git status` is shared across callers per worktree
([phase 5](../../../performance/2026-09-03--phase-5.md)). The part that is not shared is the numstat
pair, and [P5](./06-panes-and-transcripts.md#p5-coalesce-the-changes-panes-line-counts-on-the-node)
covers it. After that, nothing here needs to change.

## Verify before building

- Confirm the node still sends `agent:session` after every recorded event, in `record()`.
- Count roster readers with a search for `sessions()` under `plugins/agents/src/client` and in any
  other plugin that reads the agents store through a capability.
- For S3, take the profile in the packaged build or a production renderer build. A development build
  has extra style work from hot reload.
