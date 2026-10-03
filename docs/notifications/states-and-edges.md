# Notification states and edges

This page covers the five states an agent session can be in, how each producer maps its sessions to
them, and the three changes that raise a notice. It's part of [notifications](../notifications.md).

## Five states

Agents and Terminal map their own sessions to a small snapshot in
`packages/protocol/src/agents/attention.ts`. The delivery gate in
`packages/client-core/src/features/notifications/attention.ts` reads five states:

| State | Meaning |
| --- | --- |
| `working` | The agent is doing something, or has produced output nobody has asked about. |
| `blocked` | The agent is waiting on the owner: a permission, a question, or a workflow gate. |
| `finished` | The turn ended and the owner hasn't spoken again. |
| `error` | The session failed or the process exited non-zero. |
| `idle` | Nothing is running and there's nothing to report. |

A snapshot carries the Node, source, and session IDs, the task, title, and state, a notice target,
and whether completion should notify. The key includes the Node and the source, so sessions from
different producers can't collide.

### The managed adapter

`plugins/agents/src/contract/attention.ts` reads `AgentSession` rows as `agent:session` frames
upsert them (`plugins/agents/src/client/sessions/managedStore.ts`). Attention wins over runtime
state. The Node sets `attention` from the driver's own events, so a session asking for a permission
is blocked whatever its process is doing. [Managed agents](../managed-agents.md) owns that
projection.

| `attention` | `runtimeState` | State |
| --- | --- | --- |
| `permission`, `question`, `workflow_gate` | any | `blocked` |
| `completed` | any | `finished` |
| `error` | any | `error` |
| `none`, `unread` | `working`, `waiting`, `cancelling`, `reconnecting`, `connecting`, `replaying`, `creating` | `working` |
| `none`, `unread` | `ready`, `stopped`, `archived` | `idle` |
| `none`, `unread` | `failed` | `error` |

### The terminal adapter

`plugins/terminal/src/client/attention.ts` reads `TerminalSession` rows when Terminal refreshes its
list of sessions. It maps sessions with `kind: 'agent'` only, because a plain shell exiting isn't an
agent needing you. Terminal replaces its snapshots with each successful refresh, including an empty
one, and forgets them after a failed refresh or on disposal.

| `status` | `agentState` | `idle` | `exitCode` | State |
| --- | --- | --- | --- | --- |
| `running` | `blocked`, `permission` | any | | `blocked` |
| `running` | anything else | `false` | | `working` |
| `running` | anything else | `true` | | `finished` |
| `exited` | | | `0` or null | `idle` |
| `exited` | | | non-zero | `error` |

## Three edges

An edge is a pair of consecutive snapshots for one session. Three of the 25 possible pairs raise a
notice:

| Edge | Notice kind | Title |
| --- | --- | --- |
| Anything to `blocked` | `agent-needs-input` | "\<title\> needs you" |
| `working` to `finished` | `agent-completed` | "\<title\> finished" |
| Anything to `error` | `agent-error` | "\<title\> failed" |

Every other pair is silent. `blocked` to `working` means you answered, and `finished` to `working`
means you spoke. A first snapshot with no predecessor describes a session that was already in that
state before the app opened.

`working` to `finished` raises a notice only when the producer marks the session as one that should
notify. Agents marks interactive sessions, and Terminal marks terminal agent sessions. A workflow or
automation turn is one step of a run, and the workflows plugin sends one `run-done` for the whole run
([workflows](../workflows.md)), so a 10-step run doesn't raise 10 "finished" rows.

A workflow session is quieter still. A failed step isn't an `agent-error` either, because the run
reports it as `run-failed`. The Node never gives a workflow session the `completed` or `error`
attention reason. So the rail's "needs you" count, the sidebar, and Agent Center count a workflow
session only when its agent is asking something. `run-done` draws the workflow mark, so a finished
run doesn't look like an agent finishing a turn.

`packages/client-core/src/features/notifications/kindContributions.ts` gives the three kinds their
glyphs and severities. No kind is specific to terminal agents. A terminal agent and a managed agent
look the same in the bell.
