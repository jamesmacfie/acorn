---
title: What acorn doesn't protect against
description: The threats outside acorn's model, in plain words, and what you can do about each.
sources:
  - docs/security.md
  - docs/security/credentials.md
  - docs/managed-agents/read-block.md
  - docs/managed-agents/permission-policy.md
  - docs/security/node-plugin-security.md
  - docs/security/secret-publication.md
checked: '9aaaaf7d3'
---

This page lists what acorn's security model leaves out, so you can decide what else you need. The
other Security pages say what acorn does protect, and how.

## It's built for one person

acorn has no users, roles, or permissions between people. A paired device has full owner authority on
its Node. Anyone with your unlocked laptop, or a copy of a device token, is you to acorn.

## Agents read what you can read

An agent runs shell commands as your own user on the Node's computer. Its acorn token is scoped to one
task, but that only limits what it can do through acorn. File permissions don't stop your own
processes, so an agent's shell can read:

- Anything your user can read: `~/.ssh`, `~/.aws`, your browser profiles, other repositories.
- acorn's data folder: other sessions' token files, the task and transcript database, and the Node's
  TLS private key. Another session's token lets an agent act in that session's task.
- The Node's keys, wherever they're plain files: every development build, a packaged build whose
  keychain refused them, and every standalone Node.
- The device token the command line, the terminal client, the phone gateway, and the browser bridge
  keep as a plain file in their config folder. With it, an agent is you to acorn.

**Keep agents out of Acorn's data folder**, under **Settings** > **Machines** > **Security and backup**,
closes the data folder and the clients' config folders for Claude Code sessions, using Claude Code's
own sandbox. It's off by default, because it also stops the session writing outside its worktree:

- Execute tools stop working: run targets, workflows, delegation, and the browser.
- Installs that write to a shared package store fail, as do `git push` over SSH and Git commands that
  change the repository's settings.
- On a machine that can't run the sandbox, such as Linux without `bubblewrap`, the session refuses to
  start rather than running unconfined.

Codex and plugin harnesses can't enforce it. Their agents can read the whole data folder either way.

Turn it on for work you don't trust, such as agents reading issues from outside contributors.

## An agent can wait for a restart

Even with the data folder closed, an agent that ran before can leave a file behind for the next start,
such as a `.env` in the data folder that the app loads. That's persistence as your own user, which no
desktop app can rule out. The audit log records a key check that fails at start, and **Check this
node** shows a plain key file in the data folder.

## A refused command isn't containment

Permission requests, plugin policies, and acorn's tool tiers decide what an agent may do through the
channels they see. An agent can do the same thing another way: a refused `rm -rf` can come back as a
script. Requests a harness answers itself, or that its own settings already allow, never reach acorn.

## The Node's own computer

acorn doesn't defend a Node against root, other users on the same computer, or a compromised account.
A compromised Node can harm the computer it runs on. Your devices still treat its answers as untrusted,
and run its plugin code only after you approve it.

## Built-in plugins aren't sandboxed

Plugins compiled into acorn are part of the app and run with its access. Only plugins you install run
in the sandbox and the permission-scoped worker.

## The Node-side worker isn't a sandbox for hostile code

An installed plugin's Node-side code runs under Node.js's permission model, which Node.js calls a seat
belt, not a sandbox. It fences a careless or overreaching plugin. A determined hostile plugin is a risk
you take when you install it. Nobody but you reviews a plugin.

## Prompt injection

An agent reads untrusted text: issues, pull requests, web pages, other agents' reports. acorn marks
text from those sources as material rather than your instruction, and can check instruction files for
hidden characters. It can't stop an agent from being persuaded. A plugin's skills and a custom agent's
instructions are text your agents follow, by design.

## Secrets that leave another way

The secret check covers acorn's own commit, push, export, and send. It doesn't see a `git push` in a
terminal, an agent's own upload, another MCP server, or the text of a message. A finding revokes
nothing: rotate a credential that may have left your machine with its provider.

## Your disk

acorn encrypts stored credentials and backups. Your code, terminal history, and agent transcripts are
only as safe as the disk. Turn on full-disk encryption on every computer that runs a Node.

## The audit log can be edited

The audit log isn't tamper-evident. Anyone, or any agent, that can write the Node's database file can
change it.
