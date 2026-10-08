# Git history and revision diffs

The Git plugin reads repository history on the selected Node. This page covers the history and
read-only revision contracts used by the repository source and task Git pane.

## Browse history

Open **Git > History** for the selected Git project. The project selector chooses the mapped
repository; Git does not accept a working directory from the client. The task Git pane opens on
history reachable from its recorded branch. If that branch is unavailable, the pane names the
condition and falls back to repository refs and HEAD. **Worktrees** remains a separate section.
Select a commit and press **Explain commit** for an explicit model-generated summary. See
[Git explanations](./explanations.md) for model choice, context limits, and cancellation.

`plugins/git/src/server/history.ts` reads up to 100 commits per page. A cursor pins the object IDs
of the selected ref tips and an offset. A ref moving after the first page cannot insert a commit
into that walk. The Node retains up to 32 snapshots for 10 minutes; eviction, restart, or a missing
pinned object expires the cursor with an error. The query returns each
commit's immutable ID, every parent, author and committer name, email, date, full message, subject,
and current ref labels. A detached HEAD is included; an unborn HEAD with no refs yields a named
empty state. The Node uses topological ordering, so ancestors follow their descendants.

The ref filter accepts a named local branch, remote-tracking branch, or tag from the returned ref
list. Search is a case-insensitive substring of the full message, author name plus email, or full
object ID. It examines at most the newest 5,000 reachable commits and says when that bound cuts
the search short. Unfiltered history can page beyond that search window. Queries have a
128-character limit. The client retains a window of 10 pages
(1,000 rows) and replaces older rows as browsing continues. Filtering names parent IDs but draws
no connection through omitted commits. The kit's `HistoryMark` owns the desktop lanes and terminal
relationship mark; the collection owns selection and keyboard actions. Desktop lanes join at row
boundaries, terminate at roots, and show a dashed continuation at a retained-window boundary. They
show a count when more than eight lanes are active. A task
pane retries its recorded branch on refresh and on Node or task changes after a missing-branch
fallback.

## Inspect a revision

`plugins/git/src/server/revision.ts` validates the selected commit ID. A normal commit compares
against its first parent. A root compares with the repository's object-format empty tree (SHA-1 or
SHA-256). A merge lists every parent and lets
you choose one explicitly. The Node reads NUL-delimited topology for renames, deletions, modes,
binary files, and unusual path names. It returns at most 500 changed files and names an omission.
The patch read is capped at 8 MiB. If the patch is unavailable or exceeds that limit, files retain
their topology and the response names the missing content. Binary content is labeled, not shown as
an empty text diff.

The route returns a segmented diff document. The client receives topology and segment descriptors
first; `DiffPane` requests row payloads near its viewport. The same source port provides bounded
find pages and gap expansion. Gap reads allow a selected revision's blob up to 256 KiB. Historical
files have no stage, discard, edit, or comment action. Use **Changes** for working files and commits.

The Node keeps at most 16 revision topologies and 32 MiB of parsed rows. The client scopes queries
to Node, project, optional task, revision, and comparison base; the shared diff viewer bounds its resident segment
cache. Changing Node, task, filter, or selection aborts or discards obsolete reads. Reconnect and
worktree or task events invalidate history without fetching from a remote. Refresh also clears a
pending continuation and its error, allowing the next Load more request. Task revision view state
uses the shared viewer's task scope and is evicted when that task is archived.

## Routes

All routes require a paired device and resolve `:projectId` through the Node's project mapping:

| Route | Result |
| --- | --- |
| `GET /v1/p/git/projects/:projectId/history` | Page with `ref`, `field`, `query`, and optional `cursor` |
| `GET /v1/p/git/projects/:projectId/revisions/:id` | Metadata, changed files, and diff topology; optional `base` parent ID |
| `POST /v1/p/git/projects/:projectId/revisions/:id/segments` | Up to 32 segment payloads for `{ base, requests }` |
| `POST /v1/p/git/projects/:projectId/revisions/:id/search` | Diff matches for `{ base, query, caseSensitive, cursor }` |
| `POST /v1/p/git/projects/:projectId/revisions/:id/file` | Bounded blob text for `{ base, path, sha }` |

The wire types live in `plugins/git/src/shared/api.ts`. `base: null` denotes the empty tree only
for a root commit; a merge base must be one of that commit's parents. Segment requests must name a
patch key in the chosen immutable comparison. Git runs with external diff and text conversion
disabled. Refresh is a local read and does not fetch a remote.
