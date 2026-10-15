---
title: Model providers and generating text
description: Add an OpenAI or Anthropic key, or use an installed agent CLI, for the features that write text for you.
sources:
  - docs/integrations/model-providers.md
  - docs/managed-agents/defaults.md
  - docs/managed-agents/sessions.md
  - docs/state-ownership/scope-rules.md
  - packages/client-core/src/features/settings/models/AiModelsSettings.tsx
  - packages/client-core/src/features/settings/models/generatePick.ts
checked: 52225e24f
---

This page covers what acorn uses when a feature writes text for you, such as a commit message or a SQL
query: an API key you add, or an agent CLI already on the machine. You need neither to run agents.
Agent sessions use each CLI's own login.

## What generates text

These features ask a model for text:

- A commit message in the **Changes** tab.
- **Explain commit** in the Git history.
- SQL in the Database pane, and the Database plugin's workflow step.
- A workflow draft in the workflow editor.
- A dashboard panel or saved query drafted for you.
- **Summarize run…** in an agent session's menu.

Each sends only what it needs, such as the diff for a commit message or the schema for SQL. acorn
stores neither the prompt nor the answer.

Two things in agent sessions use the session's own harness instead, and no key: a new session's short
title, and the check behind a session goal.

## Choose a backend

A _backend_ is one of two things:

- **An API key** for OpenAI or Anthropic. Calls are billed to that key.
- **An agent CLI** installed on the machine the Node runs on: Claude Code or Codex. Calls use the CLI's
  own login and plan.

**Generate with**, under **Settings** > **Agents** > **Harnesses and defaults**, sets the backend and
model every Generate control opens on. A pick in any dialog becomes the next one's default. It's this
device's choice, marked **This device**. With nothing picked, or after the picked backend goes away,
acorn uses the first backend: your first key, or a CLI when you have no key.

## Add an API key

1. Open **Settings** > **Connections** > **AI models**.
2. Click **Add a key**, then **Connect Anthropic** or **Connect OpenAI**.
3. Paste the key into **API key**, and click **Connect**. acorn checks the key with the provider
   before it saves anything.

The key is encrypted on the Node and never sent back to a device or to an agent
([Credentials and secrets](/docs/security/credentials-and-secrets/)). **AI models** lists your keys
under **API keys**, and each CLI under **Agent CLIs** as **Installed** or **Not installed**.

## Use an agent CLI instead

With Claude Code or Codex installed and signed in on the Node's computer, they show as backends with no
setup. A CLI call is kept apart from your work:

- Its tools are off.
- It runs in an empty temporary folder, so it reads no `CLAUDE.md` or `AGENTS.md` from your repository.
- It gets no acorn token, no MCP server, and none of the keys acorn holds.
- At most two run at once per CLI.

Claude Code offers its `sonnet`, `opus`, `fable`, and `haiku` aliases, and Codex the models its
app-server lists. **Use CLI default** leaves the choice to the CLI.

## Plugins that generate on their own

A plugin with the `models` permission can generate without you picking a backend. On that plugin's page
under **Settings** > **Plugins** > **Installed**, you choose the backend, the model, and a daily
allowance of output tokens. With no choice made, its calls fail. Past the allowance, they fail until
the Node's midnight.

The allowance counts output tokens, not money. A CLI call is counted as 4,000 tokens whatever it used,
because a CLI can't cap its output. A plugin that names a backend itself isn't held to the allowance.
The page counts those calls separately.

## In the terminal

The terminal client's Generate controls offer the same backends. **AI models** opens in the desktop
app.

## Limits

- A generate call stops after three minutes.
- The SQL dialog always opens on the first backend. It doesn't remember **Generate with**.
- A CLI ignores the output limit acorn asks for.
- Aider can't generate text, because it has no one-shot mode.
