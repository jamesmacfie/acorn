# Git operations

A task's checkout can merge, rebase onto, cherry-pick, or revert a pinned commit from the Git source
or the task's Git pane. This page describes how an operation starts, how its state is read, and how
to finish or recover it.

## Start an operation

Open a commit row's actions menu in **History**, or select a branch in **Branches and tags**. Choose
one of these entries:

| Entry | Git command in the task checkout |
| --- | --- |
| **Merge into task…** | `git merge --no-edit <commit>` |
| **Rebase task onto this…** | `git -c rebase.updateRefs=false rebase --no-autostash <commit>` |
| **Cherry-pick into task…** | `git cherry-pick <commit>` |
| **Revert in task…** | `git revert --no-edit <commit>` |

Branch and tag details offer merge and rebase only. A merge commit offers no cherry-pick or revert, because
those need a chosen mainline parent and Acorn doesn't guess one. The Node refuses that request with
`mainline_unsupported` if a client sends it anyway.

The dialog shows the Node, project, commit, and the target checkout's branch and HEAD. The task pane
fixes the target to its task. The repository source asks you to choose an active task in the same
project. The dialog keeps the Node it opened with and refuses to submit after the Node changes.

The request carries the commit ID, the HEAD the dialog showed, and the checkout path as comparison
tokens. Under checkout admission, the Node checks the checkout identity again and refuses these
cases:

| Code | Cause |
| --- | --- |
| `operation_active` | A merge, rebase, cherry-pick, or revert is already stopped in the checkout. |
| `conflicted_checkout` | The index has unresolved paths, such as after a conflicted stash apply. |
| `dirty_checkout` | The checkout has staged, unstaged, or untracked changes. Commit or stash them in Changes. |
| `stale_head` | HEAD moved after the dialog read it. Reopen the dialog. |
| `source_missing` | The commit isn't in the task's repository. |
| `checkout_busy` | An agent turn, workflow run, or setup attempt is active on the checkout. |

The dialog lists busy work before you submit. That list is advisory: only the admitted write decides.

## Read operation state

`plugins/git/src/server/checkout.ts` reads the state from Git each time, never from a client flag:

- `rebase-merge` or `rebase-apply` means a rebase. The source is the `onto` commit.
- `MERGE_HEAD`, `CHERRY_PICK_HEAD`, or `REVERT_HEAD` names the other operations and their source.
- A `sequencer/todo` file without those heads is a multi-commit pick or revert. Its next instruction
  names the command.
- `git ls-files -u` lists each unresolved path and the index stages present: base, ours, and theirs.

Because these are Git's own files, an operation started in a terminal, or one left by a Node restart,
shows the same banner. Unresolved paths with no marker are what a conflicted stash apply leaves.
The banner then says **Unresolved conflicts** and offers no **Continue** or **Abort**, because Git
has no operation to continue or abort.

During a rebase, "ours" is the commit being rebased onto and "theirs" is the task's commit. Git
names the stages this way, so the banner repeats Git's names.

## Resolve and continue

The task's Git pane shows a banner above its detail region while an operation or conflict exists.

1. Select a conflicted file. The three-way resolver opens in place of the banner. Save and stage the
   result there, as [Git conflict resolution](./conflicts.md) describes, then press **Back**. Or
   resolve the file in Editor and stage it on the **Changes** tab, which **Stage in Changes** opens.
2. Press **Continue**. It stays disabled while any path is unresolved, and the Node refuses a
   continue with `unresolved_conflicts` for the same reason.

**Skip commit** runs `--skip` for a rebase, cherry-pick, or revert. A merge has no skip. **Abort**
asks for confirmation, then runs `--abort`. Every control sends the operation the banner observed.
The Node refuses with `stale_operation` when the checkout's operation has changed since then.

No command waits on an editor. The Node sets `GIT_EDITOR` and `GIT_SEQUENCE_EDITOR` to `:`, which
Git treats as "keep the prepared message", and sets `GIT_MERGE_AUTOEDIT=no`. Commands time out after
two minutes. A cherry-pick whose result is empty stops with nothing to resolve. **Skip commit**
clears it.

## Read a failed result

A start or control response carries `ok`, Git's error output up to 4,000 characters, and the state
observed after the command. Git and Changes refresh after every attempt, including refusals and
failures, since a failing command can still change files. A command that exits successfully but
leaves an operation stopped returns `ok: false` with that state. If the post-command read fails, the
response says so and carries no state.

The Changes tab draws the banner in its footer instead, for all four operations, and offers
**Abort** there too. Its pull refuses while any of them is stopped.

## Recover by hand

The banner covers the common path. A terminal in the task checkout covers the rest:

- To choose a mainline parent, run `git cherry-pick -m 1 <commit>` or `git revert -m 1 <commit>`.
- To finish a binary, oversized, or symbolic link conflict, run `git add <path>` or `git rm <path>`, then
  continue from the banner.
- If the banner and Git disagree, press **Refresh history** in the task's Git pane. State comes
  from Git, so a refresh shows what the terminal sees.
- To finish a stash conflict, resolve each path and stage it. The stash stays in the list because
  the apply failed, so drop it from **Stashes** once the result is right.
- If Git reports a lock such as `index.lock`, another Git process is running in that repository.
  Wait for it to exit and retry. Acorn never removes the lock file.

External terminals and Git clients don't take part in checkout admission. The HEAD and operation
checks narrow the window for a conflicting external write but can't close it.
Admission queues work by the repository's Git common directory and remembers that directory for each
project folder for 60 seconds. If you replace a project folder with a different repository while
Acorn runs, admission can use the old repository's queue for up to a minute.

## Routes

All routes live under `/v1/p/git/tasks/:taskId/operation` and require a paired device:

| Method and suffix | Result |
| --- | --- |
| `GET /` | Branch, HEAD, operation, source, unresolved paths, and busy work |
| `POST /` | Start an operation from a pinned commit and observed HEAD |
| `POST /continue` | Continue after every conflict is staged |
| `POST /skip` | Skip the stopped commit of a rebase, cherry-pick, or revert |
| `POST /abort` | Abort the stopped operation |

The wire types are in `plugins/git/src/shared/api.ts`. The routes are in
`plugins/git/src/server/routes/operations.ts`, and the commands are in
`plugins/git/src/server/operations.ts`. The client never supplies a working directory. The Node
resolves the checkout from the task.
