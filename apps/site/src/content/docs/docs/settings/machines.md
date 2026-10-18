---
title: Machines
description: Every setting in the Machines group, for your Nodes, security and backup, the audit log, telemetry, and storage.
sources:
  - docs/frontend/settings-groups.md
  - docs/security/security-diagnostics.md
  - docs/security/secret-publication.md
  - docs/security/instruction-review.md
  - docs/managed-agents/read-block.md
  - docs/telemetry/model.md
  - docs/managed-agents/operations.md
  - packages/client-core/src/features/settings/corePages.ts
  - packages/client-core/src/features/settings/nodes/NodesSettings.tsx
  - packages/client-core/src/features/settings/nodes/NodeReachSetting.tsx
  - packages/client-core/src/features/settings/nodes/NodePowerSetting.tsx
  - docs/node-distribution/keep-awake.md
  - packages/client-core/src/features/settings/SecuritySettings.tsx
  - packages/client-core/src/features/settings/StorageSettings.tsx
  - plugins/agents/src/shared/sessionDefaults.ts
  - plugins/sentry-telemetry/acorn-plugin.config.mjs
covers:
  - nodes
  - security
  - audit
  - telemetry
  - sentry-telemetry
  - storage
checked: 'adb301ec6'
---

This page lists every setting in **Settings** > **Machines**. **Nodes** is stored on **This device**,
because it's the list of Nodes this device is paired with. Every other page is stored on the Node, and
with more than one Node, its header picks which one.

## Nodes

The Nodes this device is paired with, each with its address and whether it's live ([Pair a device or a
remote Node](/docs/nodes/pair-a-device-or-a-remote-node/)).

| Setting | What it changes | Stored on | Default |
| --- | --- | --- | --- |
| **Add a node** | Pairs this device with another Node: its **Node address**, the **Pairing code** it shows, a **Name for this computer**, and a **Name for this node**. | This device | |
| **Rename** | What this device calls the Node. | This device | The name given when pairing |
| **Reconnect** | Connects again to a Node that dropped. | | |
| **Pair another client** | Shows a one-time code to pair another device with this Node. | | |
| **Pair a browser** | Shows a one-time code for the browser extension. | | |
| **Reachable from other machines** | Only on the row for this computer. Lets other computers on your network reach its Node, at an address or **Host name** you pick. Saving restarts the Node ([Let other machines reach the Node](/docs/nodes/pair-a-device-or-a-remote-node/#let-other-machines-reach-the-node)). | Node | Off |
| **Keep this computer awake while agents work** | Keeps the Node's computer from sleeping when idle while an agent works or waits for you, or a workflow runs. A closed laptop lid can still sleep it. Says **Unavailable on this computer** when the computer won't allow it ([Keep the computer awake](/docs/nodes/run-a-standalone-node/#keep-the-computer-awake)). | Node | On |
| **Unpair…** | This device forgets the Node and what it cached from it. The Node keeps this device paired. | This device | |
| **Revoke** | The Node deletes this device's credential, and this device forgets the Node. Coming back takes a new pairing code. | Node | |

Unpair and revoke are labeled differently on purpose: revoking your only device on a remote Node can
lock you out of it.

## Security and backup

[Security diagnostics](/docs/security/security-diagnostics/) covers the page's report.

| Setting | What it changes | Stored on | Default |
| --- | --- | --- | --- |
| **Full-disk encryption** | Shows whether the Node's disk is encrypted. Nothing to set. | | |
| **Block publication with secret findings** | Stops a commit, push, export, or send when a likely secret is found, until you allow it once. | Node | Off |
| **Check instruction files before each agent turn** | Stops a turn when an instruction file or skill holds hidden characters. | Node | Off |
| **Review changed instruction files** | Asks you to approve instructions and skills before agents use them, and when they change. **Project** and **Review instruction files** open a project's review. | Node | Off |
| **Keep agents out of Acorn's data folder** | Runs Claude Code agents in its sandbox, kept out of the data folder and writing only in their worktree. Applies from each agent's next start. | Node | Off |
| **Check this node** | Reports on the Node's security settings, for the optional **Project**. | | |
| **Save to**, under **Backup** | Where **Back up this node** saves the Node's data, on the Node's computer. | | A dated file the Node suggests |

[Credentials and secrets](/docs/security/credentials-and-secrets/),
[Permissions and approvals](/docs/agents/permissions-and-approvals/#check-instruction-files), and
[What acorn doesn't protect against](/docs/security/what-acorn-doesnt-protect-against/) explain the
switches.

## Audit log

**Recent activity** lists the Node's security decisions, newest first, and **Refresh** reads it again.
Nothing to set ([The audit log](/docs/security/the-audit-log/)).

## Telemetry

| Setting | What it changes | Stored on | Default |
| --- | --- | --- | --- |
| **Collect timings, logs, and errors on this node** | Collects telemetry records on the Node. Nothing leaves it without a sink set up. | Node | Off |

**What this node has collected** counts records since the Node started
([Telemetry and privacy](/docs/security/telemetry-and-privacy/)).

## Sentry export

The Sentry export plugin's page: which kinds of record go to your Sentry project, and how much detail.
It's stored on the Node, and its settings are listed on
[Telemetry and privacy](/docs/security/telemetry-and-privacy/#send-telemetry-to-sentry).

## Storage and memory

What the Node holds in memory and on disk. Nothing to set except:

| Setting | What it changes | Stored on | Default |
| --- | --- | --- | --- |
| **Stop idle agents now**, under **Agents** | Stops idle agents at once, by the same rules as the idle limits. Shown when some would stop. | | |
| **Clear this node's copy**, under **Saved cache on this device** | Deletes this device's saved copy of what it loaded from the Node. | This device | |

The **Agents** section shows running and idle agents, their memory, and the size of attachments and
artifacts, with a link to **Harnesses and defaults**. **Node process** shows the Node's own memory, and
**Disk** shows the core database, each plugin's database, and the blob cache.

## In the terminal

These pages open in the desktop app. To pair the terminal client with another Node, start it with
`acorn --node <address>`. **Sentry export** isn't listed in the terminal client.
