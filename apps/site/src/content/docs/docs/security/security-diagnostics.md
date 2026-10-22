---
title: Security diagnostics
description: What Settings > Security and backup reports about a Node, such as disk encryption and its security settings, and what it can't tell you.
sources:
  - docs/security/security-diagnostics.md
  - docs/security/audit.md
  - docs/managed-agents/read-block.md
  - packages/client-core/src/features/settings/SecuritySettings.tsx
  - packages/node-core/src/server/storage/diskEncryption.ts
checked: '1b62b6dfb'
---

This page covers what **Settings** > **Machines** > **Security and backup** tells you about a Node: its
disk encryption, and a check of its saved security settings. Read it after you set up a Node, and
whenever you're unsure what an agent on it can reach.

With more than one Node, the page's header picks which Node it checks.

## Disk encryption

**Full-disk encryption** says **On**, **Off**, or **Can't tell**:

- On macOS, the Node asks `fdesetup` whether FileVault is on.
- On Linux and Windows it says **Can't tell**, because a check could easily give a confident wrong
  answer.
- A check that fails also says it can't tell, never **Off**.

When it's **Off**, the page warns: acorn encrypts your credentials and backups, but your code, terminal
history, and agent transcripts are only as safe as the disk.

## Check this node

Under **Security check**, **Check this node** reads the Node's saved settings and reports on them:

1. Pick a **Project** to include its instruction checks and package policies, or leave it on **Node
   settings only**.
2. Click **Check this node**.
3. Read **Needs attention** first, then **Your settings**. Each card explains a finding and names the
   action that fixes it, such as **Review tool permissions**.

The check covers:

- **Your agent settings**: the instruction file checks, **Keep agents out of Acorn's data folder**, and
  which harnesses can enforce it.
- **Tool access**: how many of acorn's agent tools are allowed and blocked.
- **Your MCP servers**: whether each was installed from a pinned package, has your consent, and has its
  tools reviewed, with server names shortened.
- **Plugins**: how many have executable grants, are in development mode, have skills approved or
  waiting, or have changes waiting.
- **The Node's keys**: whether the desktop app delivered them sealed, or the Node read them from plain
  files or its environment, and any plain key file left in the data folder.
- **The project's packages**, when you picked one: npm or pnpm settings such as install script
  suppression, build approvals, and minimum release age.

Checks that couldn't run are counted at the top and listed under **Not verified**. **Technical
details** on a card holds the evidence and its limits. **What this check cannot tell you** lists the
general limits.

The check starts no agent, runs no command, connects to no server, and tests no credential. It returns
no argument, header, environment value, or credential. The report stays on the page for five minutes
and is never stored.

## Other controls on the page

The same page holds the settings the checks report on:

- **Block publication with secret findings**
  ([Credentials and secrets](/docs/security/credentials-and-secrets/#block-publication)).
- **Check instruction files before each agent turn** and **Review changed instruction files**
  ([Permissions and approvals](/docs/agents/permissions-and-approvals/#check-instruction-files)).
- **Keep agents out of Acorn's data folder**
  ([What acorn doesn't protect against](/docs/security/what-acorn-doesnt-protect-against/#agents-read-what-you-can-read)).
- **Backup**, which saves the Node's data to one file **Save to** names, on the Node's computer.

## In the terminal

**Security and backup** opens in the desktop app, on a device paired with the Node.

## Limits

- A finding is evidence, not a score. The report never says a Node is safe.
- A missing observation doesn't mean a setting is unsafe, and a passed check isn't permission to trust
  a server or a plugin.
- It reads saved settings, not a running session's permission mode or tool limits.
- It can't see global harness configuration, such as your own Claude Code or Codex settings.
- Its record of each task's last pre-turn check is kept in memory, so a restart clears it.
