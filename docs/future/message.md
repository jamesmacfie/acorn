# Agent messaging

Status: proposal, 2026-09-24. Not started.

An orchestrator agent in a main task spawns child tasks, and then it needs to talk to the agents in
them. Acorn ships the parent-to-child half of that. This file sketches the other half: a child's
result reaches its parent without polling, every turn records which agent sent it, and both
transcripts show agent traffic as agent traffic.

Owning docs win where this disagrees with them.
[agent-tools.md](../agent-tools.md#managed-session-orchestration) holds the five orchestration tools,
and [managed-agents.md](../managed-agents.md#managed-delegation) holds the spawn ledger, depth, and
fan-out rules.

## What ships today

The Agents plugin contributes `agent_spawn`, `agent_prompt`, `agent_wait`, `agent_read`, and
`agent_cancel`. Worktree isolation gives the child its own task, which is the "main task with
sub-tasks" shape. The `agent_spawns` table decides who owns what. Only a direct owner can address a
child, depth stops at two, a root holds at most 12 live descendants, and a child's tool ceiling is
the intersection of its parent's and its own.

Everything flows one way. A parent learns what a child did only by calling `agent_wait`, which gives
up after 30 seconds, or `agent_read`. If the parent ends its turn, nothing tells it later that a
child finished, failed, or stopped on a question. A child can't send anything upward except the
output its parent reads.

The labels are wrong too. `AgentEventCard.tsx` names a prompt's sender either "You" or "Subagent", so
a child's transcript shows its parent's prompt as if the user had typed it.

## What the reference apps do

Six apps under `references/` let agents talk to each other. The rest run agents in parallel with the
human as the only link.

**Paseo** has one messaging tool, `send_agent_prompt`, and a message becomes an ordinary turn in
the recipient's conversation. When a child finishes or needs permission, Paseo queues a turn wrapped
in `<paseo-system>` on the parent, carrying the child's last message
(`setupFinishNotification` in Paseo's server `agent-prompt.ts`). The parent pane has
a "subagents track" pill that lists its children. Archiving a parent archives its children.

**Proliferate** treats a child as a normal session plus a link row, and every tool call checks that
row again instead of trusting the token. A ledger delivers one wake turn to the parent per child
completion, even across restarts. It merges a wake that is still queued and drops one the parent no
longer needs. A child can't create children. Before every turn, each agent gets a block that names
its parent and says its final message goes back to that parent
(the subagents system spec in its `specs` folder).

**Orca** keeps a durable mailbox. Messages are typed (`worker_done`, `heartbeat`, `escalation`,
`question`), workers read their inbox at natural pauses, and `ask` blocks until the coordinator
replies. It nudges a worker by typing into its terminal. The worker prompt forbids the local
ask-the-user tool because nobody is there to answer it. Getting this right took 35 schema versions.

**AgentsDock** moves nothing between chats until the user @-mentions the target. Incoming messages
queue and never interrupt a running turn. They render as distinct cards in both chats, never as a
user message. An exchange is one request and one answer.

**Chat On Steroids** has spawn, message, status, and finish. A worker that finishes goes to sleep
with its context intact, and a message wakes it.

**RoboCo** stores a two-agent conversation as one record, keeps a list of which pairs may talk, and
marks each message with `requires_response` and `response_to_id`.

The apps agree on four things. A message from an agent is labelled as one. The relationship decides
who may address whom, and the check runs on every call. A child's completion reaches the parent
exactly once without the parent polling. A child's question goes to the parent, not to a local
prompt with nobody watching.

## The design

This design adds one table and one column, and it adds no tools.

### Wake the parent when a child's turn settles

When a delegated child's turn settles and its owner is a managed session, queue one turn on the
owner. The wake turn carries a short text notice and a `context` input part. The part sets `source`
to `agents`, `resourceId` to the child session, `provenance` to the child turn, and `deepLink` to
the child. The body holds the child's title, the outcome (`completed`, `failed`, or `cancelled`), its
final assistant message capped at 8 KiB, and the validated structured result when the turn declared
a `resultSchema`.

The wake queues and never steers into an active turn. The parent's own turn queue already orders
things correctly.

A wake needs to survive a restart. `onCompletedTurn` in `runtimeEngine.ts` is fire-and-forget and
fires only on `turn_completed`, so it can't carry the wake on its own. Instead, record a delivery row
in the same write that records the settling event, and let startup reconciliation dispatch any row
still pending:

```text
agent_spawn_wakes
  id, spawn_id, trigger_id UNIQUE (the child turn id), parent_session_id,
  state (pending | queued | delivered | suppressed), parent_turn_id NULL,
  created_at, updated_at
```

The unique `trigger_id` gives exactly-once delivery. Mark a row `suppressed` instead of queuing when
any of these hold:

- The parent cancelled the turn itself with `agent_cancel`.
- The parent session is archived or stopped.
- The parent already read the settled turn through `agent_wait` or `agent_read`. If the wake is
  still queued when that happens, remove it.
- The root has already had 100 wakes. Raise a notice on the root task instead, so a parent and child
  that keep prompting each other stop at a visible limit.

When several children finish while the parent is busy, merge them into the parent's queued wake if
the queue allows editing a queued turn. If it doesn't, one wake per child is acceptable at 12
children.

Terminal-owned spawns have no managed session to wake. They keep polling as they do today.

### Record who sent each turn

Add a nullable `from_session_id` column to `agent_turns`. `agent_prompt` sets it to the parent, and
the wake sets it to the child. The existing `delegation` source covers both directions, because the
sender's place in the spawn ledger says which way the turn went.

`AgentEventCard.tsx` then picks its label from three cases. A turn with no sender shows "You". A turn
from the parent shows "From" and the parent's title, with a link back. A turn from a child shows
"From" and the child's title, the outcome, and a link to the child's task, with the body folded to
the final message. A terminal owner has no session, so its prompts use the terminal label the spawn
ledger already stores.

### Ask by ending the turn

This design has no blocking ask tool. A child that needs a decision ends its turn with the question,
the wake carries the question to the parent, and the parent answers with `agent_prompt`. That covers
Orca's `ask` and `reply` with the turn queue acorn already has.

A child that stops on a permission, question, or elicitation request doesn't settle its turn, so it
needs a second trigger. Queue a wake keyed by the request ID that tells the parent which child is
blocked and on what. The human answers the request in the child's pane. The parent is told, but it
can't approve, because one agent approving another's tool use widens what that agent can do.

### Tell each child its role on every turn

When a delegated child's turn goes to the provider, add a short block. It names the parent and says
the final message goes to that parent. It tells the child to ask the parent by ending the turn with
the question, and never through a local ask-the-user tool. It also says to put the report in the
final message rather than in a separate file. Resolve the block from the spawn ledger at send time,
not from the first prompt, so it stays correct if the relationship changes.

### Screens

The child transcript labels parent prompts as described above. The parent transcript shows each
wake as its own card. The Agent pane already nests managed children under their parent. Above the
parent's composer, add one row per live child with its state and attention, and let a click open the
child's task. Build it from the lineage projection the session list already has. Check the terminal
client's copy of the event card at the same time, so both hosts label turns the same way.

## Order of work

1. The `from_session_id` column and the labels. It's small, visible, and depends on nothing else.
2. The wake table, dispatch, startup reconciliation, and suppression.
3. The per-turn role block.
4. The wake on a blocked request.
5. The children row above the composer.

When a step ships, update `agent-tools.md`, `managed-agents.md`, and `testing.md`, and delete the
matching part of this file.

## What this refuses

- Messages between siblings, and group addresses. Only a direct owner can address a child, and that
  stays the authority model. Every reference app that allows peer messages wraps them in grants or
  allowed-pair lists. Asking the parent to pass a message on covers the cases found so far.
- A separate messages table with an inbox and read receipts. The turn ledger already records who
  said what and in which order.
- A blocking `ask` tool. Ending the turn and waking the parent does the same job.
- Heartbeats, and nudging an agent by typing into its terminal. Orca needs both because it can't wake
  a terminal agent any other way. A managed session can take a queued turn.
- Steering a wake into an active turn.
- A parent approving a child's permission request.

## Verify before building

- `onCompletedTurn` in `plugins/agents/src/server/sessions/runtimeEngine.ts` fires only on
  `turn_completed`, not `error`, and nothing waits for it. Confirm where the settling event is
  written, so the wake row can go into that write.
- Whether the store can remove a queued turn, which suppression needs, and whether it can edit a
  queued turn's input, which merging needs.
- Where turn input becomes the provider prompt, for the role block. `agentTurnInputText` in
  `plugins/agents/src/server/sessions/runtimeContext.ts` is the likely place.
- The label logic in `plugins/agents/src/client/sessions/AgentEventCard.tsx`, and the terminal
  client's copy of it.
- The `source` comment on `agent_turns` in `plugins/agents/src/node/schema.ts` omits `delegation`,
  which `plugins/agents/src/shared/schemas.ts` accepts. Fix the comment with the new column.
- That wake turns take a provider concurrency slot like any other turn.
- That a workflow-owned session still can't see `agent_spawn`, so workflows never receive wakes.

## Left open

- A per-call switch to turn the wake off, like Paseo's `notifyOnFinish`. Suppression after a read
  may make it unnecessary. Decide once someone has a case for it.
- Whether a parent may answer a child's question or elicitation. That would need a tool that
  responds to a request, and a rule that keeps permissions with the human.
- The 100-wake limit is a guess. Tune it against real runs.
