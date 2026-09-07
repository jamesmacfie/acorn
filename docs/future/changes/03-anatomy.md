# Anatomy: the regions, the model, the status shape, and the calls

Part of [docs/future/changes/](./README.md). Status: proposal, 2026-09-07. Paths were checked against
the tree on that date; verify before building.

## The regions

The pane stays a `list-detail` layout. The host draws the split, the divider, and the drag handle
(`docs/panes.md` § Layout model). The four regions and what fills them after the programme:

| Region | Today | After |
| --- | --- | --- |
| `list-header` | A `Toolbar` with "uncommitted", the project path, and the send-notes button | A `Toolbar`: the change totals, the view menu trigger, the send-notes button, and the contextual Stage all or Unstage all |
| `list` | Two `Section`s, Staged and Changes, rows with hover buttons | Groups as `Fold`s, each with a tri-state `Checkbox`; rows as `Row` or `TreeRow` with a `Checkbox` trailing and a `RowActions` menu for discard and send-to-agent |
| `list-footer` | An `Alert`, a one-line `Input`, two buttons | Top to bottom: the operation banner when a merge or rebase is mid-flight, the branch bar, the `changes:push-actions` slot, the commit editor, the commit button row |
| `detail` | The stacked diff | Unchanged |

Everything the four regions share lives in the pane's `model`, built once per task by the host
(`packages/client-core/src/host/registries/panes/paneModels.ts`). The commit draft, the amend toggle, the view
preferences, and the status resource all belong there and nowhere else, because a region can be
unmounted while its siblings stay: below 80 columns the layout shows one side at a time, and the
draft must survive a trip to the diff and back.

## The status shape

One node call answers everything the panel draws. It replaces the `LocalChange[]` the route returns
today with a record around it:

```ts
// @acorn/protocol/terminal.ts, beside LocalChange
export type LocalStatus = {
  branch: string | null          // null on a detached HEAD
  upstream: string | null        // '# branch.upstream origin/foo', null when unset
  ahead: number | null           // '# branch.ab +A -B'; both null when there is no upstream
  behind: number | null
  operation: 'merge' | 'rebase' | null   // MERGE_HEAD, rebase-merge/, or rebase-apply/ present
  changes: LocalChange[]
}
```

`LocalChange.status` gains `'conflicted'` for the `u` lines the parser today reports as modified. A
conflicted file has no numstat, is never `staged`, and staging it is `git add`, which is how git
marks a conflict resolved.

The parser is the one in `plugins/changes/src/server/localDiff.ts`, extended to read the `# branch.*`
header lines that `--branch` adds. Core's rail poll already parses two of those headers in
`packages/node-core/src/server/worktrees/worktrees.ts`; the changes plugin reads the same output with more of it,
and neither imports the other, because the plugin may not reach into core's main folder and core has
no reason to know about upstreams.

`operation` is a filesystem check beside the git call: `MERGE_HEAD` under the git directory for a
merge, `rebase-merge` or `rebase-apply` for a rebase. The git directory of a worktree is not
`<worktree>/.git`, which is a file; use `git rev-parse --git-dir`.

## The node calls

The bridge in `plugins/changes/src/server/localGit.ts` and the routes in
`plugins/changes/src/server/routes/localGit.ts` after the programme. Every mutation keeps the
`withRoot` shape: resolve the worktree, run git, ping status so the rail's marker moves.

| Call | Git | Body | Phase | Notes |
| --- | --- | --- | --- | --- |
| `status` | `status --porcelain=v2 --branch`, two `diff --numstat`, the operation check | | 0 | Replaces `changes`. |
| `stage` | `add -- <paths…>` | `{ paths: string[] }` | 0 | Chunked at 200 paths per call, so a folder checkbox over a large tree cannot overflow argv. |
| `unstage` | `restore --staged -- <paths…>` | `{ paths }` | 0 | Same chunking. |
| `discard` | `restore --` or `clean -f --` | `{ path, untracked? }` | | Unchanged. |
| `stageAll`, `unstageAll`, `discardAll` | as today | | | Unchanged. |
| `headCommit` | `log -1 --pretty=%H%x1f%B` | | 2 | For amend's prefill. |
| `commit` | `commit [-a] [--amend] [--signoff] [--no-verify] -m` | `{ message, all?, amend?, signoff?, noVerify? }` | 2 | `all` is what the client sends when nothing is staged. |
| `fetch` | `fetch` | | 3 | 120 s timeout; network. |
| `pull` | `pull --ff-only` or `pull --rebase` | `{ rebase?: boolean }` | 3 | 120 s. A non-fast-forward refusal comes back as the reason. |
| `push` | `push --set-upstream origin HEAD` | `{ force?: boolean }` | 3 | `force` adds `--force-with-lease`. 120 s. |
| `abort` | `merge --abort` or `rebase --abort` | | 3 | Only offered while `operation` is set. |
| `commitMessage` | none; `core.models.generateText` | `{ connectionId, modelId? }` | 4 | Prompt is the staged diff, or the tracked diff when nothing is staged, capped. |
| `modelConnections` | none; `core.models.available` | | 4 | Ids and labels only, as the database plugin's route does. |

Every body gets a zod schema and a malformed-body test, as the existing ones do. Paths go through
`isValidRelPath` before they reach argv.

## The hooks

The plugin's two hooks are the only way another plugin takes part, and both payloads grow by one
boolean:

| Hook | Payload after | Allows |
| --- | --- | --- |
| `before-commit` | `{ taskId, branch, message, amend }` | observe, transform, veto |
| `before-push` | `{ taskId, branch, force }` | observe, veto |

A commit-lint plugin may want to skip an amend; a branch-protection plugin will want to refuse a
force push. The hook payload vocabulary allows booleans (`docs/plugins.md` § Hooks). Skip hooks in
the commit menu means git's hooks; the acorn chain always runs, and the menu item's hint says so.

## The client model

`plugins/changes/src/client/changesModel.tsx` keeps its shape and gains:

- `status`, the resource, replacing `changes`. `groups()` derives from `status().changes`.
- `view`, the device preference: `{ mode: 'list' | 'tree', sort: 'path' | 'name', groupBy: 'none' | 'tracked' | 'staged' }`.
- `draft`, the commit text, read from and written to a device-local key on every change.
- `commitOptions`, session signals: `amend`, `signoff`, `noVerify`.
- `remoteBusy`, one flag for fetch, pull, push, and abort, replacing `pushing`.
- `primaryRemote()`, a pure function of `upstream`, `ahead`, and `behind` returning one of
  `publish`, `pull`, `push`, `fetch`.
- `commitMode()`, a pure function of the groups returning `staged`, `tracked`, or `none`.

The pure functions live in `plugins/changes/src/client/model.ts` beside `groupChanges` and
`pickSelected`, and each gets a table test. The tree builder for phase 1 lives there too.

## Refresh

Nothing here adds a watcher, and the reason is written in `packages/node-core/src/server/worktrees/taskWorktree.ts`
beside `noticeHead`. The panel refreshes on three signals:

1. Its own mutations, which `refetch` on return and ping `broadcastStatus` on the node.
2. The rail's status poll, every 10 seconds while a client is attached, through the `dirtyCount`
   effect the model already has (`packages/client-core/src/features/tasks/taskStatus.ts`).
3. `head:changed` on the client bus (`packages/client-core/src/infra/node/watchNodeEvents.ts`), which the model
   subscribes to for its task. An agent committing in its terminal moves `ahead`, and the poll that
   noticed the HEAD move is the one that fired this.

An agent's file save shows up within 10 seconds. An agent's commit shows up within one poll. A fetch
another process ran shows up on the next poll too, since `behind` comes from the same status call.
That is the same freshness the rail marker has today, and the door to better is a node-side watcher,
which is out of scope here.

## The keyboard

Two chords and a set of palette rows, all through the shared registries
(`docs/command-palette-and-shortcuts.md` § Plugin shortcuts). No key handling in the pane.

| Command | Chord | When |
| --- | --- | --- |
| `changes.commit` | `meta+enter` | The commit editor has focus. The `commit` intent already exists in the closed set. |
| `changes.amend` | `meta+shift+enter` | Same. Toggles amend on and commits. |
| `changes.stage-all`, `changes.unstage-all`, `changes.fetch`, `changes.pull`, `changes.push` | none | Palette rows, `when: 'pane'`, pane `changes`. |

Staging by keyboard needs nothing new: `Rows` gives the list arrows, Home, End, and type-ahead, and
`Checkbox` toggles on Space.

## The terminal projection

Every node in the panel has a row in the 80 by 24 table (`docs/ui-design.md` § Every node at 80 by
24), so nothing here needs a sentence written. The consequences the design has to respect:

- Below 80 columns `list-detail` shows one side at a time. The list side is the whole panel, header
  and footer included, which is exactly Zed's dock. The draft lives in the model, so switching to
  the diff and back keeps it.
- `Popover` and `Menu` open as a block under the anchor. The view menu and the two verb menus have
  no hover state and no placement knob, so they already fit.
- `ConfirmButton` is the prompt on every host. Discard, discard all, force push, and abort all arm.
- `Textarea` owns its keys, so the two chords are the only ones the editor needs from the host.
- A row's `meta` (`+N −M`) is decoration. When a column is too narrow for all three, the name and the
  checkbox are the two things that must remain legible; the count can go.
