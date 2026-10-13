# Steer a running turn

Date: October 13, 2026. Status: proposed. Baseline: `6d9efa88f`. Nothing in this plan is implemented.

This is the handoff for steering: sending a message into the turn an agent is running, so it changes
course at its next step instead of after the turn ends. Today a message typed while a session works
joins the queue and waits ([the turn queue](../managed-agents/operations.md#the-turn-queue)). The idea
comes from zeron (`references/zeron` at `053ce2ea`), whose send button changes to **Steer** while a
turn runs.

The owning docs win where this disagrees with them: [operations](../managed-agents/operations.md) for
dispatch, [harnesses](../managed-agents/harnesses.md) for the drivers, and
[the composer](../managed-agents/composer.md) for the draft and the queue.

## Outcome

- While a Claude or Codex turn runs, a queued follow-up has a **Steer now** action, and the composer
  has a **Steer** button beside **Send**. Enter still queues.
- The agent reads the message at its next step boundary, such as after the tool call it's running.
  The message appears in the transcript where the agent picked it up, labeled **Steered**.
- If the turn ends before the agent takes the message, the message stays queued and sends as the next
  turn. A message is never lost and never sent twice.
- The desktop and the terminal client offer the same action.
- A harness that can't steer shows no steering control. Its queue works as it does today.

## Out of scope

- Plugin notes through [session messages](../managed-agents/session-messages.md), workflow turns, goal
  continuations, and delegated sessions. They keep queuing. Only a person steers.
- Changing the model, effort, or mode with a steer. Use the pickers.
- "Stop and send", which cancels the turn and sends the message as a new one. It's a reasonable
  follow-up, and **Stop** plus the queue already covers it in two clicks.
- Steering a subagent. Neither harness lets you reply to one.
- Contributed ACP harnesses. ACP version 1 has no steering call, so they stay queue-only until a
  harness declares support (see [generic ACP](#generic-acp)).

## What each harness offers

### Codex

The app-server has `turn/steer` (`references/codex/codex-rs/app-server-protocol/src/protocol/v2/turn.rs`
at `e57fc9ea5a`). Its parameters are `threadId`, `input`, an optional `clientUserMessageId`, and a
required `expectedTurnId`. The call fails when `expectedTurnId` isn't the active turn, which is the
race where the turn finished first. The schema doesn't mark the call experimental. Two of its optional
fields are experimental, and this plan doesn't use them.

Zeron treats a steer as taken only when the matching `userMessage` item joins the turn, not when
`turn/steer` returns. Splitting on the response put reply text that was still streaming into the wrong
segment. Follow the same rule: match the item by `clientUserMessageId`.

`codexStart.ts` already holds the provider turn ID it passes to `turn/interrupt`, so `steer` sits
beside `sendTurn` in `plugins/agents/src/server/drivers/codexStart.ts`.

### Claude Code

Claude runs through `@agentclientprotocol/claude-agent-acp` 0.54.1. Its `prompt()` accepts a second
`session/prompt` while one runs. It pushes the user message onto the SDK's streaming input at once
and keeps a per-session turn queue, settling each prompt from the CLI's echo of that message's UUID.
See `prompt` and `activateTurn` in the adapter's `dist/acp-agent.js`.

What Claude Code then does with that message isn't verified. Zeron drives the CLI's stream-json
directly and reports that the CLI folds a user line written mid-turn into the running turn at its own
step boundary. If the adapter path behaves the same, steering Claude is a second `session/prompt`. The
driver then has to read the two prompt responses correctly. The first step of this plan checks that on
the wire.

### Generic ACP

ACP version 1 defines no way to add input to a running prompt. Zeron calls a `_session/steering`
method on agents that advertise `initialize._meta.steering.supported`. Adapter 0.54.1 doesn't advertise
it. Add a `steering` quirk to `HarnessQuirks` in `plugins/agents/src/server/drivers/harness.ts` only
when an agent you want to support ships the extension. Don't add it in this work.

## Design

### A steer is a queued turn taken early

Reuse the queued turn row. The queue is already durable, editable, and reorderable, and the composer
already draws it. Steering a row asks the Node to hand that row to the running turn instead of waiting
for the turn to end. Any queued row can be steered, not only the head.

On a steer request the Node does this:

1. It checks that the session has an active turn, its driver session has `steer`, and the row is still
   `queued`.
2. It runs the same admission the dispatcher runs before a send: the
   [instruction checks](../security.md#instruction-file-checks-and-review), the `agents:before-send`
   hooks, attachment copying, and the context block. Pull that pre-send work out of the dispatch path
   near the `sendTurn` call in `plugins/agents/src/server/sessions/runtimeEngine.ts` into one function
   both paths call. Don't copy it.
3. It writes the row as `steering`, then calls the driver.
4. When the harness confirms the agent took the message, the Node writes the row as `steered`, with
   `steeredIntoTurnId` naming the running turn. It records the `user_message` event under the running
   turn.
5. When the harness reports the turn ended first, the Node writes the row back to `queued`. Normal
   dispatch sends it next. The composer says "The turn ended first, so this sends as the next turn."

The steered message runs under the running turn's policy and attendance. It can't change either.

### Contract changes

These are wire and storage changes, so plan them as one step with the migration:

- `AgentTurnStatus` in `plugins/agents/src/contract/wire.ts` gains `steering` and `steered`. Every
  reader of turn status has to handle them: `QueuedAgentTurns.tsx`, the terminal client, the
  `agents.turns` capability, workflows' turn readers, and `toolCaller`'s `onTurnSettled`. A steered row
  isn't a settled turn, so `onTurnSettled` doesn't report it.
- The `agent_turns` table gains `steered_into_turn_id`. Its `status` column is plain text, so the new
  values need no constraint change. The session row's `queued_turns` count drops when a row leaves
  `queued` for `steering` and rises again on a miss. Generate the migration with `pnpm db:generate`.
- `AgentDriverSession` in `plugins/agents/src/server/drivers/types.ts` gains an optional
  `steer(options): Promise<'taken' | 'missed'>`. Its options match `AgentDriverTurnOptions` plus the
  running turn's ID.
- The provider descriptor's `capabilities` gains `steering`, so a client shows the control only when
  the harness can steer.
- A route steers one queued turn: `POST /sessions/:id/turns/:turnId/steer`, with an idempotency key
  like the other turn routes.

Marking the row `completed` with a pointer was considered and refused. Its usage, duration, and stop
reason would describe a turn that never ran.

### Restart safety

The `steering` state covers a crash between the provider taking the message and the Node writing
`steered`. On boot, reconciliation looks for the row's message in the ledger by its client message
ID. If it's there, the row becomes `steered`. Otherwise the row goes back to `queued`. Without this, a
crash in that window would send the message twice.

### Clients

- **Desktop.** `QueuedAgentTurns.tsx` shows **Steer now** on each row while the session is `working`
  and the descriptor has `steering`. The composer shows **Steer** beside **Send** under the same
  condition. **Steer** queues the draft and steers it in one request.
- **Terminal.** The queued-row actions and the composer offer the same action through the shared
  model, so the two clients don't drift.
- **Transcript.** A `user_message` event inside an active turn draws as a user card with a **Steered**
  label. Check how `createConversationProjection` in
  `plugins/agents/src/client/sessions/conversationItems.ts` places a user message that arrives in the
  middle of a turn, and add a test for it.

## Implementation steps

1. Spike Claude. In a `pnpm dev:agent` session, send a second `session/prompt` through the ACP driver
   while a Claude turn runs a slow tool. Record whether the CLI folds it into the running turn, how
   many `session/prompt` responses come back, and in what order. Write the result in a dated page
   under `docs/testing/`. If the CLI runs it as a separate turn after the first, Claude can't steer
   through this adapter. Ship Codex alone and record the gap.
2. Make the contract and storage changes, with the migration.
3. Pull the pre-send admission into one function and move dispatch onto it, with no change in
   behavior.
4. Add `steer` to the fake driver in `plugins/agents/src/server/drivers/fake.ts`, with a switch that
   returns `missed`, so the runtime tests cover both outcomes without a real harness.
5. Implement Codex `steer`.
6. Implement Claude `steer`, as the spike found.
7. Add the route, the desktop actions, and the transcript label.
8. Add the terminal actions.
9. Update [the composer](../managed-agents/composer.md), [operations](../managed-agents/operations.md),
   [harnesses](../managed-agents/harnesses.md), and [the transcript](../managed-agents/transcript.md),
   then delete this file and list it under the removed plans in [the future index](./README.md).

## Acceptance

- A Codex turn running a long shell command is steered with "Stop and list the files instead". The
  agent's next step follows the message. The transcript shows the steered card inside the same turn.
  The session has one active turn throughout, and the queued row ends `steered`.
- A steer sent as the turn completes dispatches as the next turn exactly once. The runtime test uses
  the fake driver's `missed` switch, and a real-window check catches the race on Codex at least once.
- A Node killed between the provider taking a steer and the `steered` write comes back with the
  message in the transcript once and the row `steered`.
- A steer whose instruction check fails, or whose `agents:before-send` hook refuses, stays queued with
  the same error a dispatch would show.
- A session on a harness without `steering` shows no steering control in either client.
- The desktop and terminal flows pass in `pnpm dev:agent` and `pnpm dev:tui:agent`.

## Risks

- Claude's behavior through the adapter is unverified. Step 1 can end with Claude out of scope.
- A steered message's tokens and time count toward the running turn. Usage lines and the
  **Turn complete** line describe the turn, so this is correct, but say so in the transcript doc.
- Codex answers `turn/steer` before the message item joins the turn. Treating the response as the
  confirmation splits the reply in the wrong place.

## Why

Enter keeps queuing because people type their next request while they wait. If Enter steered, that
habit would redirect an agent mid-task. Steering is a choice you make on purpose, so it has its own
button.
