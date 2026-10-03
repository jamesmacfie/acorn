# Subagents

Both managed harnesses can run their provider's own subagents. This page covers how acorn records
them, what each harness reports, and how acorn tells a background subagent is still working. For
subagents acorn creates as sessions, see [managed delegation](./delegation.md).

## A projection, not a session

A provider-native subagent isn't a session. You can't address it, send it a turn, fork it, or hand it
to a terminal, so a session row would be wrong in every table that reads one. Instead each session
row carries a `subagents` roster, folded from the session's own `subagent` events by `recordEvent` in
the same transaction as the event insert. The runtime broadcasts the row when an event changes it,
and every client gets agent frames, so the sidebar's sub-rows update live for every session in the
task. The roster keeps every running entry and the last 20 settled ones. The event ledger keeps the
full history.

A session row also carries `queuedTurns`, the count of waiting follow-ups, as a column the store keeps
current. It's on the row for the same reason: a value computed only on list reads would be overwritten
by the next broadcast. Queuing a turn on a session held behind the concurrency limit broadcasts the row
itself, because no event would.

A subagent's progress doesn't change its session's runtime state. Turn boundaries own that, and Codex
lets a child settle after its parent's turn completed.

## What each harness reports

The roster shows what each harness sent, not a fixed set of columns:

| | Claude Code | Codex |
| --- | --- | --- |
| What a subagent is | A tool call, `Agent` | An app-server thread on the same connection |
| Registration | `_meta.claudeCode.toolName` | A parent-side `subAgentActivity` item |
| Roster key | The spawning tool call ID | The child thread ID |
| Live inner tool calls | Yes, tagged `_meta.claudeCode.parentToolUseId` | Yes, on the child thread |
| Live inner prose | No, the CLI doesn't forward it | Yes |
| Live file changes | Yes, the diff on the tool call | Yes, the child's patch updates |
| Live usage | No | The child's `thread/tokenUsage/updated` |
| At completion | `_meta.claudeCode.toolResponse` with agent ID, type, model, tokens, tool uses, duration | Nothing more |
| Terminal state | Completed, unless backgrounded | Idle, and resumable |

`PROSE_TOOLS` in `acpNormalizer.ts` lifts the brief Claude hands a child, from its `Agent` call, and
the report the child hands back, from `SubagentHandback`, out of the tool parameters. The brief posts
as a `user_message` and the report as an `assistant_message`, both tagged with the subagent ID, and
the call keeps its title and outcome. `ExitPlanMode`'s plan is another entry in that table. Claude
sends a call's parameters on one update, often the one after the call, so the lift reads whichever
update carries them. Codex needs no lift: `codexChildRouting.ts` tags a child thread's
`user_message` with the subagent ID.

The shared ACP normalizer reads Claude's `_meta.claudeCode` namespace directly. Another harness's
namespace is absent, so the branch costs nothing. A quirk joins `HarnessQuirks` when a second harness
needs one.

The normalizer drops Claude's tool heartbeat. Every 30 seconds the CLI pings a running tool as a
`tool_call_update` under the ID `<call id>-heartbeat-<n>`, with a `toolResponse` holding only
`elapsedTimeSeconds`. Read as a call, it would mint a card every 30 seconds, and a stuck subagent row
for `Agent`.

## Background subagents

When Claude runs a child with `run_in_background: true`, the spawning call returns at launch. Its
`toolResponse` says `status: "async_launched"`, and the call goes `completed` while the child is
starting. So `async_launched` folds to `running` and sets the entry's `background` flag. Only a real
completion summary, the update that carries the harness handle, settles a background entry. The parent
reads as ready meanwhile.

That completion summary doesn't arrive. The child's own tool calls do, tagged with
`parentToolUseId`, so the roster reads liveness from traffic. Any event attributed to a child marks it
heard from (`touchSubagentRoster` in `stateMachine.ts`). A quiet window settles the row to `idle`:
detached and resumable by its `providerAgentRef`. Traffic after that revives it, and a completion
summary still folds it to `completed`.

The sweep is a debounced timer per session in `runtimeEngine.ts`, pushed back by each roster event and
re-armed at boot for sessions with an active child. The window is `SUBAGENT_QUIET_MS`, one minute. In a
captured Claude Code run on Sonnet, the longest pause from a child still working was 16 seconds.

Don't tie this to turn boundaries. A background child exists to outlive a turn. Quieting children on
`turn_completed` marked one `idle` with 70 tool calls still to come, and left the next one spinning.

## Codex routing

A child's `turn/completed` on the parent path would end the parent's turn, and its status would flip
the parent's state mid-turn. `drivers/codexChildRouting.ts` keys on the root thread ID from
`thread/start`. Anything naming another thread belongs to that subagent, registered on first sight,
because a child's traffic arrives before the item that names it. Routing asks which thread a
notification arrived on, and naming reads the item's `agentThreadId`. Mixing those up hangs a session,
because the wire reports `subAgentActivity` about the root from a child thread. An unknown method from
a child goes to the parent, so a new Codex notification shows on the parent instead of being lost.

Both routing tables are tested against real captures in `plugins/agents/src/server/drivers/__fixtures__/`.
