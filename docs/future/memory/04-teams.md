# Phase 4: team memory

Status: proposed, 2026-10-01. Waits on [cloud phase 9](../cloud/phases/09-teams.md), which brings
invitations, roles, and route classification. Nothing here changes a local Node with no account.

## Goal

Project memory for a shared project is shared by the team. Private memory belongs to each person. Every
write says who made it, and roles decide who can write and who can undo.

## What a team gets at the end

- An agent working on a shared project, started by any member on any Node, starts with that project's
  team memory and the starting member's private memory.
- A memory one member's agent saves reaches every teammate's next session.
- The Memory page shows who wrote each memory and each change, and any member can undo a project
  change.
- Viewers can read project memory and cannot change it.
- An admin can require approval for agent writes to project memory.

## Starting point

- Phases 1 to 3: files, standing context, the tools, history, the change log, and the page.
- From the cloud programme: the team Node owns shared projects, a worker is a full Node for one task
  attempt, and grants carry a role of `admin`, `member`, or `viewer`
  ([cloud identity](../cloud/identity.md), [cloud architecture](../cloud/architecture.md)).

## Requirements

### Where memory lives

1. Project memory for a shared project lives on the team Node, in the team Node's data root. The team
   Node is the only writer of those files.
2. Private memory on a team Node is stored per account and is readable only by sessions that account
   started, and by that account on the Memory page.
3. A local Node's memory is unchanged: `~/.acorn/memory`, one owner.
4. A person can import their local private memory into their team private memory once, from the
   Memory page. Nothing syncs automatically in either direction.

### Workers

5. When a worker starts an attempt, its seed carries the shared project's memory files and the
   starting member's private memory, so standing context builds on the worker with no round trip.
6. A memory tool call on a worker is forwarded to the team Node through a versioned contract. The team
   Node applies the same checks, hash rule, history, and change log as a local write.
7. `memory_search` and `memory_get` on a worker read the seed copy plus that attempt's own writes. A
   write made by another attempt appears in sessions created after the next seed. This matches the
   snapshot rule in [the design](./design.md#when-it-is-built).

### Roles and attribution

8. A session's memory authority is the overlap of the tools' own rights and the role of the member who
   started it. An agent started by a viewer cannot write, even if the tool allows writing.
9. Every write records the account ID, the session, and the Node in the frontmatter and the change
   log.
10. Any member can undo or restore a project memory change. Only the owning account can undo a change
    to private memory.
11. The memory routes declare `read` or `mutate`, as cloud phase 9 requires of every route.

### Optional approval

12. An admin setting, **Require approval for agent writes to project memory**, is off by default.
13. With it on, an agent's project write lands as a pending file beside the real one, the transcript
    card shows **Approve** and **Reject**, and the page lists pending writes above the feed. Standing
    context does not include pending memories.
14. Private writes never need approval.

## Out of scope

- Sharing memory between teams, or between a local Node and a team Node, beyond the one-time import.
- Per-project roles.
- Merging concurrent edits. The hash rule reports the conflict and the agent retries.

## Risks

A poisoned memory now reaches other people's sessions. Attribution makes the source visible, the
write-time checks still apply, any member can undo, and an admin can turn on approval. The approval
setting is the one place this programme brings back a gate, and it is opt-in because a team that
turns it on accepts that memory will accumulate slowly again.

## Steps and checkpoints

### 1. Team Node storage

**Checkpoint 1.** On a team Node, a member saves a project memory from a task. A second member opens the
Memory page and sees it, attributed to the first.

### 2. Worker seed and forwarding

**Checkpoint 2.** Start a cloud task. Its first session lists the project's team memory without a tool
call. Save a memory from the worker. It appears on the team Node's Memory page, and a second cloud task
started afterwards sees it.

### 3. Roles

**Checkpoint 3.** A viewer's agent session fails to write, with a role error. Calling the memory write
route directly with the viewer's grant also fails.

### 4. Approval policy

**Checkpoint 4.** With approval on, an agent's project write shows **Approve** and **Reject**. A new
session does not see it until a member approves.

## Docs that change

- [Notes and memory](../../notes-and-memory.md): team scope, per-account private memory, roles, and
  approval.
- The cloud programme's [projects and tasks](../cloud/projects-and-tasks.md) and
  [identity](../cloud/identity.md), for the worker seed and the route classes.

## Verify before building

- Cloud phase 5's seed format, and whether memory files can ride in it.
- Cloud phase 9's route classification API, and where a plugin declares a route's class.
- Whether per-account storage on a team Node has an existing home, or memory is its first user.
