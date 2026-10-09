# Phase 05: task and workflow launches

## Recovery completion note, October 9, 2026

The original Core `targetIdentity` now stays with a Workflows launch after task creation. Core
rechecks that observation through the public availability route before every follow-on start,
including a retry after reopening. A moved project mapping refuses the start and keeps the task,
typed inputs, and launch identity. The real Git fixture confirms two repositories with the same
commit return different identities, and confirms that the availability route still returns an
identity after the task branch exists. The actual Core draft test covers failed start → remap →
reopen → refused retry, followed by retry on the original mapping with the same task and no second
creation.

Workflows freezes the selected definition and effective inputs at Submit, before asynchronous task
creation. Edits during that request cannot change the invocation, and a retry after a lost response
uses the same payload and UUID. A completed launch retires its recovery entry only after visible run
navigation or explicit opening of its run or task. A dismissed uncertain start keeps its entry; a
later deliberate launch after completion gets a new task and launch identity. Dismissal before any
task or run exists releases the unused entry. Deferred dialog tests cover the in-flight edits,
payload reuse, and new launch after completion. In the changed disposable desktop build, Git →
History → root commit `5d371c42` → **Start workflow here** created task
`d377aa36-14a7-4646-897e-595bf615c0c7` and opened a completed fixture run. Reopening the
same commit offered a fresh **Create task and run** form; submitting it created distinct task
`ed603869-d074-4f75-9e11-6b14d1ebbade` and opened its own completed run. The inspected
screenshots are `.acorn/agent-dev/git-phase05/screenshots/phase05-fresh-second-launch.png` and
`.acorn/agent-dev/git-phase05/screenshots/phase05-second-run.png`. The earlier uncertain recovery
screen is `.acorn/agent-dev/git-phase05/screenshots/followup-final-recovery.png`; the terminal
80×24 and 120×40 evidence remains in the follow-up note below. This desktop build measured
802,591/775,000 B of startup scripts; the renderer budget remains over its existing cap, which
was not raised.

---

## Follow-up completion note, October 9, 2026

Status: reviewed fixes implemented. A Git workflow launch now sends one UUID through the public
device start route to Workflows' existing intended-run reservation. Workflows binds that identity to
the task, definition, and inputs. A lost response replays the persisted run, concurrent trust
completion and Retry admit one run, and changed payload replay fails. The Workflows launch owner
retains created task/run IDs and typed inputs across dismissal and reopening. The Core draft records
a late task save, but a dismissed draft cannot start its follow-on workflow. The Workflows overlay
captures Node, project, API routing, and launch generation; delayed responses and trust completion
cannot navigate a replaced launch. Loading, unavailable target, and read errors display actions to
retry or close. Once a task exists, its creation fields are hidden and Retry uses that same task.

Core's availability preview now returns an opaque checkout and object-store `targetIdentity` for a
pinned commit. The draft retains its first observation and creation rechecks it under branch
reservation. A project remap to another repository containing the same commit is refused without
losing edits. Attachment checks a present, unlocked Git registration and active or archiving task
claims through project aliases at reservation time; a disappearing candidate fails cleanly. Git's
history and worktree action pickers capture Node, project, and row target before opening, and
refuse stale actions after a scope switch, including **Open task**. Branch-tip actions still use
the commit ID present when the menu opened; refs management remains Phase 06.

Verification: focused Core route fixtures passed 45 tests, including the same-object remap,
locked/missing/archiving attachment and removal races. Core's actual task draft tests passed 3,
covering a save completing after dismissal and recovery on the same task. Workflows' route,
dialog, and durable start suites passed 49, including conflicting replay, concurrent starts,
deferred response and trust callbacks, and visible read failures. Git action tests passed 5;
terminal router tests passed 11; protocol API tests passed 4; boundary, doc path, and published
surface checks passed 60. Scoped TypeScript passed for protocol, Node Core, client Core, Git,
desktop, and terminal. Workflows still has only the pre-existing null-`HeadlessArgv` fixture error
at `workflowMapLifecycle.test.ts:222`. Touched-source oxlint reported only existing warnings in
`workflow.test.ts`, `Shell.tsx`, and `taskWorktree.ts`. The terminal startup closure measured
731,563/732,000 B. Desktop stage and renderer compilation passed; the renderer budget remains
over at 802,060/775,000 B (before this follow-up: 801,647 B; before Phase 05: 798,673 B).
The cap was not raised. Full root tests and lint remain deferred until all eight phases.

Real-host reproduction: in the isolated desktop session `git-phase05`, select Git → repo →
root commit actions → **Start workflow here**, enter the required `reason`, and submit. In the
final staged build, new task `a2202c04-613f-46ed-a825-5eecb18d7833` opened its sole run
`52c8216d-42a6-441f-a8fe-56866087ad65`; reopening the same commit action showed **Open task**
and **Open run**, with the task-creation fields gone. Inspected screenshots of the run and the final recovery are
`.acorn/agent-dev/git-phase05/screenshots/followup-workflow-run.png` and
`.acorn/agent-dev/git-phase05/screenshots/followup-final-recovery.png`. In isolated terminal session
`git-phase05-tui`, use Git → History, Shift+F10 on the root commit, select **Start workflow here**,
enter `reason`, and submit. The 80×24 picker and form were inspected; the new task opened one
completed run at both 80×24 and 120×40. Saved terminal snapshots are
`.acorn/agent-dev/tui/git-phase05-tui/followup-run-80x24.txt` and
`.acorn/agent-dev/tui/git-phase05-tui/followup-run-120x40.txt`. Both hosts were stopped.

---

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
