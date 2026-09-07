# Refused: what was considered and set aside, with the argument

Part of [docs/future/changes/](./README.md). Each of these will be asked for again, and the request
will sound reasonable. This file exists so the argument is had once.

## A branch picker in the bar

Zed's `acorn / main` is a button that opens a branch list, and checking one out is how you move
between pieces of work in an editor. In acorn a task is the piece of work and its branch is part of
its identity: the worktree directory is keyed by owner, repo, and branch, and before a worktree is
handed out its HEAD is checked against the task's branch (`docs/workspaces-and-tasks.md` § Worktrees
and setup). Checking out another branch inside a task's worktree is the exact state the
`worktree-stale` refusal exists to catch, and it would hand the task's agent another branch's files.
The bar shows the branch as a label. To work on another branch, start a task.

## Hunk and line staging

Zed stages hunks from its project diff. acorn's diff viewer is shared with the PR pane, renders
unified rows through one virtualizer, and has no gutter control (`docs/diff-rendering.md`). Adding
one means a kit affordance on a diff row, a `git apply --cached` path on the node built from the
viewer's row model, and a terminal rendering for the control, and every one of those is a
second design. The door stays open: `DiffSource` already has `lineAction`, and a `hunkAction` beside
it would be where a stage-this-hunk verb lands. Nothing in this folder builds it.

## Other remotes

Fetch From and Push To pick a remote or a target branch. A task's worktree is created from
`origin`, its PR is opened against `origin`, and the branch prefix and base ref are project
settings. A second remote is a project decision, and the day one is needed it belongs on the
project row beside the base ref, not in a per-push picker. Until then every remote verb here says
`origin` and means it.

## Chords on the remote verbs

Zed binds every menu item. acorn's keymap is one shared registry with user overrides and conflict
resolution, and a chord costs every other plugin a chord. Fetch, pull, and push are used a few times
a day and get palette rows. Commit and amend are used many times a day and get the two chords the
`commit` intent already reserves.

## A split button in the kit

Zed's **Stage All ▾**, **Pull ▾**, and **Commit ▾** are split buttons. The kit has a `Button` that
opens a menu and a `Menu`; two nodes side by side draw the same thing, and a split button would need
a support row, a focus role, and an 80 by 24 sentence for a shape that is two existing shapes
touching. The admission rule (`docs/ui-design.md` § The closed kit) asks for two surfaces that cannot
be expressed in what exists. This is one surface that can.

## A new pane

A separate "Git" pane beside Changes would leave the file list and the checkbox that stages a file in
one pane and the diff of that file in another. The list column of the changes pane is the rectangle
Zed's dock occupies, and the model behind it is already built once per task. See
[01-why.md](./01-why.md) § Why the list side of the existing pane.

## A rail surface

The rail takes marker data from `registries/railMarkers.ts` and nothing else; `tabrail.task-row` was
removed on purpose (`packages/client-core/src/host/registries/extensionPoints/slots.ts`). The dirty marker keeps saying
how many files changed. An ahead count on the rail is a marker a later change could add through the
same registry, and it is not this programme.

## Agent write tools for git

`local_changes`, `local_diff`, and `git_log` are read-only, and the reason they share
`server/localDiff.ts` with the bridge is so the agent and the person see one tree. A `git_commit` tool
is not refused on principle, but an agent has a terminal and uses it, and a write tool defaults
denied under the permission tiers anyway (`packages/node-core/src/server/agentTools/registry.ts`).
Nothing here needs it.

## A filesystem watcher

The panel refreshes on its own mutations, the rail's 10-second poll, and `head:changed`. A watcher
on every active worktree is a node-wide change with its own cost model, and the ponytail note beside
`noticeHead` in `packages/node-core/src/server/worktrees/taskWorktree.ts` already names it as the upgrade.
When it arrives the panel gets it for free through the same status signal.

## A commit history in the panel

Zed does not show one either. `git_log` exists for the agent and the PR pane shows commits once
there is a PR. A log view is a fourth region or a new pane, and neither is what the panel is for.

## Warning on archive about unpushed commits

The archive check warns about uncommitted files, and with `ahead` known it could warn about
unpushed commits too. Archiving removes the worktree and not the branch, so the commits survive in
the main checkout. A warning that says "your work is safe" is noise. Not added.
