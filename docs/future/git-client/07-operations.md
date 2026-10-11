# Phase 07: Git operations and editor resolution

Date: October 7, 2026. Status: implemented October 11, 2026. Shipped behavior is in
[Git operations](../../git-client/operations.md).
Depends on [phase 06](./06-refs-remotes-and-settings.md).
Read the [full implementation context](./README.md), especially
[operation handling](./README.md#operations-and-conflict-handling) and
[checkout admission](./README.md#task-activity-and-admission).

## Acceptance evidence: October 11, 2026

The fixture is a disposable repository at `/tmp/acorn-ops-fixture/repo`. `main`, `feature`, and a
later `tui-conflict` branch each change line one of `shared`, and `side` adds `side.txt`. Each
session's task was a `tasks` row with a null branch, inserted into the session's `core.sqlite`.

- `plugins/git/src/server/operations.test.ts` covers success, no-op, conflict, continue, skip, and
  abort for each operation. It also covers a terminal rebase, the refusals, and a conflicted stash.
  Its default editor always fails, so a command that waited on a prompt would fail the test.
- Desktop, `pnpm dev:agent -- --session git-ops --project <fixture>`: **Merge into task…** on
  `feature` stopped on `shared`. The banner opened the file in Editor, Changes **Mark resolved**
  staged it, and **Continue** created the merge commit. A cherry-pick with an untracked file was
  refused with the dirty-checkout message, and the same dialog succeeded after the file was removed.
  A revert started in a terminal appeared after **Refresh history** and aborted from the banner.
- Terminal, `pnpm dev:tui:agent -- --session git-ops-tui --project <fixture> --cols 120 --rows 40`:
  the keyboard action picker opened **Merge into task…**, the dialog showed Git's conflict output,
  the banner listed `shared`, and its row opened a `shared [!]` Editor tab. **Continue** created the
  merge commit. The file was staged with `git add`, because the terminal Changes pane still read
  "No changes" during the conflict and the driver can't show focus to press its refresh. The
  terminal refusal and retry flow wasn't driven for the same reason. It renders through the same
  dialog alert that showed the conflict output.

Two defects surfaced and are fixed. Git routes answered every `BridgeError` refusal, including stash
refusals, as a 500 `internal`. `plugins/git/src/server/routes/router.ts` maps them to their status. The
terminal drew the history dialog below the last row, so the list mounts it first.

## Deliverable

A person starts merge, noninteractive rebase, cherry-pick, or revert on an explicit eligible task,
sees the operation/conflict state, opens conflicts in Editor, stages through Changes, and explicitly
continues, skips where supported, or aborts. Operation state survives an Acorn restart.

## Steps

1. Extend task state reads to Git operation markers, unresolved index paths/stages, branch/HEAD,
   and busy reasons. Reconstruct state for operations begun outside Acorn. Distinguish unresolved
   stash application from sequencer/merge/rebase state.
2. Add validated operation requests with task and pinned source revision, dirty/busy/operation
   refusals, authoritative admission, and post-command observation. Unsupported merge-commit
   cherry-pick/revert requests fail with a named reason; do not infer mainline parents.
3. Add operation-specific continue/skip/abort routes. Validate marker state and unresolved entries
   again before acting. Use noninteractive command invocation without blocking on an editor
   prompt, retain Git error output, and refresh Changes after partial outcomes.
4. Add task operation banners, target dialogs/menus, conflict rows, and Editor intents. Editor owns
   working buffers and saves; Changes owns staging. Keep navigation available when an operation
   cannot continue. Do not build a second text editor in this phase.
5. Reconcile state on reconnect, explicit refresh, operation events, and restart. Document manual
   resolution and recovery paths in the shipped owner docs.

## Acceptance

- Temporary repositories exercise success, no-op, conflict, refusal, continue, skip where supported,
  and abort for each supported operation. Cover external operations and restart reconstruction.
- Dirty targets, queued/active work, gated workflows, stale state, and unsupported mainline choices
  are refused. A failing Git command still exposes changed state and releases admission.
- Conflicted stash state does not offer nonexistent continue/abort. Editor opens the correct task
  file, Changes reflects staging, and Git continuation remains explicit.
- Desktop and terminal complete a conflict-resolution flow through Editor/Changes and show a
  refusal/retry flow. Run [phase gates](./README.md#verification-strategy) for Git, Changes, Editor,
  activity owners, and clients before phase 08.

## Verify before building

- Recheck Git operation marker/sequencer detection and Changes' abort/commit behavior.
- Confirm Editor open intents, task confinement, and noninteractive subprocess behavior on every
  supported operating system.
