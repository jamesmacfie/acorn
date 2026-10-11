# Git conflict resolution

The task's Git pane resolves one conflicted file at a time. It shows the base, ours, and theirs
versions beside an editable result, then saves and stages the result in one step. This page covers
what the resolver reads, how it shares a draft with Editor, and what it refuses. For starting and
continuing the operation itself, see [Git operations](./operations.md).

## Open a conflict

Select a file in the operation banner's conflict list. The resolver replaces the banner until you
press **Back**. Continuing, skipping, or aborting the operation stays on the banner, so saving a file
never continues anything.

The resolver draws the three index stages one after another, each with a role and a label:

| Role | Git stage | Merge | Rebase | Cherry-pick | Revert | Stash apply |
| --- | --- | --- | --- | --- | --- | --- |
| Base | 1 | Common ancestor | Common ancestor | Parent of the picked commit | The reverted commit | Stash base |
| Ours | 2 | Task (HEAD) | Rebased so far onto the upstream | Task (HEAD) | Task (HEAD) | Checkout |
| Theirs | 3 | The merged commit | The task commit being replayed | The picked commit | Parent of the reverted commit | Stash |

During a rebase, "ours" is the branch being rebased onto and "theirs" is the task's own commit. The
labels say so, because Git's stage names alone mislead there.

A missing stage means that side has no file. With no base, both sides added the file. With no ours
or no theirs, that side deleted it. The deleting side offers **Take deletion** instead of
**Use ours** or **Use theirs**.

## Edit and save the result

The result starts as the working file Git left, conflict markers included. **Use base**, **Use
ours**, and **Use theirs** replace the result with that side. On the desktop the result is a
CodeMirror box. In the terminal it's a text area, and **Save and stage** sits above it, because the
text area keeps the arrow keys for its cursor.

The result is Editor's draft for the same file. Both views use the document custody owner keyed by
Node, task, and path (`packages/client-core/src/features/editor/documentCustody.ts`), so typing in
either view goes into one draft, device recovery keeps it, and closing the resolver never discards
it. The resolver refuses to bind a draft that Editor made against another version of the file, or
one Editor has blocked for a disk conflict or recovery. Resolve it in Editor, or press **Discard
draft** to start again from the file Git left.

**Save and stage** holds Editor's autosave while it runs. It refuses when Editor typed into the
draft after the resolver's last edit, and shows that text so you can review it first. On success the
draft is acknowledged at the saved revision and the file leaves the conflict list.

**Take deletion** asks for confirmation, deletes the working file, and stages the deletion. It
discards the result draft, which the confirmation says. A missing side never becomes an empty file.

## What the Node checks

Under the plugin's repository queue and checkout admission, the Node checks these before writing:

| Code | Cause |
| --- | --- |
| `checkout_busy` | An agent turn, workflow run, or setup attempt holds the checkout. |
| `stale_conflict` | The path's index stages or the working file changed since the resolver read them. Reload and review the result. |
| `unresolved_markers` | The result has a line starting with `<<<<<<<` or `>>>>>>>`. A lone `=======` isn't checked, because many formats use it. |
| `unsupported_conflict` | A side or the working file is binary, not UTF-8, over 512 KiB, a symbolic link, or a submodule. |
| `path_outside` | The path leaves the checkout. |

The fingerprint is a SHA-256 hash of the path's `git ls-files -u` records and the working file's
SHA-256 revision, the same revision Editor uses. Any change to either refuses the save, so newer
content from an agent, a terminal, or Editor survives.

If the file saves and `git add` or `git rm` then fails, the response says `saved: true` with Git's
error. The resolver acknowledges the saved text, reads the conflict again, and asks you to press
**Save and stage** again. The retry carries the new fingerprint.

Unsupported files show the reason and a terminal recipe: `git checkout --ours <path>` or
`--theirs`, or edit the file, then `git add` or `git rm`. **Open in Editor** stays available for
text files Acorn won't edit here.

External writers don't take part in checkout admission. The fingerprint check runs immediately
before the write, but a process outside Acorn can still change the file between the check and the
write.

## Routes

Both routes require a paired device. The client never supplies a working directory:

| Method and path | Result |
| --- | --- |
| `GET /v1/p/git/tasks/:taskId/conflict?path=<path>` | Stages, labels, working file, fingerprint, and any unsupported reason. Cancelling the request stops the read. |
| `POST /v1/p/git/tasks/:taskId/conflict` | Save and stage a text result, or delete and stage. Body: `expectedPath`, `path`, `fingerprint`, and `resolution`. |

The wire types are in `plugins/git/src/shared/api.ts`. The reads and writes are in
`plugins/git/src/server/conflicts.ts`, and the view is `plugins/git/src/client/ConflictResolver.tsx`.
