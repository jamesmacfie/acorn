# Steer a running turn

Steering hands a queued message to the turn an agent is running, so the agent reads it at its next
step instead of after the turn ends. This page covers what a person sees, what the Node does, and
what each harness supports. A message that isn't steered waits in
[the turn queue](./operations.md#the-turn-queue).

## In the clients

While a Claude Code or Codex turn runs, two controls appear:

- **Steer** sits beside **Send** in the composer. It queues the draft, then steers the queued turn.
- **Steer now** sits on each queued row you sent.

Enter still queues. Both controls show only while the session is `working`, the session is
interactive, and the provider descriptor lists the `steering` capability. `canSteer` in
`plugins/agents/src/client/sessions/steering.ts` holds that rule. The composer and the queue belong to
the agents plugin's client, so the desktop and the terminal client draw the same controls from the
same code.

A row being steered reads "Steering. The agent reads this after its current step." When the agent
takes it, the row leaves the queue. Its message appears in the transcript where the agent read it, as
a user card labeled **Steered**. When the turn ends first, the row reads "The turn ended first, so this
sends as the next turn." and dispatch sends it next.

## What a steer does

`POST /v1/p/agents/sessions/:sessionId/turns/:turnId/steer` steers one queued turn. Only the owner's
device can call it. The route is idempotent by the row's state: a repeat answers the row the first
request moved. `ManagedAgentEngine.steerTurn` does the work:

1. It checks that the session is interactive and controlled by Acorn, the row is queued, and a person
   sent it. A workflow, delegation, or plugin waits on its own turn ID to settle, and a steered turn
   never does, so those rows can't be steered.
2. With no running turn, or a session that's cancelling, it answers the row unchanged. Dispatch sends
   it next anyway.
3. It writes the row as `steering`. The row leaves the session's queue count, and dispatch holds the
   rows behind it, so a missed steer keeps its place.
4. It runs the checks a dispatch runs before its send: the
   [instruction checks](../security.md#instruction-file-checks-and-review), the secret check on
   attachment bytes, and the copy of each attachment into the session's folder. A failed check puts
   the row back in the queue, and the route answers with the error a dispatch would record.
   `agents:before-send` already ran when the row was accepted.
5. It hands the message to the harness and answers with the row as `steering`. The agent may not
   reach a step for minutes, so the outcome arrives later as a turn frame.

When the agent takes the message, the driver reports it in its event stream at that point. The Node
records a `user_message` event with `steeredTurnId` under the running turn. In the same transaction,
the store writes the row as `steered`, with `steeredIntoTurnId` naming the running turn. When the turn
ends first, the row goes back to `queued`.

The steered message runs under the running turn's policy and attendance. The model, effort, and mode
on the queued row don't apply. Its tokens and time count toward the running turn, so the usage line
and the **Turn complete** line describe the whole turn.

A `steered` row is part of the turn it joined. A session snapshot leaves it out of `turns`, so the last
entry stays the latest turn that ran, and lists it in `steeredTurns`, which the transcript reads for
the message's attachments and context. The `agents.turns` capability reports it with status `steered`.
`toolCaller`'s `onTurnSettled` doesn't, because it isn't a settled turn.

## Harness support

`AgentDriverSession.steer` in `plugins/agents/src/server/drivers/types.ts` takes the queued turn's
prepared input and the running turn's ID. It answers `taken` once the driver has emitted a driver-only
`steer_taken` event, or `missed`. A harness without it has no `steering` capability, and its queue
works as before.

### Codex

The driver calls `turn/steer` with `expectedTurnId` set to the running provider turn and
`clientUserMessageId` set to the queued turn's ID. Codex refuses when that turn isn't running, which
is a turn that ended first, and the steer misses. Codex also refuses to steer a review or a
compaction turn.

An accepted steer counts as taken when its `userMessage` item joins the turn, matched by `clientId`.
The response to `turn/steer` comes first, and reply text still streaming ahead of the item belongs
before the message. A steer whose item never arrives counts as taken when the turn completes, because
Codex records the input in the thread as the turn ends.

Codex doesn't always wait for the running command. In a check on October 13, 2026, it moved a
90-second `sleep` to the background, read the steered message within a minute, and answered it. The
command's card then reads **running in background** ([background commands](./background-commands.md)).

### Claude Code

`claude-agent-acp` takes a second `session/prompt` while one runs and pushes the message into Claude
Code's input. Claude Code reads it after the tool call it's running. The adapter then settles the
first prompt with `end_turn`, and the second prompt settles when the turn ends, with the turn's usage.
[The steering spike](../testing/claude-steering-spike-2026-10-13.md) records the wire.

The ACP driver treats a turn as a chain of prompts. A prompt that settles with a steered prompt behind
it marks that one taken, and only the last prompt's answer ends the turn. The built-in Claude spec sets
`promptQueueing`, which turns this on. A steer misses only when the driver's turn has already ended.

### Other ACP harnesses

ACP version 1 has no call that adds input to a running prompt, so a contributed harness stays
queue-only. Zeron calls a `_session/steering` method on an agent that advertises
`initialize._meta.steering.supported`. Add a `steering` quirk to `HarnessQuirks` only when an agent
Acorn supports ships that extension.

## Restart and failure

A row still `steering` at boot has no message in the ledger, because the event and the `steered`
status commit together. Reconciliation puts it back in the queue. The harness that held the message
stopped with the last Node, and neither harness keeps a message it hadn't read.

A steer that a person's **Stop** overtakes counts as taken. Both harnesses keep a message they
accepted in their history even when the turn is cancelled, and sending it again would show it to the
agent twice.

## Limits

- A message reaches the agent twice only if the Node stops between the agent reading it and the Node
  committing its event, a window of a few milliseconds.
- Only a person steers. Plugin notes through [session messages](./session-messages.md), workflow
  turns, goal continuations, and delegated sessions keep queuing.
- There's no "stop and send". **Stop** and the queue cover it.

## Why

Enter keeps queuing because people type their next request while they wait. If Enter steered, that
habit would redirect an agent mid-task. Steering is a choice made on purpose, so it has its own button.

The route answers before the agent takes the message because the agent may be in the middle of a long
command. Holding the request open that long would time it out.
