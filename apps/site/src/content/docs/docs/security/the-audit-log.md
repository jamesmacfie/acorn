---
title: The audit log
description: What the Node records about security decisions, for how long, and where to read it.
sources:
  - docs/security/audit.md
  - docs/security/secret-publication.md
  - docs/security/plugin-install.md
checked: 52225e24f
---

This page covers the Node's audit log: what it records, how long it keeps rows, where to read them,
and what it leaves out on purpose. Read it when you want to know who paired a device, what changed a
plugin, or which commit a secret check stopped.

## Read the log

1. Open **Settings** > **Machines** > **Audit log**.
2. **Recent activity** lists rows newest first, each with what happened, when, and who did it, such as
   "Device paired · by this node".
3. Click **Refresh** to load rows recorded since you opened the page.

With more than one Node, the page's header picks which Node's log you read. Only a paired device can
read the log. An agent's token can't.

## What it records

The Node records security decisions, not activity:

- Pairing windows opened and closed, devices paired, and devices revoked.
- Trusting a repository's `.acorn/config.toml` or workflow files.
- A commit, push, export, or send stopped by a secret check, and each one you allowed.
- Credentials created, replaced, and deleted.
- Plugins installed, updated, turned on or off, reloaded, and uninstalled, and your answer to each
  review.
- Your answer to an agent's request to install a plugin, including whether it entered development mode.
- An MCP package installed at a version younger than seven days, with the reason you gave.
- Backups.
- Attaching to and detaching from a control plane.
- A key check that failed when the Node started.

A plugin can add its own kinds of row, which it declares in its manifest. The Node names each one after
the plugin, so a plugin can't write a row that looks like acorn's own or another plugin's. A row holds
short labeled values the code chose, never a request body, a credential, or a file's contents.

## How long it keeps rows

Rows are kept for 90 days. A schedule runs daily at 03:20 to remove older ones, listed under
**Settings** > **Automation** > **Schedules** as **Prune the audit log**.

## What it leaves out

**Using a credential isn't recorded.** Every refresh of a provider's data reads a token, so recording
reads would turn the log into a request log and bury the decisions. Recording only some reads would
look complete when it isn't.

**Agent turns, tool calls, and file changes aren't in it.** Those are in each session's transcript
([Search agent history](/docs/agents/search-agent-history/)).

## In the terminal

**Audit log** opens in the desktop app.

## Limits

- The log can't prove it wasn't changed. Anyone who can write the Node's database file can edit it,
  and an agent runs as your user.
