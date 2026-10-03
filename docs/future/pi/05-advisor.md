# 05. An advisor plugin

Status: proposed, 2026-10-02. Not started. Depends on [03](./03-session-messages.md) and
[04](./04-unattended-model-calls.md).

Execution handoffs, 2026-10-03: [phase 04](./phases/04-model-grants-and-advisor.md) delivers model
grants, the replacement review reader, and an interactive advisor. [Phase 05](./phases/05-unattended-follow-ups.md)
adds owned unattended review windows and follow-ups before enabling the unattended setting.

## Why

`omp`'s advisor pairs a second model with the session. It reads each turn the main agent takes and
injects a note when it sees a problem: a quiet aside, a concern, or a blocker. It runs on its own
context and often on a different model family, so it catches what the agent rushed past. The agent
reads the note and corrects course, or says why it will not.

Two reasons to build one for acorn, beyond wanting the feature:

- It is the consumer that proves [03](./03-session-messages.md) and [04](./04-unattended-model-calls.md).
  Both are seams a third party would use, and an unexercised seam rots
  ([extensibility.md § Unexercised seams rot](../../extensibility.md#unexercised-seams-rot)).
- It works for every harness. `omp`'s advisor only watches `omp`. An acorn advisor watches Claude,
  Codex, DeepSeek, and `omp` sessions the same way, which is the advantage of sitting outside the loop.

## What `omp` learned that this copies

From `advisor-watchdog.md` in the `omp` repository's docs folder, at the commit cloned on 2026-10-02:

- **Three severities.** `nit` is a non-interrupting aside, `concern` is material risk, and `blocker`
  means continuing would clearly waste work. Only blockers may interrupt.
- **A concern after a finished answer does not wake the agent.** `omp` shows it as a card instead,
  because waking an agent that already answered makes it restate the answer. Only a blocker, or work
  the agent left half done, earns a new turn.
- **An emission guard.** A repeated note is dropped at equal or lower severity, a real escalation is
  allowed through, and each review may produce at most four non-blocker notes.
- **Cooldown after an interruption.** After a concern or blocker is delivered, later concerns are held
  for a number of turns, so the advisor does not argue with every step.
- **Stop when the person stops.** When the person cancels a run, the advisor stops resuming it.

## The design

A loaded plugin, kept in its own folder outside this repository like the machine-stats plugin, with a
node half and a small tree for its settings page. Nothing about it is first-party.

### Manifest grants

- `permissions.events`: `plugin:agents:turn-changed`.
- `permissions.node.capabilities`: the phase 04 replacement `agents.reviewInput.v1`, `agents.turns`,
  and `agents.sessions`.
- `permissions.node.core`: `models`, `tasks`, `git`.
- A contribution to `agents:session-messenger` ([03](./03-session-messages.md)).
- `requires.plugins`: `agents`.

The trust prompt will show three high lines: generate text, read task git state, and send notes to
agent sessions. That is honest. Each is something the plugin does.

### The flow

1. On `plugin:agents:turn-changed` with `status: 'completed'`, skip the turn when its source is
   `plugin` or `delegation_report`. A note answering a note is a loop, and a report is another agent
   talking, not the agent at work. Skip sessions the person has not opted in (see below).
   This event flow is for interactive sessions. Unattended review uses phase 05's bounded
   completion participation so a workflow cannot publish success before admitted corrections.
2. Read the turn with `agents.reviewInput.v1`'s `read({ taskId, sessionId, turnId })`. If it is
   `unavailable`, stop.
3. Read the task root with `ctx.core.tasks`, then `git diff --stat` and a bounded `git diff` with
   `ctx.core.git.gitText` against the task's root. Cap the diff at 32 KiB and say in the prompt when it
   was cut.
4. Call `ctx.core.models.generateText` with no `backendId`, so the plugin's model grant from
   [04](./04-unattended-model-calls.md) decides the backend, model, and cap. Ask for one JSON object:
   `{ "severity": "none" | "nit" | "concern" | "blocker", "note": string }`.
5. Pass the answer through the guard: drop a repeat at equal or lower severity, drop a concern inside
   the cooldown, and drop anything when the person cancelled the session's last turn.
6. Deliver by severity:
   - `none` and `nit`: record in the plugin's own database, deliver nothing.
   - `concern`: queue a message only when the turn ended mid-work or the session is unattended.
     Otherwise record it.
   - `blocker`: queue a message through the session messenger with the turn id as the idempotency key.

`nit` delivers nothing in the first version because the only delivery acorn can offer is a turn, and
a turn costs the owner money for a cleanup hint. If [03](./03-session-messages.md) gains its held
mode, nits and finished-answer concerns can ride along with the person's next message.

### What "ended mid-work" means

The review input does not say whether the agent finished or stopped to ask. Use `stopReason` from
`agents.turns` and treat a turn that ended with a question to the person as finished. Check what each
harness reports before relying on it.

### Opting in

Off by default. The settings page has three choices: off, unattended sessions only (workflow and
delegated), and every session. A remote tree on `agents:session-header` can add a per-session mute
later. The first version keeps the choice global, because a per-session control needs the
plugin to store session ids it does not own, which is fine but is more to build.

### The prompt

Write the system prompt fresh rather than copying `omp`'s. `omp`'s prompt assumes the advisor can call
`read` and `grep` tools and steer live. This one gets a fixed bundle (the person's messages, the
agent's final message, the diff) and answers once. Tell it to stay silent unless it is sure, to prefer
`none`, and to quote the line it objects to. Put the bundle inside `pastedContent`-style fences so a
diff containing instructions reads as data.

### What the owner sees

A blocker or a qualifying concern appears in the transcript as the plugin's note, drawn by
[03](./03-session-messages.md), followed by the agent's reply. The settings page lists recorded notes
per task with their severity, so the owner can judge whether the advisor is worth its cost. That list
is also the evidence for whether the held mode is worth building.

## Cost

One generate per completed turn in an opted-in session, capped by the grant from
[04](./04-unattended-model-calls.md). A workflow with 30 agent turns spends 30 advisor calls plus one
extra turn per delivered blocker. The settings page should show the day's count beside the cap.

## Steps

1. Scaffold the plugin outside the repository with `npm create acorn-plugin` and install it by folder.
2. Build the flow above against the fake driver's sessions first, then a real Claude session.
3. Run it on one workflow and one interactive session for a day and read the recorded notes.
4. Add a manual check to [agents and providers](../../testing/agents-and-providers.md): a seeded bad
   change in a workflow session draws a blocker note and the agent answers it.
5. Mention it in [plugin-map.md](../../plugin-map.md) as the worked example of an unattended plugin, if
   it is kept.

## What this does not do

- It does not interrupt a running turn. It reviews completed turns only.
- It cannot see tool calls the agent made or read files beyond the diff. If that proves to matter,
  extend `AgentReviewInput` with bounded fields in the agents plugin, not in the advisor.
- It does not approve or refuse anything. That is [02](./02-before-permission.md).

## Verify before building

- `AgentReviewInputCapability` in `plugins/agents/src/contract/lifecycle.ts`, and that a loaded plugin
  can be granted it.
- That `turn-changed` reaches a loaded subscriber, from the `emits` list in
  `plugins/agents/src/node/index.ts`.
- What `stopReason` each harness reports on a turn that ends with a question.
- That 03 and 04 shipped as described here, and the names they shipped under.
