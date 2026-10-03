# Managed delegation

A terminal or managed session can create another managed session and give it work. This page covers
the spawn ledger, isolation, the limits on a delegation tree, and how a child's results reach its
owner. The tools themselves are in
[agent tools](../agent-tools/orchestration.md#managed-session-orchestration). The code is in
`plugins/agents/src/server/delegation/`.

## Managed delegation

Managed delegation differs from [provider-native subagents](./subagents.md). A session calls the
execute-tier orchestration tools to create an addressable `delegated` session, queue more turns,
wait, read bounded output, or cancel. The child uses the same drivers, turn queue, event ledger,
restart reconciliation, request handling, and concurrency dispatcher as an interactive session.

The `agent_spawns` table is the ownership ledger. It records the root and direct owner, child task and
session IDs, depth, isolation, the call's idempotency key, and one of `creating`, `provisioned`, or
`failed`. It doesn't copy the child's runtime state. Once provisioned, the child session owns its
readiness, work, attention, and status.

## Isolation

Shared isolation keeps the child on the caller's task, and rejects `baseBranch`. Worktree isolation
reserves a child task ID before it calls core, then creates the task, the session, and the first turn
with idempotency keys derived from the spawn. `baseBranch` names a local branch whose last commit the
child starts from. Without it, the child starts from the project folder's `HEAD` when its worktree is
created. Uncommitted changes don't carry over, and the worktree is created lazily
([child tasks](../workspaces-and-tasks/task-creation.md#child-tasks)).

The ledger keeps the chosen base for recovery. At startup, reconciliation resumes any `creating` row
from its last durable step. A permanent failure keeps the row and any child task or session, so
recovery doesn't delete a checkout that might hold work. The Node can open its listener before
recovery finishes, so every orchestration tool waits for it.

## Limits

Only the direct owner can address a child. A child can create one more level, and a third level is
refused. Each root admits at most 12 live delegated sessions (`MAX_LIVE_DESCENDANTS`), counting rows
still being created. The child's tool ceiling is the intersection of the parent's signed ceiling and
any narrower one asked for at spawn, and a configuration update can't widen or remove it. A child
stopped for being idle stops counting toward the 12.

## Lineage in the Agent pane

A managed child records `parentSessionId` and the parent's active `parentTurnId`. A child owned by a
terminal uses only the spawn ledger, and shows a bounded terminal label and profile. The Agent pane
nests managed children under their parent with the same inset left rule as provider-native
subagents, labels terminal-owned children without inventing a parent row, shows depth and isolation,
and links a child back to its parent.

Above a parent's composer, one row per live direct child shows its title, runtime and attention
state, and the task title when the child is in another task. Activating a row opens that task and
session. Child updates don't remount the parent's composer.

## Reports back to the owner

A turn an owner queues on its child, through `agent_spawn` or `agent_prompt`, carries a `delegation`
context part. For a managed owner it also carries `reportTo` in its effective policy
(`plugins/agents/src/server/delegation/reports.ts`). The context part names the owner, says the
child's final message is its report, and tells the child to end the turn with a question instead of
asking the user. A turn you type into the child's pane has neither and doesn't report.

When a `reportTo` turn settles as completed, failed, cancelled, or interrupted, the plugin queues one
`delegation_report` turn on the owner. It holds the child's title, the outcome, any error, the last
8 KiB of the final message, and the validated structured result when the turn declared a
`resultSchema`. The final message sits inside `<pasted_content>` tags, which Claude Code's system
prompt treats as text the owner's user didn't write. A child that read a hostile page could repeat it,
and unmarked, it would reach the owner as a request. The transcript hides the tags. A refused turn
reports as refused. The report queues behind the owner's work and doesn't steer an active turn.

The key `delegation-report:<child turn id>` makes delivery exactly-once. The trigger is the
`turn-changed` broadcast, which isn't durable, so startup reconciliation queues any missing reports.

When a delegated turn pauses on a permission, question, or elicitation, the `request-changed` event
queues an informational report keyed `delegation-request:<request id>`. It names the child, the kind,
and bounded request text. A person resolves the request in the child's pane. No agent tool grants
approval. Pending requests expire on restart, so reconciliation covers only settled turns.

No report is queued in these cases:

- The owner cancelled the turn with `agent_cancel`.
- The owner session is archived or failed.
- The owner holds 100 reports (`MAX_REPORTS_PER_OWNER`). Later results stay readable through
  `agent_read`.

Reading a result with `agent_read`, or cancelling the turn, withdraws a queued report. A read between
the child settling and the report queuing can leave one extra report. A terminal owner has no session
to wake, so it uses `agent_wait` and `agent_read`.

## Sender labels

The transcript labels a `delegation` turn "From" and the owner's title, and a `delegation_report`
turn "From" and the child's title (`plugins/agents/src/client/sessions/turnSender.ts`). A workflow
step's prompt is "Workflow". The turn acorn sends when a step ended without its result is "Acorn"
([workflow execution](../workflows/agent-steps.md#a-turn-that-ends-early)). Every other user turn is
"You".

Message headers show a small time in your device's timezone. Hovering or focusing it shows the full
date, timezone, and age. Expanded built-in tool calls show the same below the command input. The
Node stamps each event when it records it, and a folded card keeps its first event's time.
