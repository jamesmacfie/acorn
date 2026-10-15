---
title: Harnesses and defaults
description: Which agents acorn runs, how it finds them, and what a new session starts with.
sources:
  - docs/managed-agents/harnesses.md
  - docs/managed-agents/defaults.md
  - docs/managed-agents/accounts.md
  - docs/managed-agents/operations.md
  - docs/managed-agents/history-retention.md
  - docs/managed-agents/repeated-tool-calls.md
  - docs/terminal.md
  - plugins/agents/src/shared/sessionDefaults.ts
  - plugins/agents/src/client/settings/AgentSessionDefaultsSettings.tsx
  - plugins/agents/src/client/settings/startupContext.ts
  - plugins/agents/src/client/sessions/toolFoldPrefs.ts
  - packages/client-core/src/features/settings/models/generatePick.ts
checked: 52225e24f
---

This page covers the harnesses acorn runs, how it finds each one and its login, and every default on
**Settings** > **Agents** > **Harnesses and defaults**. Read it when a new session doesn't start the way
you expected.

A _harness_ is the program acorn drives to run an agent. acorn doesn't ship one or hold its login. It
runs the CLI you already installed and signed in to.

## The harnesses

| Harness | How it runs | Where |
| --- | --- | --- |
| Claude Code | A managed session, through Claude Code's Agent Client Protocol adapter | The Agent pane, and the terminal drawer |
| Codex | A managed session, through `codex app-server` | The Agent pane, and the terminal drawer |
| Aider | Its own CLI only | The terminal drawer |

A plugin can add more harnesses. Each one shows on this page and in the **New** menu once its plugin is
on.

## How acorn finds a harness

The Node looks for each CLI on its own `PATH`: `claude` for Claude Code and `codex` for Codex. The
desktop app on macOS reads your login shell's `PATH` first, so a CLI installed through Homebrew or a
version manager is found even though the app wasn't started from a terminal.

The **Harnesses** section lists each harness with **Installed** or **Not installed**. A missing one
says why, such as `codex is not available on PATH.`, and its card in the Agent pane can't be picked.
acorn downloads nothing.

The CLI must be on the computer that runs the Node. For a remote or standalone Node, install and sign
in to Claude Code or Codex on that computer, not on the one in front of you.

After you install or sign in to a CLI, no restart is needed. The next session start checks again, and
**Refresh** in the **New** menu checks at once.

## Logins and accounts

Each CLI uses its own login. acorn never handles the token: you sign in with the CLI, and acorn starts
the CLI, which reads its own credentials.

To run a second subscription beside the first, such as a work account, add an account:

1. Open **Settings** > **Agents** > **Harnesses and defaults**, and find **Accounts**.
2. Type a name under **Add a Claude Code account** or **Add a Codex account**, and click **Add**.
3. acorn shows a sign-in command, such as
   `CLAUDE_CONFIG_DIR='…/agent-accounts/claude/work' claude auth login`. Run it on the computer the
   Node runs on.
4. Click **Check again**. The account shows as signed in.

Each account is its own config folder, so two sessions on two accounts can run at once. Your own
skills, and Claude Code's `settings.json` when the account has none, are linked into it.

Once a harness has an account, each account is its own row in **New**, labeled like
`Claude Code · work`, and the plain row goes away. Add your usual login as an account too if you want
to keep starting sessions on it. **Default account** picks the account a workflow step, a custom agent,
or an inline chat uses when it names none. **Show accounts as** draws each account by **Name** or by
**Icon**. **Remove** signs the account out and deletes its folder.

## What a new session starts with

A new session starts on the model, effort, and other options you last picked for that harness. Change
Codex to a higher effort in one session, and the next Codex session starts there.

To start every session on fixed choices instead, turn off **Carry my last session's settings forward**.
The page then shows a picker for each option each harness advertises. They read the newest session
that advertised options, so a harness you haven't run in the last 50 sessions shows none. Each pick
saves.

A fork, a workflow step, and a custom agent don't use these: a fork keeps its source's settings, a
step sets its own, and a custom agent's own options apply over yours.

## The defaults on this page

Every setting below is stored on the Node unless it says **This device**. It applies to sessions
started after the change. An open session keeps what it has, and its pickers change it.

| Setting | What it does | Default |
| --- | --- | --- |
| **Continue when usage resets** | When an agent runs out of plan usage, acorn waits for the reset and then carries on in the same session. Off, a usage limit fails the turn. | On |
| **Stop idle agents after** | Stops an agent's process after it's been idle this long. Your next message starts it again in the same conversation. 15 minutes, 30 minutes, 2 hours, or **Never**. | 30 minutes |
| **Stop idle agents above** | When running agents together hold more memory than this, acorn stops the ones idle longest. An agent that's working keeps running. 2, 4, or 8 GB, or **No limit**. | 4 GB |
| **Warn when an agent repeats a tool call** | Warns in the transcript and the bell when an agent runs the same tool with the same input this many times in a row. It stops nothing. 3, 5, or 10 times, or **Never**. | 3 times in a row |
| **Keep agent history for archived tasks** | After this long, deletes the transcripts, attachments, and files of an archived task's sessions. 30 days, 90 days, 1 year, or **Forever**. | Forever |
| **Generate with** (**This device**) | The model every Generate control opens on, such as commit messages and SQL. [Model providers and generating text](/docs/agents/model-providers-and-generating-text/) covers it. | The first backend the Node offers |
| **Carry my last session's settings forward** | Starts each session on your last choices. Off, it uses the pickers below it. | On |
| **Send task context at startup** | Sends the task's pull request, linked issues, and notes to an agent you start in the terminal drawer. | On |
| **MCP servers** | A link to **MCP**, where you choose the servers a new session starts with. | |
| **Spawn settings** | What an agent started by another agent runs on. **Inherit from parent** copies the parent's harness, model, and effort. **Use explicit defaults** shows a harness and pickers. | Inherit from parent |
| **Provider**, under **Inline diff chats** | The harness, model, and effort for a chat started from a diff line. | The first installed harness |
| **Tool call display** (**This device**) | Whether tool cards start collapsed or expanded, or carry your last toggle forward. | Start collapsed |

A process can't be stopped while it's starting, while a turn is running or queued, while a request is
waiting on you, or while a background subagent is running. Each running agent and its MCP servers
hold about 450 MB.

History is removed by a schedule that runs daily at 03:50. It keeps each session's row with a note in
place of the transcript, so the archived task still lists its sessions. You can't get the history
back.

## In the terminal

The terminal client draws **Harnesses and defaults** too: open **Open settings** from the command
palette, then **Agents**. Its sessions start on the same defaults, because the Node keeps them.
**Generate with** and **Tool call display** belong to each device, so a change on the desktop doesn't
reach the terminal client.

## Limits

- A plugin's harness can't use accounts.
- acorn doesn't move a session to another account when one runs out of usage.
- A new account starts without your MCP servers or history from the default folder.
- Aider runs only in the terminal drawer. acorn records no transcript for it.
