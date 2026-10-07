# Unattended follow-ups

A workflow step or a delegated turn has an owner waiting on its result: the step's run, or the
managed agent that delegated it. A plugin's note on that session joins the owner's _operation_, and
the owner doesn't publish until the note's turn has settled. A plugin can also review the finished
turn before the owner reports it, through `agents:turn-follow-up`. This page covers both. Notes
themselves are in [session messages](./session-messages.md).
`plugins/agents/src/contract/turnFollowUp.ts` declares the point, and
`plugins/agents/src/server/sessions/turnFollowUps.ts` runs the operations and windows.

## Send a note about an unattended turn

Name the turn the note is about as `originTurnId`:

```js
await messenger.queue({ taskId, sessionId, originTurnId: turnId, subject: 'advisor blocker', text, idempotencyKey })
```

The host finds the operation from that turn. A note about a note, or about a step's continuation,
joins the turn it follows. An operation exists only while its owner waits:

- **A workflow step** opens it when it queues its first turn, and closes it just before it returns
  its result. The operation lives in memory in the step's `agents.sessionExecute` call, so a step that
  isn't running has none.
- **A delegated turn** has one while the turn's `reportTo` session is waiting for the report: the
  report isn't queued yet, the owner didn't cancel the turn, and the owner isn't archived or failed.
  That's read from the database on every note, so it survives a restart. A delegated turn with a
  terminal owner has no report and takes no notes.

Anything else is `operation-closed`: no `originTurnId`, a turn in another session, a finished or
cancelled operation, and a reviewer's note after its window closed.

The note's turn has source `plugin` and `effectivePolicy.followUpOf`, the owner's turn id. It takes
the owner's model, effort, provider options, workflow run and step ids, and result schema. It never
takes `reportTo`. The tool ceiling is the session's, so a note can't widen it. When the operation has
a result schema, the visible text asks the agent to end with the `json` result block again, because
its reply replaces the result. The 20-note cap per plugin per session still applies.

## Review a finished turn

Declare the point in the manifest with no carrier, like the messenger:

```json
{ "id": "review", "point": "agents:turn-follow-up", "label": "review a finished turn" }
```

The trust prompt shows "Review your workflow and delegated agents' finished turns before they
report, which can hold their results and add turns on your agent provider", marked high. Then file
the reviewer from the node half:

```js
ctx.extensionPoints.handle('agents:turn-follow-up', {
  id: 'review',
  value: { review: async (window) => { /* read, decide, maybe queue one note */ } },
})
```

The window is `{ taskId, sessionId, turnId, owner, deadline, signal }`. `owner` is `workflow` or
`delegation`. It carries the turn's address, not its transcript. Read the turn with
`agents.reviewInput.v1`, and send a note with `originTurnId: window.turnId`.

The owner opens one window per operation, after its own turns finish with an answer, and only for a
`completed` turn. It snapshots the reviewers filed at that moment and calls each one. The window
closes when every `review` settles, or at the deadline, whichever comes first:

- The deadline is 30 seconds. A workflow step with less of its timeout left gets what's left.
- At close, the host aborts `window.signal`, and refuses each reviewer's later notes. A reviewer that
  throws or never answers is recorded and doesn't hold the owner past the deadline.
- A note's own turn never opens a window, so a reviewer can't review its own correction.
- The outcome is saved in the agents operations table under `turn-follow-up:<turn id>`, as
  `reviewed`, `timed-out`, `cancelled`, or `skipped`, with each reviewer's `done`, `failed`,
  `timed-out`, or `cancelled`. A recovered owner finds the row and doesn't review again.

A window is lifecycle participation, not an approval gate. It can't refuse a result, interrupt a
running turn, or start a chain: a reviewer gets one window per operation.

## How the owner finishes

After the window, the owner waits for every note's turn to settle, then closes the operation and
waits for a note that was being admitted at that moment. Waiting never holds the provider queue: the
workflow step polls its own turns, and a delegated report runs from the settled-turn broadcast.

- **A workflow step's result** is the last turn's: the reply to the last note, if one joined. Its
  structured output is parsed from that reply. If the reply has no result block, the continuation
  prompt asks for one, up to the step's two continuations.
- **A delegated report** is queued once, after the notes' turns, with the last turn's outcome and
  message. It says a plugin sent notes, and names the turn the message came from.

Cancellation flows from the owner. A cancelled workflow step closes its operation, aborts a running
window, and cancels every turn it owns, notes included. An owner's `agent_cancel` on a note cancels
the whole delegated operation, and no report is sent. A restart ends every workflow step's
operation, so startup cancels the notes still queued on workflow sessions. The step reruns as a new
turn. A delegated operation carries on after a restart: the startup pass reopens it, finds the saved
review, and waits for the notes before reporting.

## Usage

A step's usage covers every turn it owns: its own, its continuations, and the notes that joined it.
Per-turn providers such as Claude are summed. Codex counts a thread cumulatively, so the last turn's
report already includes the earlier ones and isn't summed. A turn that reported nothing adds nothing,
and a value no turn reported stays unknown. The workflow's budget sees that total when the step
settles, so a correction can push a step over its budget, and the safety rail then fails the step
with its message.

A reviewer's own model calls aren't agent usage. A loaded reviewer that generates with no `backendId`
is charged to its [model grant](../integrations/model-providers.md#plugin-model-grants), and an
exhausted grant refuses the call with `provider_budget_exhausted`. The review records that as a
failure, and the step finishes without a note. Each note it does send adds an agent turn, which the
step's usage counts.
