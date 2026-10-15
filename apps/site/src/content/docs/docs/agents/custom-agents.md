---
title: Custom agents
description: Save a harness, its settings, instructions, and tool access as an agent you can start in one step.
sources:
  - docs/managed-agents/custom-agents.md
  - docs/managed-agents/palette.md
  - plugins/agents/src/client/settings/CustomAgentsSettings.tsx
checked: 52225e24f
---

This page covers custom agents: a saved start for a managed session, with a harness, the settings it
starts on, instructions for its system prompt, and a limit on acorn's tools. Make one for a job you
start the same way every time, such as a reviewer.

## Create a custom agent

1. Open **Settings** > **Agents** > **Custom agents**, and click **New agent**.
2. Fill in the form:

   | Field | What it sets |
   | --- | --- |
   | **Name** | What **New** and the palette call it. |
   | **Description** | One line under the name in the list. |
   | **Icon** | Any icon, or reset to use the harness's icon. |
   | **Harness** | Claude Code, Codex, or a harness a plugin adds. |
   | The harness's options | Such as **Model**, **Effort**, and **Mode**. Only options you set apply. |
   | **acorn tools** | **All allowed tools**, **Read and write, but don't run anything**, or **Read only**. |
   | **Instructions** | Text added to every session started from this agent. |

3. Click **Save**.

The agent shows in the list under **Your agents**, with **Edit** and **Duplicate**.
**Delete agent** sits under **Danger zone** and asks first. Sessions already started from it keep
running.

The form saves only on **Save**, and asks before you leave it with changes.

### What each field does in a session

- **Options** apply over your new-session defaults, so an agent that sets only a model keeps your usual
  effort. The pickers show what the harness advertised in a recent session, so a harness you haven't
  run lately shows none.
- **acorn tools** is a ceiling. It narrows what **Tools and permissions** allows and never widens it.
- **Instructions** go into the system prompt on Claude Code and Codex. Any other harness gets them
  before your first message instead, and the agent can lose them when it shortens a long conversation.

A session copies the agent when it starts. Editing the agent changes sessions you start later, not
ones already open.

## Start a session from a custom agent

- **New** in the Agent pane lists your agents under the harnesses.
- With no sessions in the task, the empty Agent pane shows a card for each agent.
- The command palette's **New agent session** lists them, and each also has its own row, such as
  **New Reviewer session**, so typing its name finds it.
- An agent can start one with `agent_spawn`, naming it by ID or by name. This needs the **Execute
  tools** tier on ([Delegation and subagents](/docs/agents/delegation-and-subagents/)).

The session header shows the agent's name.

## Agents from plugins

A plugin can ship up to eight custom agents. They're listed under **From plugins**, with **Duplicate**
only: copy one to change it. They go away when you turn the plugin off.

A plugin agent's instructions go into the system prompt of every session started from it, so the
plugin's trust prompt shows them in full under **Declared**. A new version that changes one word asks
again ([Plugin trust and permissions](/docs/security/plugin-trust-and-permissions/)).

## In the terminal

**New** in the terminal client's Agent pane lists custom agents too. Create and edit them on
**Settings** > **Agents** > **Custom agents**, which the terminal client also draws. The palette's row per
agent is desktop only.

## Limits

- A workflow step can't name a custom agent. It sets its own profile and options.
- A custom agent is one session. For a job with several steps, write a workflow.
