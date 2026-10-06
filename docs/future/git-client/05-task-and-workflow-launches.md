# Phase 05: task and workflow launches

Date: October 7, 2026. Status: planned; implementation not started.
Depends on [phase 04](./04-explanations-and-first-release.md).
Read the [full implementation context](./README.md), especially
[task/workflow launches](./README.md#launching-tasks-and-workflows) and
[source ownership](./README.md#source-baseline-and-ownership).

## Deliverable

A commit or branch row can open the task draft or workflow launch flow with a pinned starting
commit. A free worktree can be attached through core; an owned worktree opens its task.

## Steps

1. Add `baseCommit` to core TaskSeed, route validation, branch availability, and branch reservation.
   Enforce mutually exclusive starting modes, verify a full object ID as an available commit,
   preserve derived/exact branch behavior, and retain rollback of branch creation on failed save.
2. Extend the core task draft with a pinned base/title seed and expose a narrow public launch
   request. Keep the form's target Node/project snapshot, setup choice, dirty input, submit
   validation, task creation, and navigation under its owning core model.
3. Add row-menu task launches from commit and branch tip. Capture the immutable tip before the
   dialog, display it, and create an isolated branch/worktree. Add eligible attachment and
   linked-task navigation through core's worktree validation rather than direct Git writes.
4. Expose a Workflows-owned launch contract for definition selection and required inputs. Mount
   its dialog/flow wherever Git can launch it on both hosts. Do not import workflow UI internals
   or bypass definition validation and start idempotency.
5. Make task-created/workflow-start-failed a recoverable state: retain task ID and inputs, offer
   retry on the same task, and permit opening that task. Reject moved Node/project targets and
   newly claimed worktrees without losing the person's draft.

## Acceptance

- Real Git/core tests prove a historical commit, a branch tip that moves after selection, root
  commits, invalid/missing objects, exact-name conflicts, derived-name deduplication, save
  rollback, lazy setup, and mutually exclusive starting modes.
- Attachment revalidates Git registration and active ownership, including project aliases.
- Workflow failure after task creation and a subsequent retry use one task. Required inputs,
  cancellation, disabled Workflows, and both-host mounting have observable tests.
- Demonstrate launching and opening the resulting task/run on desktop and terminal; run
  [the phase gates](./README.md#verification-strategy) for core/protocol/API, Git, Workflows,
  affected clients, and direct consumers.

## Verify before building

- Recheck task draft public entrypoints and ownership of worktree attachment and setup evidence.
- Confirm workflow start idempotency, required-input forms, and host mounting before extending them.
