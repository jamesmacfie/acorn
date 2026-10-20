---
title: Delegation and subagents
description: Let an agent hand work to another agent, in the same task or in a child task with its own worktree.
sources:
  - docs/managed-agents/delegation.md
  - docs/managed-agents/subagents.md
  - docs/agent-tools/orchestration.md
  - docs/managed-agents/defaults.md
  - docs/notes-and-memory.md
checked: '70489f534'
---

This page covers two ways one agent hands work to another. In _delegation_, an agent starts another
managed session through acorn's tools, and that session reports back. A _subagent_ is the harness's
own helper, such as Claude Code's `Agent` tool, which acorn shows but doesn't run.

## Turn delegation on

Delegation uses five tools: `agent_spawn`, `agent_prompt`, `agent_wait`, `agent_read`, and
`agent_cancel`. They're in the **Execute tools** tier, which is off by default.

1. Open **Settings** > **Agents** > **Tools and permissions**.
2. Turn on **Execute tools**, or turn on just the five `agent_` tools under **Tools**.

A session started after the change has the tools. An agent then delegates when you ask it to, or
when its own instructions say to.

## Where the child runs

The agent chooses one of two places when it calls `agent_spawn`:

- **The same task.** The child is another session in the task's Agent pane, working in the same
  worktree.
- **A child task.** acorn creates a new task with its own branch and worktree, started from the
  project folder's `HEAD` or from a local branch the agent names. Uncommitted changes don't carry
  over. The child task shows in the task list like any other.

The child runs on a harness, model, and effort chosen in this order: what the call asks for, then a
[custom agent](/docs/agents/custom-agents/) it names, then **Spawned agents** under **Harnesses and
defaults**. That setting's **Inherit from parent** copies the parent's harness, model, and effort, and
is the default.

A child also gets a copy of the notes included in the parent task's context, in a **Notes · attached**
fold in its transcript ([Notes](/docs/using/notes/)).

## Follow a child

In the Agent pane, a child sits under its parent with an inset rule, and shows its depth and where it
runs. Above the parent's message box, one row per running child shows its title and state. Click a row
to open that child, in its own task if it has one. Each child links back to its parent.

A child is a managed session like any other: you can read its transcript, type into it, answer its
requests, and stop it.

## Reports back

When a child's turn ends, acorn queues one turn on the parent with the result: the child's title, how
the turn ended, any error, and the end of its final message. The transcript labels it "From" and the
child's title. The report waits behind the parent's own work and doesn't interrupt a running turn.

The child's final message reaches the parent marked as text it didn't write, so a hostile page the
child read can't pass as an instruction. A child is told to end its turn with a question instead of
asking you.

When a child stops on a permission or a question, the parent gets a short note saying so. You answer
the request in the child's pane. No agent can approve it.

A turn you type into a child's pane doesn't report to the parent.

## Limits on a delegation tree

- A child can start one more level. A third level is refused.
- Each top-level session can have at most 12 live delegated sessions under it. A child stopped for
  being idle stops counting.
- A child's acorn tools are at most its parent's, and can only narrow.
- Only the direct parent can prompt, wait on, read, or cancel a child.
- A workflow step's session can't delegate.
- The usual turns-at-once limits under **Limits and cost** still apply.

## Subagents

Claude Code and Codex can run their own subagents inside a turn. acorn records each one and draws it
as one card in the parent's transcript and one indented row in the session list. The card starts open
while the subagent works, and shows its status, role, and model.

Select the row, or **Open** on the card, to read the subagent's own run, with a way back. The message
box hides there, because neither harness lets you reply to a subagent.

What you see depends on the harness:

| | Claude Code | Codex |
| --- | --- | --- |
| Its tool calls, live | Yes | Yes |
| Its prose, live | No | Yes |
| Its file changes, live | Yes | Yes |
| A stop control | No | **Stop** in the header, with the child selected |

A Claude Code subagent started in the background keeps working after the parent's turn ends. acorn
treats it as working while its tool calls keep arriving, and marks it idle after a quiet minute.

## In the terminal

The terminal client draws the same nested rows, the child rows above the message box, subagent cards,
and subagent views.

## Limits

- A subagent isn't a session. You can't send it a turn, fork it, or hand it to a terminal.
- A child that reports after its parent was archived, or once the parent already holds 100 reports,
  queues no report. `agent_read` still returns the result.
- A plugin's harness shows its subagents as ordinary tool calls unless it reports them the way Claude
  Code does.
