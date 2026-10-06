# Checks on delegated work

Status: proposed, October 6, 2026. Not started. Part of the [DeerFlow review](./README.md).

## Problem and outcome

When a child session finishes, its owner gets a `delegation_report` turn that holds the child's final
message and, when the turn declared one, a validated structured result. Both are the child's own
account. A child can say it wrote a file it didn't write, or say it committed when the worktree is
dirty.

Let the owner attach a short list of checks to `agent_spawn` and `agent_prompt`. When the child's
turn settles, the Node runs each check itself and puts the verdicts in the report and in `agent_read`.
The owner then reads facts beside the child's claims.

## What DeerFlow does

A `task` or `batch_task` call can carry `acceptance_criteria` such as `file:<path> exists`,
`file:<path> non-empty`, and `file:<path> json-valid`. The host checks each one after the subagent
finishes and returns `holds`, `does not hold`, or `UNVERIFIED`. Reads authorize before resolving a
path, stay inside the shared workspace, and cap a JSON read at 50,000 bytes. An out-of-scope path, an
oversize file, or a failed read returns `UNVERIFIED` instead of a guess. There's no automatic retry.
See the "Sub-Agents" section of `references/deer-flow/README.md`.

## What acorn has already

- The delegation inputs in `plugins/agents/src/shared/delegationSchemas.ts`, whose `describe()` text
  is all an agent learns about each field.
- Report assembly in `plugins/agents/src/server/delegation/reports.ts`, with exactly-once delivery
  keyed by the child turn ID ([reports back to the owner](../../managed-agents/delegation.md#reports-back-to-the-owner)).
- `ctx.core.tasks.root(taskId)` to find a task's worktree, and the symlink-aware confinement rule
  in `packages/node-core/src/server/core/fs.ts`.
- `resultSchema` for structured output, which this design sits beside and doesn't replace.

## Scope

In scope, four check kinds:

| Kind | Holds when |
| --- | --- |
| `file-exists` | The path resolves inside the child's worktree to a regular file. |
| `file-nonempty` | That file exists and has at least one byte. |
| `json-valid` | That file is UTF-8 JSON that parses, at most 1 MiB. |
| `commits-ahead` | The child's branch has at least one commit its base doesn't. Worktree isolation only. |

Out of scope:

- Running a command, such as "tests pass". A check the Node runs would bypass the harness's own
  permission prompt for that command. The child can run the tests and report, and the owner can ask a
  second child to verify. Revisit only with a design for who approves the command.
- Automatic re-prompting on a failed check. The owner decides what to do, as with any report.
- Schema validation of a file's contents. `resultSchema` covers structured output already.

## Design

### The input

Add an optional `checks` array to the `agent_spawn` and `agent_prompt` inputs, at most 8 entries,
each `{ kind, path? }`. Validate at the tool boundary: `path` is relative, has no `..` segment, and is
required for the three file kinds. Refuse `commits-ahead` on shared isolation with a clear error,
because a shared child has no branch of its own. Store the checks on the turn's effective policy, so
recovery after a restart still knows them.

### Running the checks

Run the checks when the turn settles as `completed`, before the report is queued. For other outcomes,
report every check as `unverified` with the outcome as the reason, because the child didn't finish.

Each file check resolves the path against `ctx.core.tasks.root(childTaskId)` with the confinement rule,
so a symlink can't lead outside the worktree. It reads at most what it needs: a stat for the first
two, and up to 1 MiB plus one byte for `json-valid`, so an oversize file is detected without reading
all of it. `commits-ahead` asks core's Git service for the commit count between the recorded base and
the branch head.

Each verdict is `holds`, `fails`, or `unverified`, with a reason of at most 200 characters, such as
"file is 0 bytes" or "path leaves the worktree". Reasons name what the Node saw and never include file
contents.

### Where verdicts go

Add a `checks` block to the `delegation_report` turn, outside the `<pasted_content>` wrapper, because
the Node wrote it and the child didn't. Add the same verdicts to the matching `agent_read` result.
Draw them in the transcript's report card as a short list.

Store verdicts on the turn row so a report rebuilt during startup reconciliation carries the same
verdicts without running the checks again. A file can change between the check and the read, so the
report says when the checks ran.

## Limits and risks

- A check proves a file exists, not that it's correct. The descriptions must say so.
- A worktree that doesn't exist yet makes every file check `unverified`, which is the honest answer.
- Paths are relative to the child's worktree, and shared isolation puts the owner and child in one
  folder. That's correct, and the descriptions should say it.

## Verification

- Unit tests per kind: a missing file, an empty file, a symlink out of the worktree, an oversize JSON
  file, invalid UTF-8, and `commits-ahead` with zero and one commit.
- A report test that verdicts sit outside the pasted-content wrapper and survive reconciliation.
- In the real app, spawn a worktree child with a `file-exists` and a `commits-ahead` check, let it
  finish without committing, and confirm the report shows one `holds` and one `fails`.

## Docs to update

[Orchestration tools](../../agent-tools/orchestration.md#managed-session-orchestration),
[managed delegation](../../managed-agents/delegation.md), and the field descriptions in
`plugins/agents/src/shared/delegationSchemas.ts`.

## Verify before building

- Where a turn's effective policy is stored and whether it accepts another field without a migration.
- Which plugin API door exposes core's commit count and path confinement to the agents plugin, or
  whether one needs adding.
- How a delegation report is reconstructed at startup, so verdicts are stored once and reused.
