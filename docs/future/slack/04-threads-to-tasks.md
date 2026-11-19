# Phase 4: threads to tasks

Date: November 19, 2026. Status: proposed. Depends on phase 3.

## Goal

An owner's mention or DM becomes an agent session: in a task of its own in tasks mode, or in the
channel's shared task in conversation mode ([two modes](./rules.md#two-modes)). The thread carries
the conversation both ways, by [the conversation rules](./rules.md): turns, guests, reactions, the
status line, answers, and turns typed in Acorn.

## Starting point

- `CompiledTaskService.createRoot(projectId, seed, intendedTaskId)` in
  `packages/node-core/src/server/core/tasks.ts` makes a root task, and gives the same task back for a
  repeated ID. Its seed is `{ title, branch?, origin }`.
- `agents.sessionExecute` runs one turn in a session the caller started
  ([running a turn from a plugin](../../managed-agents/session-control.md#running-a-turn-from-a-plugin)).
  Its default timeout is 10 minutes, and it gives no turn ID until the turn ends.
- `plugin:agents:turn-changed`, `plugin:agents:activity`, and `agents.reviewInput.v1` report turns,
  their activity, and a finished turn's text ([session events](../../managed-agents/session-events.md)).
- `knownValues.matcher(folder)` on the compiled core services finds this machine's key values in
  text ([known key values](../../security/known-key-values.md)).
- `agents:composer-actions` is the composer's only slot. It takes a stack of up to four actions.

## In scope

Everything in [the conversation rules](./rules.md) except approvals.

## Out of scope

Approval buttons, which are phase 5. Files and images. Every item under
[later](./rules.md#later).

## Steps

1. **Receive.** Parse the payload and drop what the rules ignore. Drop a message already in the
   messages table, keyed by team, channel, and timestamp. Add 👀 to an owner's message.
2. **Start a thread.** For an owner's mention or DM with no thread row that hasn't ended, find the
   project from the channel's settings, or hand the message to the picker. Then pick the task by the
   channel's mode:
   - **Tasks mode.** Call `createRoot` with origin `slack`, titled with the message's first line
     without the mention, up to 60 characters. The ID derives from the team, channel, and message
     timestamp, so a repeated delivery finds the same task, and a later mention in the same thread
     makes another.
   - **Conversation mode.** Use the channel's task for this project from the channel tasks table.
     When there's none, or it's archived, call `createRoot` with no branch and origin `slack`, titled
     after the channel, such as "#ideas", or "Slack DM" for a DM. Its ID derives from the team,
     channel, project, and the time the row was made, so a repeated delivery finds it and a
     replacement after an archive is a new task.

   In both modes:
   - Add a `links` field to the root seed, so the task links to the Slack message, or to the channel
     in conversation mode. This is an additive change to a compiled-only type.
   - Write the thread row and its first thread session row in one transaction once the session
     exists.
   - For a mention partway through a thread, read the thread once with `conversations.replies` and
     keep its earlier messages as context for the first turn.
3. **Run turns.** Call `sessionExecute` with these fields:

   | Field | Value |
   | --- | --- |
   | `profileId` | The Node's default profile, `agents.defaultProfile` |
   | `prompt` | The owner's text, without the mention |
   | `context` | The rules block from [what the agent is told](./rules.md#what-the-agent-is-told), guest messages since the last turn, and, on the first turn, earlier thread messages |
   | `posture` | `gated` |
   | `timeoutMs` | Four hours, until the verify item below settles it |
   | `title` | The message's first line, up to 60 characters. In tasks mode this matches the task's title. |
   | `stepId` | `slack:<team>:<channel>:<message timestamp>` |
   | `managedSessionId` | The thread's session, after the first turn. Left out for a new thread, so each conversation-mode thread gets a session of its own in the shared task. |

   Send one turn per session at a time. Hold later owner messages in order and send each when the
   turn before it settles.
4. **Learn the turn ID.** Add an optional `onTurn(turnId)` callback to the request, called once the
   turn row exists. This is additive. Record the turn against its Slack message.
5. **Key everything by session.** Turns, the status line, answers, reactions, and approval cards
   look up their thread through the thread sessions table, never through the task. A conversation
   task holds many threads, and a later fork or second agent adds sessions to one thread
   ([room for forks and several agents](./README.md#room-for-forks-and-several-agents)).
6. **Reactions.** Swap the reaction on the turn's message from `turn-changed` and
   `request-changed`: ⏳ running, ✋ while a request waits, ✅ completed, ❌ failed, and ⏹️ cancelled or
   interrupted.
7. **Status line.** Post it when the turn starts. Edit it from `plugin:agents:activity` for the
   session, at most every 10 seconds, skipping an edit that gets `429`. End it as "Worked 4m".
8. **Answers.** When a turn completes, read it with `agents.reviewInput.v1`, remove known key values,
   convert it for the `markdown` block, cut it at 12,000 characters with a link to the task, and post
   it in the thread. Mark the turn posted in the same write that records the answer's timestamp.
9. **Mirror Acorn turns.** For an `interactive` turn in a Slack session, when it completes, post the
   owner's words from the review input, only the parts whose provenance is `person`, as "James, in
   Acorn: …", then the answer. Count the attachments and context parts, and name the number.
10. **Guests.** Store each guest reply, and pass the replies since the last turn as context on the
    owner's next turn, up to 8 KiB, newest kept. Send a guest who mentions @acorn the
    [one note per thread](./rules.md#the-owner-and-everyone-else).
11. **Composer note.** Show "Shared to #billing in Slack" in the composer of a session Slack started.
12. **End threads.** When a session Slack started is archived, end its thread. When a Slack task is
    archived, end every thread it holds. Ending a thread gives up its grant with
    `DELETE /slack/v1/grants/...` and posts "Archived in Acorn." in it. An archived conversation
    task is replaced on the channel's next top-level message.
13. **Restart.** On the first event after the Node starts, read every turn not yet posted, check it
    with `agents.turns`, and post what's owed. Pick up running turns' status lines.

## Verify before building

- What `sessionExecute`'s timeout does to a running turn, and whether a compiled caller's session
  gets `startedByPlugin`, so the session list shows "by slack".
- Whether `sessionExecute` queues a call for a busy session or refuses it. Step 3 assumes nothing
  and queues in the plugin.
- Whether any read gives a running turn's input, so a mirrored question could post when the turn
  starts instead of when it ends.
- The shape of task links on `POST /v1/core/tasks`, in `packages/protocol/src/plugin/handoffs.ts`,
  and whether a Slack address fits it.
- Whether `createRoot` with no branch makes a task in the project folder, as **New task → Project
  folder** does, or derives a branch. Conversation mode needs the first.
- What `sessionExecute` does when two new sessions start in one task at once, since conversation
  mode can start several.
- Whether `plugin:agents:sessions-changed` reports a session's archive, so step 12 can end its
  thread.
- How a task's origin gets a glyph when its plugin has no rail source. Without one, the rail draws
  a local task with `slack` as the tooltip.
- Whether `agents:composer-actions` can draw a plain label. If it can't, add a notice slot to the
  composer, as an additive extension point.
- Which address opens a task from Slack. The phone app's `/t/:taskId` route on the account website
  is the candidate ([the mobile web app](../../mobile.md)). Check what it does with more than one
  paired Node.
- The Slack rows in [research](./research.md#slack-platform-facts) marked for phase 4.

## Tests

- Tasks mode: a mention, a repeated delivery, a mention partway through a thread, and a mention in
  an archived task's thread.
- Conversation mode: two DMs start two sessions in one task, a repeated delivery starts nothing, an
  archived session ends only its thread, and an archived channel task is replaced on the next
  message.
- A mode change between two messages: the first thread keeps its mode.
- Turns: two owner messages during one turn run in order, and guests attach to the next turn only.
- Reactions and the status line through a full turn, a failed turn, a cancelled turn, and a `429`.
- Answers: key values removed, Markdown converted, a long answer cut with its link, and an empty
  answer.
- Mirroring: an Acorn turn posts both messages, and a plugin note posts nothing.
- Restart: a turn that completes while the Node is down posts once after it returns.

## Checkpoint

In `pnpm dev:agent` with the stand-in, mention the bot as the owner in a tasks channel and run a turn
that reads files. Add a guest reply, then send a second owner message. Send two DMs and check that
they made two sessions in one "Slack DM" task. Type a turn in the desktop composer. Restart the
Node during a turn. Check the fake Slack's calls against [the rules](./rules.md) and record the date
and the result here.
