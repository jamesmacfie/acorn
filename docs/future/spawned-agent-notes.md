# PRD: Include notes in spawned Acorn agents

Date: October 12, 2026. Status: implemented October 12, 2026. Acceptance is open for real managed
Claude and Codex runs and the real-app checks under [release and validation](#release-and-validation).
The shipped behavior is in [notes in delegated agents](../notes-and-memory.md#notes-in-delegated-agents).

This PRD defines automatic note snapshots for managed agents started through `agent_spawn`, with
shared or worktree isolation. Read it before implementing note inheritance in managed delegation.

## Problem

Acorn attaches task notes to managed chats started from the task UI. Spawned agents bypass that
attachment path and receive the parent's spawn prompt and delegation instructions.

This means guidance such as "Do not create subagents unless specifically asked" can disappear during
delegation. Shared agents can retrieve the notes themselves, but worktree children belong to a
separate task whose notes do not include the parent's task notes.

Users should not need to repeat included notes in every delegation prompt.

## Desired outcome

Every spawned agent starts with an immutable snapshot of the notes relevant to its work, including
guidance inherited from its parent.

The behavior works from managed chats and terminals, without requiring an open Context pane or an
additional tool call from the child.

## Product behavior

| Spawn mode | Automatically attached notes |
| --- | --- |
| Shared | Included notes from the shared task, its workspace, and global scope. |
| Worktree | Included parent task notes, plus included notes from the child task, its workspace, and global scope. |
| Nested delegation | Applicable inherited notes, plus the spawning task's included notes and the destination task's applicable notes. Duplicate sources appear once. |

Inheritance attaches a snapshot to the child's first turn. It does not copy note files into the child
task or give the child access to the parent's note store.

For example, a worktree child receives the parent task's included "Git branches" note alongside the
spawn prompt. The attachment identifies that note as inherited from the parent task.

## Requirements

### Inclusion rules

Apply these rules when assembling the snapshot:

- A note's **Include in context** flag determines whether it is eligible.
- Empty and excluded notes are omitted.
- Workspace notes retain the filtering that excludes notes belonging to another task.
- Notes are identified by their full scope, owning task or workspace, and slug. Matching titles or
  slugs across different scopes do not make them duplicates.
- When the same source appears through multiple inheritance paths, attach it once. A fresh capture
  of that source replaces its inherited copy.

For this release, spawning uses the Node's note inclusion flags. The Context pane's device-specific
section selection does not control headless spawning. Help text must make this distinction clear.

### Snapshot lifetime

Capture notes before accepting the child's first turn, and persist the attachment with that turn.

Retries, provisioning recovery, and session resumes reuse the accepted snapshot. Editing or deleting
a note does not rewrite a child's history.

Later `agent_prompt` calls do not automatically refresh the snapshot in this release. A newly spawned
session captures fresh notes. Nested delegation carries forward inherited snapshots and captures the
direct parent's applicable notes at that spawn.

### Presentation and provenance

The child transcript displays an expandable **Notes · attached** context card containing:

- Each note's title and body.
- Its scope and source task when inherited.
- The capture time.
- Any truncation, omissions, or unavailable sources.

The attachment explicitly distinguishes the child's task from the task supplying inherited notes.
Inherited notes must not imply that the child owns the parent's branch or worktree.

Notes remain supporting context, subject to the same instruction precedence as notes attached to
interactive chats.

### Budgets and failures

Use the note context budgets and formatting rules. Deduplicate before applying one combined budget;
adding another ancestor must not multiply the available budget.

Truncation and omitted-note counts must be visible to the child and in the transcript.

If Notes is disabled, spawning continues without a notes attachment. If Notes is enabled but capture
fails unexpectedly, the first turn must wait or fail with an actionable error. It must not silently
start without expected guidance.

## Architectural approach

Capture notes in the Node delegation path so shared, worktree, terminal-owned, and recovered spawns
use the same behavior.

Notes owns note eligibility, reads, and formatting. Agents owns delegation lineage, snapshot
persistence, and delivery. Connect those owners through a typed capability or the context assembly
seam.

The relevant owners are:

- `plugins/agents/src/server/delegation/service.ts`: shared spawning and owner checks.
- `plugins/agents/src/server/delegation/worktreeProvisioning.ts`: recoverable child task provisioning.
- `plugins/agents/src/server/delegation/reports.ts`: delegated turn input and report instructions.
- `plugins/notes/src/node/index.ts`: note eligibility and scope resolution.
- `plugins/notes/src/server/contextSection.ts`: note context formatting and budgets.
- `packages/node-core/src/server/agentTools/contextSections.ts`: context hooks and assembly.

The implementation must:

- Derive source tasks from verified delegation ownership.
- Preserve context hooks, filtering, and size limits.
- Store inherited context as typed turn attachments with provenance.
- Keep child task credentials confined to the child task.
- Avoid reading note files directly from the Agents plugin.

The persisted snapshot must be committed before the first turn becomes dispatchable. Recovery must
not substitute a different snapshot after that turn has been accepted.

## Out of scope

This release excludes:

- Inheriting the parent's conversation.
- Automatically attaching PRs, linked issues, or every Context pane section.
- Copying notes into child tasks.
- Changing standing memory behavior.
- Refreshing notes during active child turns.
- Changing provider-native subagents.
- Adding spawn-time configuration or another Settings switch.

## Acceptance criteria

Verify these behaviors before release:

1. A shared spawn receives included task, workspace, and global notes without calling `task_context`.
2. A worktree spawn receives included parent task notes with clear provenance.
3. Excluded, empty, and unrelated task notes are absent.
4. Nested delegation preserves inherited guidance without duplicate notes.
5. Identical slugs in different scopes remain distinct.
6. Editing a note after dispatch leaves the stored attachment unchanged; a fresh spawn receives
   the edit.
7. Spawn retries and Node restart recovery reuse the accepted snapshot and create no duplicate
   attachment.
8. Capture failures, disabled Notes, truncation, and omissions follow the specified behavior.
9. Real managed Claude and Codex runs receive the attachment, and the transcript displays the same
   content.
10. A child still cannot read or modify its parent's notes through its task credentials.

## Release and validation

Apply the behavior to spawns created after release. Do not backfill historical turns or inject notes
into running sessions.

Verify observable delivery with shared and worktree spawns in the real app, including a nested spawn
and a restart during provisioning. Update the [notes and memory](../notes-and-memory.md),
[managed delegation](../managed-agents/delegation.md), and
[context sections](../agent-tools/context-sections.md) documentation to explain inclusion, inheritance,
and snapshot lifetime.

Success means an included instruction reaches a spawned child without the parent repeating it or
the child requesting it. Receipt is verifiable; whether an agent follows the instruction remains
model behavior.
