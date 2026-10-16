---
title: Permissions and approvals
description: What an agent may do without asking, how you answer when it asks, and the checks acorn runs first.
sources:
  - docs/managed-agents/permission-policy.md
  - docs/managed-agents/app-access.md
  - docs/security/instruction-review.md
  - docs/agent-tools.md
  - docs/managed-agents/transcript.md
  - plugins/agents/src/client/sessions/AgentRequestCard.tsx
  - plugins/agents/src/server/drivers/codexConfiguration.ts
  - packages/protocol/src/agents/toolPermissions.ts
checked: 52225e24f
---

This page covers what decides whether an agent may act on its own: the harness's permission mode,
acorn's own tool tiers, the request cards you answer, Computer Use consent for Codex, and the check on
project instruction files. Read it before you let an agent run unattended.

Two separate things decide what an agent can do:

- **The harness** decides about its own tools: running a command, editing a file, fetching a page.
  Its permission mode says which of those it asks about.
- **acorn** decides about acorn's tools: reading the task, writing notes, starting a run target,
  spawning another agent. **Settings** > **Agents** > **Tools and permissions** says which are on.

## Permission modes

The **Mode** picker above the message box, and **Permissions** on Codex, list what the harness offers.
acorn shows the harness's own choices and doesn't add any. Claude Code offers these:

| Mode | What Claude Code does |
| --- | --- |
| **Auto** | Approves or denies each request with a classifier. Offered only on models that support it. |
| **Default** | Asks before anything risky. |
| **Accept Edits** | Makes file edits without asking, and asks about the rest. |
| **Plan Mode** | Plans without running tools. |
| **Don't Ask** | Never asks. Denies anything not already allowed in its settings. |
| **Bypass Permissions** | Skips every check. Not offered when Claude Code runs as root. |

Codex lists its **Mode** presets, such as Default and Plan, and the permission profiles its config
allows. A mode change applies from the next turn.

## Answer a request

When the harness asks, the session stops and draws a request card in the transcript, where the agent
asked. The session's row says it needs you, and the bell and the inbox say so too
([Notifications and the inbox](/docs/using/notifications-and-the-inbox/)).

1. Open the session. A **Needs you** row in the task's session list opens it at the card.
2. Read what the harness wants to do. The buttons are the harness's own choices, such as allowing once,
   allowing for the session, or rejecting. A rejecting choice is drawn as dangerous.
3. Click one. The turn carries on.

A question gets a dropdown, checkboxes, or a text box instead. Once answered, the card keeps what was
asked and what you chose. An answer marked secret reads **Answer hidden**.

Only a paired device can answer. An agent's own token can't approve its own request, and nor can
another agent's.

### When a plugin refuses first

A plugin you installed can refuse a request before it reaches you. The card then says which plugin
refused it and why, and nothing asks you. A plugin that takes longer than 5 seconds, or fails, counts
as no objection, and the request comes to you as usual. A plugin can't approve anything.

The plugin's **Permissions** tab shows this power as "Stop agents from doing …", marked high.

## acorn's tool tiers

acorn's own tools come in three tiers, set under **Settings** > **Agents** > **Tools and permissions**:

| Tier | What it covers | Default |
| --- | --- | --- |
| **Read tools** | Look at the task, notes, memory, Git, and the pull request. Changes nothing. | Always on |
| **Write tools** | Write notes, and save or delete memory. | On |
| **Execute tools** | Use the preview browser, start run targets, and spawn or prompt other agents. | Off |

Below the tiers, every tool has its own switch, grouped **By owner** or **By tier**. A tool's switch
overrides its tier. A tool that's off is gone from the agent's tool list, and a direct call is refused.

A new execute tool added in a later release stays off until you turn it on. A workflow step and a
custom agent can narrow these further, never widen them.

[Agent tools and the MCP server](/docs/agents/agent-tools-and-the-mcp-server/) lists the tools.

## Let Codex use an app

When a Codex agent asks Computer Use to operate an app, acorn draws a consent card. It names the app
and explains each choice before the buttons:

- **Allow for this session** lasts as long as the session. A fork asks again.
- **Always allow** is offered only when Computer Use allows a saved grant. It trusts that app on this
  computer from then on.
- **Decline** refuses.

Computer Use keeps the grant, not acorn. To take back **Always allow**, use Computer Use's settings in
the ChatGPT app. A grant belongs to the computer the agent runs on, so a remote Node's grants stay on
that Node's computer.

## Check instruction files

An agent reads `CLAUDE.md`, `AGENTS.md`, and skills itself, with no tool call acorn could see. Some
characters draw as nothing in an editor or a diff, so a line there can carry instructions nobody saw.
Two settings under **Settings** > **Machines** > **Security and backup** check these files before
acorn sends each turn. Both are off by default.

**Check instruction files before each agent turn** stops a turn when an instruction file or skill holds
hidden characters, and names the file and line.

**Review changed instruction files** asks you to approve the instructions and skills before agents use
them, and again whenever they change. To approve:

1. Turn the setting on. The review for the project opens.
2. Pick the **Project**, and click **Review instruction files** if it hasn't opened.
3. Read each file card. Files with highlights come first: commands, web addresses, sensitive paths,
   permission language, override phrases, and hidden characters. The highlights are hints, not
   verdicts.
4. Approve. Then send the blocked message again. acorn doesn't retry it for you.

A project whose files match an approval already made on the Node shows **Instructions already
approved**. A worktree with the same files as its project reuses the project's approval.

The check covers turns acorn sends: chats, queued and resumed turns, workflow steps, and delegated
agents. It reads root and nested `AGENTS.md`, `AGENTS.override.md`, `CLAUDE.md`, and `CLAUDE.local.md`,
their imports, and the skill folders under `.claude`, `.agents`, and `.codex`.

## In the terminal

The terminal client draws the same request cards and Computer Use card, and you answer them the same
way. The Settings pages above open in the desktop app.

## Limits

- acorn sees only what the harness asks about. A tool the harness's own settings already allow, an
  earlier "allow for the session", and a bypass mode never reach acorn.
- A refused command isn't containment. An agent can try the same thing another way.
  [What acorn doesn't protect against](/docs/security/what-acorn-doesnt-protect-against/) says more.
- The instruction check can't see a file the harness loads or changes during a turn, or global
  instructions outside the project. Text you type into a harness in a terminal doesn't pass through
  it.
- The hidden-character check also refuses text that uses zero-width joiners on purpose, such as
  Persian.
