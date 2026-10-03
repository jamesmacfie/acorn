# The Changes pane

This page covers the Changes pane's side of the diff viewer: the one status read, how a working
tree's document is built, the file list, discard, the branch bar, and what the panel refuses. It's
part of [diff rendering](../diff-rendering.md). The plugin lives in `plugins/changes`.

## One status read

Behind the pane's document is one resource, `LocalStatus`. It carries the branch, its upstream, and
how far the branch is ahead and behind, beside the file list, so no two regions of the panel can
describe different trees. It's one `git status --porcelain=v2 --branch --untracked-files=all` call,
plus two `numstat` reads and a file system check for an unfinished merge or rebase. The Node shares
the Git output across clients for two seconds
([workspaces and tasks](../workspaces-and-tasks.md) § Worktree status reads). The header's count, the
groups, the branch bar's counts, and the banner all come from this one record. `--untracked-files=all`
makes an untracked directory arrive as the files inside it, because a row for a directory has no
patch to show and no file to discard.

The Node decodes porcelain's C-quoted path bytes, including octal UTF-8, before it derives content
keys or passes paths to stage, unstage, discard, or diff. Both `numstat` reads use NUL-delimited
records, so tabs, newlines, arrows, and braces in paths stay intact, including both rename paths.
Malformed escapes and unsupported encodings fail explicitly. The string-path boundary rejects
undecodable bytes and ambiguous replacement characters instead of guessing a name. Path validation
and root confinement still apply after decoding.

Each status read takes fresh checks for an in-progress operation and fresh disk stamps of mode, size,
mtime, and ctime. Eight workers per reader take the stamps in porcelain order. Readers share Git
output, but each stamps its own result. Staged entries use object keys, deleted files use a fixed
stamp, and entries of unknown identity fall back to refreshing the patch.

## Working-tree documents

A working tree's document is diffed in batches of paths, not a process per file, and held in a
process-local cache (`plugins/changes/src/server/localDocument.ts`). The Node refuses a segment
request whose patch key isn't the one the last document gave that file, with `409 revision_conflict`.
The Changes source refreshes its document when it sees one, so the viewer never draws one file from
two states of the tree.

Staged and unstaged are separate documents, and segments and search go out under the staging area of
the document that described them. The batch pins Git's `a/` and `b/` prefixes and reads each path
literally, so a user's diff settings or a path such as `app/[slug]` can't change what a file shows. A
batch Git can't print, such as one past its output cap, is read one file at a time, and a file Git
can't read has no diff instead of failing the document. The pane asks for at most the first 5,000
stacked files. A failed document read keeps the last document on screen.

Tracked and untracked patches fail explicitly when Git passes its 16 MiB output cap. An untracked
`diff --no-index` accepts complete results with exit code zero or one, through `gitOrThrow`'s
`allowedExitCodes` option. Spawn, cancellation, timeout, and truncation failures still throw.
Supported patches keep their complete bytes and final lines.

Filling a gap needs the new side of the diff, and for a working tree that isn't a Git object.
`localNewSideText` reads the index for a staged diff and the file on disk for an unstaged one. It
refuses a symlink, because a repository can hold one pointing anywhere and the path arrives over
HTTP. Disk reads and unstaged diffs, including untracked ones, also use core's root guard to reject
links in intermediate directories and dangling links. The pane carries the staging area in the
document file's `sha`, which the viewer hands back through `fileText`. A deleted file has a null
`sha`, so its gaps can't expand.

Review-note writes publish `plugin:changes:review-notes-changed` only after a create, edit, delete,
or sent-state change. The event carries `{ taskId, total, unsent }` and no note IDs, paths, or
bodies, so badges and delivery gates react without receiving review content.

## The file list

The list is a navigator, not a selector. Every file's hunks stack in one scroller, and clicking a row
scrolls to it, as in the pull request pane. Staging is a checkbox, one per row and one per group. The
row's checkbox is its last control, so it lines up with its group's. Discard and **Send to agent** are
in the row's overflow menu. The list header is **Changes** with its count. Unsent review notes get a
banner at the top of the list with **Send to agent**, and the send's result lands there too.

The list draws three groups: Conflicts, Tracked, and Untracked. An unmerged file has its own status,
no line counts, and no checkbox, because Git stages a conflict by marking it resolved, and its
overflow menu says so. A tracked file that was staged and then edited again is one row with an
indeterminate checkbox, and checking it stages the rest.

The pane stacks one staging area at a time (`stackFor` in `plugins/changes/src/client/model.ts`).
Git reports a file that was staged and then edited twice, once per area, and the row model keys a
file by path, so a combined stack would hold two files with the same identity. The area on screen is
the one the highlighted row's checkbox names: checked stacks the index, and partly checked or
unchecked stacks the working tree. The default is the first unstaged change.

**Discard** puts the file back the way the last commit has it, wherever the row sits. It runs
`git restore --source=HEAD --staged --worktree`, both areas at once, because restoring the working
tree alone rewrites the file from the index. A rename is discarded by both its names. An untracked
file has nothing to restore from, so discard deletes it.

## The footer and freshness

The footer reads top to bottom in the order things happen: the banner while a merge or rebase is in
progress, the branch bar, the `changes:push-actions` slot where another plugin says what to do next
([plugins](../plugins.md) § Cooperative extension points), the commit editor, and the button row. The
bar's primary button carries one verb, chosen from the status read: **Publish** with no upstream,
**Pull** when behind, **Push** when ahead, and **Fetch** when level. Behind wins over ahead, because
a push from behind fails.

Nothing watches the file system. The panel reads again after its own writes, on the rail's status
poll every 10 seconds, and on `head:changed` ([events](../api-reference/websocket.md)). An agent's
save shows within 10 seconds, the same freshness as the rail's dirty marker. The poll and
`head:changed` count only while the pane is drawn. The host keeps the pane's model after you leave the
task, and a missed refresh runs once when the pane is drawn again
([pane models](../panes/models.md) § Pane models).

## What the Changes panel refuses

Each of these is decided:

- **A branch picker in the bar.** A task is the piece of work, and its branch is part of its identity
  ([workspaces and tasks](../workspaces-and-tasks.md) § Worktrees and setup). Checking out another
  branch in a task's worktree is the state the `worktree-stale` refusal catches. To work on another
  branch, start a task.
- **Hunk and line staging.** Deferred. It needs a gutter control in the shared viewer, a
  `git apply --cached` path, and a terminal rendering. A `hunkAction` beside `lineAction` is where it
  would go.
- **Remotes other than `origin`.** Worktrees, pull requests, the branch prefix, and the base ref all
  assume `origin`. A second remote would be a project setting.
- **Chords on fetch, pull, and push.** A chord costs every other plugin one
  ([shortcuts](../command-palette-and-shortcuts/shortcuts.md) § Plugin shortcuts). These have palette
  rows. Force push has neither, because arming it is its prompt.
- **A split button in the kit.** The footer draws **Commit** and its options chevron in
  `Toolbar.Group joined`, from nodes that exist ([the closed kit](../ui-design/closed-kit.md)).
- **A separate Git pane.** It would split the staging checkbox from the diff it stages.
- **A Git view on the rail.** The rail takes marker data only.
- **Git write tools for agents.** Not built. `local_changes`, `local_diff`, and `git_log` are
  read-only and share `plugins/changes/src/server/localDiff.ts` with the pane. An agent has a
  terminal ([agent tools](../agent-tools.md)).
- **A commit history.** The pull request pane shows commits.
- **A warning on archive about unpushed commits.** Archiving removes the worktree, not the branch,
  so the commits survive.
