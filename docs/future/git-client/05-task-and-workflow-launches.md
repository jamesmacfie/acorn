# Phase 05: task and workflow launches

## Completion note, October 9, 2026

Status: implemented. Git history offers **Start task here** and **Start workflow here** for a
commit, plus the same actions for each local branch tip shown on that commit. The action captures
the full commit ID before opening either form. Core validates that the ID names an available commit
on the target Node, reserves an isolated branch, and leaves its worktree and setup lazy. The task
draft displays the pinned ID and keeps the selected Node, project, title, branch, and setup choice.
Git's Worktrees view offers **Attach to task** for an eligible registered checkout and **Open task**
for an owned one. Both actions enter Core's task lifecycle.

Core accepts one starting mode: local base branch, full SHA-1 or SHA-256 commit ID, or registered
worktree attachment. Its reservation rechecks the project mapping, Git registration, and active
task ownership before saving. Ownership includes aliases to the same repository and project-folder
tasks. Exact branch conflicts fail; derived names receive a free suffix. A failed task save removes
a branch created for the request. Attachment never checks out a revision into the current task.

Workflows owns definition selection, required input fields, validation, start, and run navigation.
Git calls its public launch capability. Desktop mounts the form in the Workflows overlay slot;
terminal mounts that capability in the shell overlay. A missing Workflows capability reports that
Workflows is unavailable on the Node. After task creation, a failed start retains the task ID and
input values across cancellation and reopening, offers **Retry workflow** on that task, and allows
**Open task**. A trust approval that starts a run opens that run without a second start. The shared
host action picker puts keyboard row actions at full terminal width, including at 80×24.

Verification: Core's real Git route fixture passed 41 tests covering historical and root commits,
a branch tip moved after selection, missing and non-commit objects, exclusive starting modes,
exact and derived branch names, failed-save rollback, lazy setup, alias ownership, competing
attachments, and a project remap after preview. The task draft test passed. Workflow tests passed
for required input, cancellation and reopening, one-task retry, and trust completion without a
duplicate run. Git's launch tests passed for the captured ID and disabled Workflows. Four relevant
architecture suites passed 61 tests. Scoped TypeScript checks passed for Core, protocol,
client-core, Git, desktop, and terminal; Workflows has the pre-existing null-`HeadlessArgv`
fixture error in `workflowMapLifecycle.test.ts:222`. Touched-source oxlint has no new errors.
The terminal build passed its measured 731,451 B startup closure under the 732,000 B ceiling.
Desktop staging and renderer compilation passed, but the renderer budget check still fails:
801,647 B against a 775,000 B cap. The unchanged Phase 04 build measured 798,673 B, so Phase 05
adds 2,974 B to a pre-existing overage. No root-wide test or lint was run, as required for the
eight-phase sequence.

Real-host check: a disposable desktop session created a task at the pinned root commit, ran the
required-input workflow, and opened its sole completed run; its screenshot was inspected. A
disposable terminal session created and opened a pinned task at 80×24, displayed the complete
commit action picker at 80×24 and 120×40, and created and opened a task with one completed
workflow run at 120×40. Both isolated hosts were stopped. Phase 06 can use the pinned launch
contract on its refs surface; refs management itself remains in Phase 06.

---

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
