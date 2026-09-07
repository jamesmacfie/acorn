# Phase 0: the status shape and the rows

Status: not started. Waits on nothing.

## Goal

One node call returns everything the panel will draw: the changes, the branch, its upstream, ahead and
behind, whether a merge or rebase is mid-flight, and conflicts as their own status. The list draws
three groups, Conflicts, Tracked, and Untracked, each a `Fold` with a tri-state `Checkbox`, and every
row stages through a `Checkbox` instead of hover buttons. The header shows the totals and one
contextual Stage all or Unstage all button.

## Why this phase, and why now

Every later phase reads `LocalStatus`. The remote bar needs ahead and behind, the commit editor needs
to know whether anything is staged or tracked, and the view menu regroups the same rows. Landing the
shape first means phases 1 to 3 can go in parallel. The checkbox goes in here because it changes the
row's contract with the model (`stage(paths)` instead of `stage(path)`), and that is the API the
folder checkbox in phase 1 needs.

## Scope

In:

- `LocalStatus` in `packages/protocol/src/terminal.ts` beside `LocalChange`, as
  [03-anatomy.md](./03-anatomy.md) § The status shape spells it. `LocalChange.status` gains
  `'conflicted'`.
- The parser in `plugins/changes/src/server/localDiff.ts`: `parsePorcelainV2` returns the header
  facts as well as the entries, `u` lines become `conflicted`, and a new `localStatus(worktree)`
  wraps it with the numstat merge and the operation check.
- The bridge and routes: `changes` becomes `status`, answering `LocalStatus`. `stage` and `unstage`
  take `{ paths: string[] }` and chunk at 200. The old single-path body is gone; the client is the
  only caller.
- `plugins/changes/src/client/changesClient.ts` follows.
- The model: `status` replaces `changes`; `groups()` returns `{ conflicted, tracked, untracked }`
  and, for the diff stack, keeps the staged and unstaged split it has today. `stage(paths)`,
  `unstage(paths)`.
- The list: three `Fold`s, each with a `count`, a tri-state `Checkbox` in `actions`, and the
  fold key `changes.<group>` so collapse state persists the way every other fold's does. Rows are
  `Row` with `label` the file name, a muted `Text` for the directory, the status `Badge` leading,
  the `+N −M` meta, a `Checkbox` trailing, and a `RowActions` menu holding Discard (armed) and Send
  to agent. The conflicted group's rows have no checkbox and a hint that staging marks the conflict
  resolved; their overflow menu offers Mark resolved.
- The header: `+N −M` summed over the list, the send-notes button as today, and Stage all or
  Unstage all, whichever applies. The project path and its copy button move to the bar in phase 3;
  until then they stay.
- The archive check reads `status().changes` and is otherwise unchanged.

Out: the view menu and tree (phase 1), anything in the footer (phases 2 and 3).

## Design detail

**The parser reads the headers it already skips.** `git status --porcelain=v2 --branch` prints
`# branch.oid`, `# branch.head`, `# branch.upstream`, and `# branch.ab +A -B` before the entries.
`branch.upstream` and `branch.ab` are absent when there is no upstream, which is how `upstream`
becomes null and `ahead` and `behind` become null rather than zero. `(detached)` is a null branch,
as core already treats it.

**The operation check is a stat, not a git call.** `git rev-parse --git-dir` once, then `lstat` on
`MERGE_HEAD`, `rebase-merge`, and `rebase-apply` under it. A worktree's `.git` is a file pointing at
the shared repository's `worktrees/<name>` directory, and that is where these live; checking
`<worktree>/.git/MERGE_HEAD` finds nothing.

**Conflicts are a status, not a scope.** A `u` line has no index and worktree halves in the sense the
`staged` flag means, and git's own answer to "stage it" is "mark it resolved". The row has no
checkbox so the panel does not suggest a half-staged conflict exists. The diff column shows the
working copy with the markers in it, which is the unstaged scope it shows today.

**Three groups, and the staged flag is a checkbox.** Tracked holds every change whose status is not
`untracked` or `conflicted`, staged or not; the checkbox says which. A file staged and then edited
again appears once in the list with an indeterminate checkbox, and toggling it stages the rest. The
diff stack keeps the one-area-at-a-time rule from `stackFor` in `plugins/changes/src/client/model.ts`,
and the area shown is the one the selected row's checkbox says: checked stacks staged, otherwise
unstaged. That is a change from today, where the row's group said it, and it is why `pickSelected`
keeps its "unstaged first" default.

**The header button is one button.** Stage all while any tracked or untracked change is unstaged;
Unstage all once every change is staged; hidden when the tree is clean. `git add -A` and `git reset`,
as today.

**Discard moves into the overflow.** `RowActions` is the kit's per-row menu, and it reveals on the
same rules everywhere. Discard inside it is a `ConfirmButton variant="bare"` so the armed item is the
prompt, on every host.

## Code touched

- `packages/protocol/src/terminal.ts`: `LocalStatus`; `'conflicted'` on `LocalChange`.
- `plugins/changes/src/server/localDiff.ts`: header parsing, `localStatus`, `stageFiles`,
  `unstageFiles`, the operation check.
- `plugins/changes/src/server/localGit.ts` and `plugins/changes/src/server/routes/localGit.ts`: `status`;
  the `paths` bodies.
- `plugins/changes/src/server/agentTools.ts`: `local_changes` returns `localStatus(wt).changes`, so the
  agent's list and the person's stay one list. Its description mentions conflicts.
- `plugins/changes/src/server/archiveCheck.ts`: reads `.changes`.
- `plugins/changes/src/shared/api.ts`: `localStatusRoute`; the `changes` route builder is deleted.
- `plugins/changes/src/client/changesClient.ts`, `changesModel.tsx`, `model.ts`, `ChangesPane.tsx`.
- `plugins/changes/src/client/fileTools.ts` (new): the row's overflow menu as its own component, so
  the tree row in phase 1 reuses it.

## Tests

- `localDiff.test.ts`: the header lines parse to `branch`, `upstream`, `ahead`, `behind`; absent
  headers give nulls; `(detached)` gives a null branch; a `u` line gives `conflicted` with no numstat;
  the existing fixtures still pass.
- `localDiff.test.ts`: `stageFiles` over 450 paths issues three `git add` calls, with the git seam
  mocked the way the existing route tests mock the bridge.
- `localGit.test.ts` (routes): `{ paths: [] }` is 400; `{ path: 'x' }` is 400; the status route
  answers the bridge's shape.
- `model.test.ts`: `groupChanges` puts a staged-and-edited file in Tracked once with `partial: true`;
  the totals sum skips nulls.
- `ChangesPane.test.tsx` (new, jsdom through `@acorn/plugin-api/testkit/client`): a row's checkbox
  calls `stage([path])`; a group's indeterminate checkbox calls `stage` with the unstaged paths; the
  conflicted row has no checkbox.

## Docs owed

Per [docs-migration.md](./docs-migration.md), phase 0 rows: `docs/diff-rendering.md` two sections,
`docs/panes.md` § Shipped panes, `docs/testing.md` smoke checklist.

## Doors left open

- `LocalStatus.operation` is read here and drawn in phase 3.
- `ahead` and `behind` are read here and drawn in phase 3.
- The row component takes `depth` so phase 1 can nest it without a second row.

## Done when

- Staging a file through its checkbox moves it, the group checkbox reflects it, and the diff column
  switches to the staged area for that file.
- A conflicted file appears in its own group with no checkbox, and Mark resolved stages it.
- The rail's dirty count and the header totals agree after every action.
- `pnpm lint`, the changes plugin's tests, and the arch suite are green.

## Verify before building

- `plugins/changes/src/server/localDiff.ts` still parses `--porcelain=v2` without `-z` and treats `u`
  lines as modified.
- `plugins/changes/src/server/routes/localGit.ts` still has `pathBody = z.object({ path })`.
- `packages/client-core/src/kit/components/primitives.tsx` still exports `Checkbox` with `indeterminate` and
  `RowActions` still takes a `children(menu)` render function.
- `Fold` in `packages/client-core/src/kit/components/layout/Fold.tsx` still persists open state under `fold:<key>`.
- `packages/node-core/src/server/worktrees/worktrees.ts` `worktreePorcelain` still reads `# branch.head` and
  `# branch.oid` the way this phase will read `# branch.upstream` and `# branch.ab`.
