# Agent messaging

Status: delivered, 2026-09-26. The report back to the owner, per-turn role note, and sender labels
shipped on 2026-09-24. The blocked-request wake and live children rows shipped on 2026-09-26.
Merging queued reports remains optional until real use shows separate reports are noisy.

An orchestrator agent in a main task spawns child tasks, and then it needs to talk to the agents in
them. Acorn shipped the parent-to-child half first: `agent_spawn`, `agent_prompt`, `agent_wait`,
`agent_read`, and `agent_cancel`. This file records the delivery decisions and the optional work
still under consideration.

Owning docs win where this disagrees with them.
[agent-tools.md](../agent-tools/orchestration.md#managed-session-orchestration) holds the five orchestration tools,
and [managed-agents.md](../managed-agents/delegation.md#reports-back-to-the-owner) holds the reports, the role
note, and the labels.

## What the reference apps do

Six apps under `references/` let agents talk to each other. The rest run agents in parallel with the
human as the only link.

**Paseo** has one messaging tool, `send_agent_prompt`, and a message becomes an ordinary turn in
the recipient's conversation. When a child finishes or needs permission, Paseo queues a turn wrapped
in `<paseo-system>` on the parent, carrying the child's last message (`setupFinishNotification` in
Paseo's server `agent-prompt.ts`). The parent pane has a "subagents track" pill that lists its
children. Archiving a parent archives its children.

**Proliferate** treats a child as a normal session plus a link row, and every tool call checks that
row again instead of trusting the token. A ledger delivers one wake turn to the parent per child
completion, even across restarts. It merges a wake that is still queued and drops one the parent no
longer needs. A child can't create children. Before every turn, each agent gets a block that names
its parent and says its final message goes back to that parent (the subagents system spec in its
`specs` folder).

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

## How the shipped version differs from the first sketch

The sketch called for an `agent_spawn_wakes` table and a `from_session_id` column on `agent_turns`.
Neither was needed:

- The report's idempotency key, `delegation-report:<child turn id>`, gives exactly-once delivery on
  its own. A startup pass over settled turns replaces the table's pending state.
- A new turn source, `delegation_report`, says which way a turn went. A context part on each turn
  names the other agent. Together they carry what the column would have.
- The role note is stored with the turn when the owner queues it, not resolved at send time. Acorn
  has no way to move or detach a child, so the owner can't change between the two.

Two rules changed on the way:

- Only a turn the owner queued reports back. A turn the user types into the child's pane doesn't
  report, because the owner didn't ask for it.
- Past 100 reports, the node logs a warning and stops queuing reports for that owner. The sketch
  called for a notice on the root task, which would need the notice plumbing for one rare case.

## Delivery and optional follow-up

### Wake the owner when a child is blocked

Delivered 2026-09-26.

A child that stops on a permission, question, or elicitation request doesn't settle its turn, so the
post-commit request event queues a separate report keyed by the request ID. It tells the owner which
child is blocked and on what. The human answers the request in the child's pane. The owner is told,
but it can't approve, because one agent approving another's tool use widens what that agent can do.
Pending requests expire at restart, so this has no startup pass.

### A row per child above the composer

Delivered 2026-09-26.

The Agent pane nests managed children under their parent. Above the owner's composer, one row per
live child shows its state and attention, and activation opens the child's task. The rows use the
lineage projection the session list already has.

### Merge reports that queue together

Deferred. Separate reports retain provenance for a tree of at most 12 children.

When several children finish while the owner is busy, each queues its own report. `patchQueuedTurn`
can edit a queued turn's input, so these could merge into one. At 12 children at most, separate
reports are acceptable until someone finds them noisy.

## What this refuses

- Messages between siblings, and group addresses. Only a direct owner can address a child, and that
  stays the authority model. Every reference app that allows peer messages wraps them in grants or
  allowed-pair lists. Asking the parent to pass a message on covers the cases found so far.
- A separate messages table with an inbox and read receipts. The turn ledger already records who
  said what and in which order.
- A blocking `ask` tool. Ending the turn and reporting to the owner does the same job.
- Heartbeats, and nudging an agent by typing into its terminal. Orca needs both because it can't wake
  a terminal agent any other way. A managed session can take a queued turn.
- Steering a report into an active turn.
- A parent approving a child's permission request.

## Implementation seams

- A request row is written before the blocked-request report hooks the post-commit
  `request-changed` broadcast (`AgentLifecycle.announceRequest` in
  `plugins/agents/src/server/sessions/lifecycle.ts`).
- That the report turn source, `delegation_report`, sorts behind interactive turns in the pump, as
  `delegation` does.
- The terminal client shares `AgentEventCard.tsx`; revisit its sender projection if it stops sharing
  that component.

## Left open

- A per-call switch to turn reports off, like Paseo's `notifyOnFinish`. Withdrawal after a read
  may make it unnecessary. Decide once someone has a case for it.
- Whether a parent may answer a child's question or elicitation. That would need a tool that
  responds to a request, and a rule that keeps permissions with the human.
- The 100-report limit is a guess. Tune it against real runs.
