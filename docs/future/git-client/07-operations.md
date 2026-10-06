# Phase 07: Git operations and editor resolution

Date: October 7, 2026. Status: planned; implementation not started.
Depends on [phase 06](./06-refs-remotes-and-settings.md).
Read the [full implementation context](./README.md), especially
[operation handling](./README.md#operations-and-conflict-handling) and
[checkout admission](./README.md#task-activity-and-admission).

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
