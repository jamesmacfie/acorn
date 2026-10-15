---
title: Steering, queues, and follow-ups
description: Send a message while an agent works, queue the next one, set a goal, and see what plugins add after a turn.
sources:
  - docs/managed-agents/steering.md
  - docs/managed-agents/operations.md
  - docs/managed-agents/unattended-follow-ups.md
  - docs/managed-agents/composer.md
  - docs/managed-agents/session-messages.md
  - plugins/agents/src/shared/concurrency.ts
checked: 52225e24f
---

This page covers what happens when you write to an agent that's already working: queueing a message,
steering it into the running turn, setting a goal the agent keeps working toward, and the follow-ups
a plugin can add to an unattended turn.

## Queue a message

While a turn runs, press Enter or click **Send** as usual. The message goes into **Queued follow-ups**
above the message box, which reads "Sends when the current turn finishes." Each queued row has:

- **Steer now**, which hands it to the running turn.
- **Edit queued prompt**, and **Remove queued prompt**.
- **Move queued turn up** and **Move queued turn down**, to reorder the queue.

One turn runs per session at a time, and the queue sends in order. Queued rows stay put if the app or
the Node restarts.

## Steer a running turn

Steering hands your message to the turn the agent is running, so it reads it at its next step instead
of after the turn ends.

1. While a Claude Code or Codex turn runs, type your message.
2. Click **Steer** beside **Send**. Or click **Steer now** on a row you already queued.

The row reads "Steering. The agent reads this after its current step." When the agent takes it, the
row leaves the queue and the message shows in the transcript where the agent read it, labeled
**Steered**. If the turn ends first, the row reads "The turn ended first, so this sends as the next
turn."

A steered message runs under the running turn's settings, and its tokens count toward that turn. The
pickers' values on the queued row don't apply.

Enter keeps queuing, so a habit of typing the next request while you wait never redirects an agent
mid-task.

## Set a goal

A goal is a completion condition, such as "the tests pass and the branch is pushed". After each turn,
acorn checks the conversation against the goal and, while useful work remains, queues another turn
labeled **Goal**.

1. Click **Goal** below the message box, or run **Set session goal** from the command palette.
2. Write the condition, up to 2,000 characters, and save it.

If the session is idle, the goal becomes its first turn. The row above the message box shows the goal,
its status, the last check's reason, and how many turns it has added. **Edit** changes it, **Clear**
removes it, and a paused goal offers **Resume**.

The check is a short call on the session's own harness, reading recent messages and shortened tool
output. Claude Code uses its `haiku` model for it. A goal stops after eight added turns, or after two
goal turns in a row with no tool call or file change. **Stop** pauses it. A restart or a lost
connection during a turn pauses it too.

Goal turns use the same queue and count against the same limits as yours.

## Limits on turns at once

**Settings** > **Agents** > **Limits and cost** caps how many turns run at once across the Node:

- **Turns at once per provider**, 2 by default, counts one CLI, such as Claude Code, across every task.
- **Turns at once per workspace**, 3 by default, counts every CLI in one workspace. With projects
  kept separate, it reads **per project**.

A turn over either limit waits in the queue. Raising a limit lets waiting turns start at once.
Lowering one leaves running turns alone.

## Plan usage limits

When an agent runs out of plan usage and the harness reports when it resets, acorn puts the turn back
in the queue and continues it in the same session after the reset. The transcript says when. You can
remove the queued card to give up. Turn off **Continue when usage resets** under **Harnesses and
defaults** to fail the turn instead.

## Follow-ups after an unattended turn

A workflow step or a delegated agent has someone waiting on its result: the workflow run, or the agent
that delegated it. A plugin can add a note to that session about the finished turn, such as a review
that found a problem. The agent answers it in a new turn, labeled "From" and the plugin's ID, and the result
waits for that turn before it reports.

A plugin that reviews turns this way gets a window of 30 seconds after each finished turn, and one
window per result. Its trust prompt shows the power, marked high: "Review your workflow and delegated
agents' finished turns before they report, which can hold their results and add turns on your agent
provider". A note's own turn never opens another window, so a reviewer can't loop.

The notes' turns count toward the step's usage and its budget.

## In the terminal

The terminal client draws the same queue, **Steer**, **Steer now**, and goal controls, from the same
code.

## Limits

- Only a person steers. Workflow turns, goal turns, plugin notes, and delegated sessions keep queuing.
- Harnesses other than Claude Code and Codex can't be steered. Their messages queue.
- There's no "stop and send". Use **Stop**, then send.
- A goal can't be set on a workflow, delegated, imported, or archived session, or while a terminal
  holds the session.
