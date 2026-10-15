---
title: Skills
description: Procedures an agent loads when a task calls for one, from your own folders or from a plugin.
sources:
  - docs/managed-agents/skills.md
  - docs/managed-agents/native-skills.md
  - docs/managed-agents/composer.md
  - docs/managed-agents/accounts.md
checked: 52225e24f
---

This page covers skills: what they are, where an agent gets them, how a session loads one, and how to
see which are on. A skill is a named procedure, such as "write a release note", that an agent reads
only when a task matches its description. Ten skills cost ten lines of context, not ten bodies.

## Where skills come from

A skill is a folder holding a `SKILL.md`: a short header with a `name` and a `description`, then the
procedure in Markdown, with any supporting files beside it. It's the shape Claude Code reads from
`.claude/skills/`.

An agent gets skills from two places:

- **The harness's own skills.** Claude Code and Codex load your skills and the repository's, as they
  would outside acorn. acorn doesn't change them. A harness [account](/docs/agents/harnesses-and-defaults/#logins-and-accounts)
  gets your own skills linked into its folder, from its next start.
- **Plugin skills.** A plugin can ship up to 16 skills. You approve them on the Node before any agent
  receives them.

## Approve a plugin's skills

A plugin with skills asks once, in its trust prompt, under **Declared**: "Adds 2 procedures your agents
can load: …". Accept it and the skills are on. Reject it and the plugin is turned off on that Node.

acorn records a fingerprint of every file in each skill. A new version that changes one byte of a
skill asks again. So does a skill folder edited on disk: until you approve the change, it isn't
offered.

## How a session loads a skill

acorn hands each session the skills that are on, approved, and unchanged, at every start and resume:

- **Claude Code and Codex** get them as real skills, named `acorn-<plugin>:<skill>`. The harness's own
  skill tool loads one when a task calls for it, and you can call one from the message box:
  `/acorn-<plugin>:<skill>` in Claude Code, `$acorn-<plugin>:<skill>` in Codex.
- **Other harnesses** get a short list with each skill's name, description, and where its file is,
  before the first turn. The agent reads the file when a task matches.

Skill bodies are never pasted into the conversation. Nothing is written into your worktree.

The transcript says what each start delivered, in one line such as "Skills the agent can load:
acorn-pi-skills:release-note (native)." When a skill goes away, the next start tells the agent it can't
load it any more.

A change applies at each session's next start or resume, never in the middle of a turn.

## See which skills are on

- **In a session**, type `/` in Claude Code or `$` in Codex. The list shows every command and skill the
  harness reported at its last start, plugin skills included.
- **For a plugin**, open **Settings** > **Plugins** > **Installed**, pick the plugin, and look at the
  **Skills** section on **Overview**. Each skill has a switch, its description, its status (ready, off,
  waiting for approval, or changed on disk), and which harnesses received it and how since the Node
  started, such as "Loaded natively by Claude Code at 04:15 PM".

Turn a skill's switch off to stop offering it without turning off the plugin.

## In the terminal

The terminal client answers a plugin's skills request in its own trust prompt. Its message box offers
the same `/` and `$` lists. Plugin pages under **Installed** open in the desktop app.

## Limits

- A long session can lose the skill list when the harness shortens the conversation. The next start
  sends it again.
- A harness without its own skill support reads a skill with its own tools, under its own permission
  prompts.
- Approving a plugin's skills doesn't approve the project's instruction files, and approving those
  doesn't approve plugin skills
  ([Permissions and approvals](/docs/agents/permissions-and-approvals/#check-instruction-files)).
