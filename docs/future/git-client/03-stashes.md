# Phase 03: stashes and checkout admission

## Final UI follow-up, October 9, 2026

Stash feedback now retains the submitted target task ID through a deferred response. Both conflict
actions open Changes for that task even if the dialog's target selector changes after submission.
Disposing the detail view invalidates pending visible callbacks, and closing a dialog clears its
busy state. The Agents and Workflows checkout activity imports were moved beside their module's
other imports. The focused deferred-response tests (three) and Git type check passed; no host flow
needed repeating for this client-only correction.

## Review follow-up, October 9, 2026

**Status:** Correctness fixes after review on `phase-3-stashes-and-checkout-admission`. Core's
authoritative script ledger now blocks stash writes from automatic or manual setup admission until
the attempt settles. Manual setup admission enters the same repository guard before persisting its
attempt, then releases it before terminal worktree resolution. The guard requires the named Agents,
Workflows, and setup readers and rechecks checkout and repository lock identity after waiting.
Agents and Workflows readers are exercised against durable plugin rows for queued, waiting,
cancelling, gated, and settled states. Workflow-to-Agent nested dispatch remains outside a held
admission guard.

**Stash corrections:** The Node checks the target checkout's actual Git common directory and
current registered worktree against the selected repository. It refuses a recorded path replaced
by an independent repository. Duplicate stash navigation IDs include the roster fingerprint, so
a moved selector clears selection on refresh. A roster accepts at most 100 entries and reads detail
sequentially; GET cancellation reaches each Git subprocess. The parent-read bound is 512 bytes,
enough for a SHA-256 stash with three parents. Sequencer markers join the operation check, and
unexpected marker access errors refuse mutation. Once a Git command is attempted, a command throw
or failed conflict/roster probe returns a partial result with possible checkout change. Unknown
conflicts are `null`, never an empty observed list. The client invalidates only the submitted Node
and project's query keys and ignores late responses after a scope or dialog change.

**Scoped verification:** Git stash/submission tests passed (14); real Git cases cover a replaced independent repository, SHA-256 captured
untracked content, cancellation, ambiguous duplicate navigation, marker inspection, and partial
post-command failures. Core admission, script, archive, and worktree tests passed (60), including
setup in both admission orders, its settlement, named readers, and a moved mapping. Terminal's
manual setup lifetime tests passed (two); durable Agents and Workflows activity reader tests passed
(three each). Git, Core, and terminal type checks pass. Agents and Workflows type checks retain only
the unchanged fixture errors listed below. Touched-source oxlint and relevant architecture/facade
checks passed (65). Node production build measures 3,196,542/3,200,000 bytes. Root lint and full
test remain for the coordinator.

**Real-host follow-up:** Desktop `git-phase03-review` used `pnpm dev:agent -- --session
git-phase03-review --reuse --fixture tui-navigation --workspaces on`. Its disposable repository
created a stash through the target dialog, then an apply refused the dirty checkout while retaining
the selected restore-index option, target, and error. Inspected screenshot:
`.acorn/agent-dev/git-phase03-review/screenshots/screenshot-1791496703197.png`. The first sandbox
fixture launch failed with local `tsx` IPC `EPERM`; the authorized retry started the isolated host.
Terminal `git-phase03-review-tui` used the stopped desktop fixture data with
`node apps/tui/scripts/agent/session.mjs --session git-phase03-review-tui --data-dir
.acorn/agent-dev/git-phase03-review/data --no-build --link
acorn://local/p/a95721fb-65bc-41a4-999c-caf4b6b5e09f/x/git/stashes/0da1bbb7d5422a0caee4108336f38fe0fcf0bb61
--cols 120 --rows 40`. Its snapshot showed the same target and a checked restore-index option
beside the dirty-checkout refusal. The driver used `snapshot` and `type` with SGR mouse input to
open and submit Apply. Resizing to 80×24 dismissed the active modal; the underlying stash detail
remained visible. Both isolated sessions were stopped.

## Completion note, October 9, 2026

**Status:** Implemented on `phase-3-stashes-and-checkout-admission`. Git now has a Stashes source
and task-pane entry in both hosts. The Node lists immutable stash objects, current selectors,
whole-roster fingerprints, bases, origin branches, and captured untracked paths. Detail uses the
Phase 02 revision viewer for tracked changes and an empty-tree comparison for captured untracked
content; stash index and untracked parents are not drawn as ordinary history merges. Create requires
a message, defaults to tracked files, and offers include-untracked and keep-index. Apply and pop
require an explicit clean target task and offer restore-index. Apply keeps the stash; a successful
pop removes it; a conflicting pop keeps it and names conflicted files with a Changes action. Drop
has a second destructive confirmation. Failed dialogs retain typed input. The external worktree
manager remains installed for Phase 04.

**Admission map and ordering:** Core owns a per-Git-common-directory admission queue exposed through
its public plugin service. This unifies project-folder tasks, linked worktrees, and project aliases.
Agents enters it before persisting a queued turn or Codex plan continuation; dispatch, permission
waits, questions, retries, resumed turns, cancellation settlement, and restart recovery are read
from durable session/turn state. Workflows enters it before persisting a start or retry; running,
gated, cancelling, child, recovered, and human-gate runs remain busy through their durable rows.
Core enters it for lazy task root/setup, task worktree restore, archive tree claim, and task status
archive/restore. A stash checkout write takes the same queue, checks every task sharing the checkout,
including archived tasks with unsettled owner work, through both owner readers, then checks the
actual mapped target, Git operation, and dirty
state. Missing readers or unknown activity refuse the write; idle sessions without work are eligible.
An owner admitted first appears in the write's durable read. A write admitted first delays new work
until Git finishes. Workflow ticks, including retry ticks, start after admission releases because a
tick can enqueue an Agent turn. Archive claims are visible until teardown settles. Every queue
releases in `finally` on refusal or failure.

**Mutation decisions and limits:** Paired-device routes strictly validate mapped IDs, captured
target path, selector, object, roster fingerprint, options, and drop confirmation. A separate
repository queue serializes stash reflog mutations, including aliases, and rechecks the roster under
that queue. Pop applies the immutable object before dropping the freshly checked selector. Duplicate
objects still require the exact selected entry; a shifted roster is refused. Git and Changes are
invalidated after an attempted checkout command, including partial failure. External Git processes
do not join Acorn's process-local queue, so a reflog change between final check and command cannot
be transactional. No automatic stash/reset/clean/discard or fictitious conflict continuation was
added.

**Focused checks:** Real temporary Git repository stash tests passed (five tests), covering tracked,
untracked, ignored, keep-index, restore-index, apply/pop/conflict/drop, no-change, duplicate objects,
stale selection, and moved or missing targets. Core admission tests passed (four, including
controlled races),
Core archive/worktree tests passed (29), Agents checkout activity tests passed (two) and runtime queue
tests passed (18), Workflow activity tests passed (two) and nested dispatch tests passed (eight).
Git pane/revision model tests passed (four). Relevant architecture rules passed (65). Git, Core,
desktop, and terminal type checks, touched-source oxlint, Node production build and service budget
(3,195,199/3,200,000 bytes), and diff whitespace passed. Agents type check retains two unchanged
`AgentPane.test.tsx` missing-`turnId` fixture errors; Workflows type check retains one unchanged
`workflowMapLifecycle.test.ts` null-`HeadlessArgv` fixture error. Touched-source oxlint reports the
existing `worktree.test.ts:21` fetch-option warning. The unchanged
`docs/api-reference/plugin-routes.md` has 201 lines against the 200-line doc citation limit. Root
lint and full test were deliberately not run for this phase.

**Real hosts, October 9:** Desktop `git-phase03b` used `pnpm dev:agent -- --session git-phase03b
--fixture tui-navigation --workspaces on`; the disposable fixture repository was
`.acorn/agent-dev/git-phase03b/fixture/repo`. It showed create with include-untracked and target,
captured file content, apply, dirty-pop refusal with retained input, successful pop, confirmed drop,
and conflict pop with a retained stash and Changes conflict. Inspected screenshots:
`screenshot-1791492843631.png` (detail), `screenshot-1791493249499.png` (drop), and
`screenshot-1791495498156.png` (conflict) under that session's `screenshots/` directory.
Terminal `git-phase03-tui` used `pnpm dev:tui:agent -- --session git-phase03-tui --fixture
tui-navigation --profile small --seed 3 --workspaces on`, with `pnpm dev:tui:agent:ui -- --session
git-phase03-tui resize 120 40` and `resize 80 24`. Both sizes showed the target/options dialog;
120×40 also showed captured untracked content, apply, preserved dirty-pop input, successful pop,
drop confirmation, and a conflicting pop with `README.md` in Changes. Conflict reproduction used
the disposable fixture only: stash a `README.md` edit, commit a different edit to the same line,
then pop. The terminal was relaunched with `--no-build --link
acorn://local/p/51d7f256-58ed-4f1a-8489-086b426ef14d/x/git/stashes`; UI driver `snapshot`,
`press`, `resize`, and `type` (SGR mouse) exercised the controls. Both sessions were stopped.

**Later phases:** Preserve the common-directory guard and explicit target identity when adding
further Git writes. Use the existing Changes/Editor intent for conflicts and keep stash detail on
the Phase 02 bounded, cancelable revision source. Do not reinterpret stash parents as merge lanes.

Date: October 7, 2026. Status: planned; implementation not started.
Depends on [phase 02](./02-history-and-diffs.md).
Read the [full implementation context](./README.md), especially
[stash behavior](./README.md#stash-behavior) and
[task activity and admission](./README.md#task-activity-and-admission).

## Deliverable

A person inspects repository stashes, creates a stash from a task, applies or pops it onto an
explicit idle task, or confirms a drop. Busy tasks and stale selections are refused by the Node.

## Steps

1. Add stash list/detail contracts with object ID, selector, roster fingerprint, origin branch,
   message, time, base, and captured untracked files. Reuse phase 02 revision detail and diff;
   account for stash index/untracked parents without drawing ordinary merge semantics.
2. Introduce the shared Node checkout admission seam with authoritative Agents and Workflows
   activity projections. Map enqueue, start, retry, resume, recovery, cancellation settlement,
   setup, and archive paths. Make the activity check and Git write one guarded operation; do not
   hold a guard across a nested workflow-to-agent admission. Release on every failure.
3. Add task-targeted create/apply/pop and repository drop routes. Validate roster/object/selector
   freshness and checkout state under admission. Return observed conflicts and partial failures;
   invalidate Git and Changes state after every attempted write that may have changed it.
4. Add task-pane actions, repository target-task selection, explicit option controls, destructive
   drop confirmation, and busy/dirty/stale-selection refusals. Preserve typed message and option
   values on failure. Do not introduce automatic dirty-checkout cleanup.
5. Keep a conflicted pop's stash and show conflicted files with Changes/editor guidance. Git
   operation markers may be absent for stash conflicts; avoid unsupported operation controls.

## Acceptance

- Real repositories cover tracked creation, include-untracked, keep-index, restore-index, ignored
  files, apply preserving the stash, successful pop removing it, conflicting pop retaining it,
  dirty target refusal, and empty/no-change creation.
- Reorder or drop stashes between selection and submission, including duplicate objects. Verify
  that an action never intentionally targets a different stash because a selector moved.
- Controlled races prove both admission orderings, queued turns, live permission waits, cancelling
  agents, gated/cancelling workflows, retries, shared checkout aliases, failure release, and no
  nested-admission deadlock. Idle sessions alone remain eligible.
- Both hosts demonstrate target identity, options, conflict feedback, and preserved failed input.
  Run [phase gates](./README.md#verification-strategy) for Git, core, Agents, Workflows, Changes,
  public API, and affected consumers before phase 04.

## Verify before building

- Recheck owner runtime statuses and every path that admits work; a lifecycle event is not an
  authoritative busy check.
- Confirm stash command/version behavior and Git's limits on external reflog transactions.
