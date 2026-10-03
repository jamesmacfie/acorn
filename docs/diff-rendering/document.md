# The diff document

This page covers what a diff document holds, how find works over it, the `DiffSource` port a caller
drives the viewer through, and how each caller's document is built. It's part of
[diff rendering](../diff-rendering.md).

## The document

A document is a topology and its segments (`packages/diff-document/src/model.ts`).

The **topology** lists every file in order with its status, counts, new-side key (`sha`), and patch
key, and for each file the segments its patch was cut into. A segment is described by counts alone:
its unified rows, its split bands, how many rows are gaps, its widest line in columns, and the first
and last old-side and new-side line numbers. Totals and a revision over every path and patch key
close it off. That's enough to lay out the whole diff, size the scrollbar, place every file header,
and put every inline thread in the right segment before any row exists. It carries no code, no
token, and no comment.

A **segment** is the plain rows of one bounded slice of one file's patch: gaps, hunk headers, and
code lines with their numbers and raw text. `SEGMENT_MAX_ROWS` (64) and `SEGMENT_MAX_BYTES` (32 KiB
of row text) both bound it, because a row count alone doesn't bound a generated file with one huge
line per row. A single row over the byte limit stays whole, alone in a segment marked `oversize`.
The segmenter, `segmentRows`, is deterministic:

- A hunk joins the segment before it only when it fits whole, so boundaries fall between hunks where
  they can.
- A top or middle gap always opens a segment, and the bottom gap always closes one. So an expanded
  gap is always at a segment's edge, and its revealed lines go beside the segment.
- A hunk too big for one segment splits at the last point in the back half of the segment that
  doesn't separate a deletion run from the insertions after it, so split-view pairs stay whole. With
  no such point, it splits at the limit. The descriptor's band count uses the same pairing `toBands`
  does, so it's exact either way.
- A patch the parser can't read falls back to its raw lines, unnumbered and still bounded.

A segment's identity is its content. `segmentContentKey(patchKey, ordinal)` joins the diff-document
version, the patch's own digest, and the segment's ordinal in its file. So a key stays the same while
other files come and go, changes whenever the patch or the parser changes, and never depends on a
position. The patch key is a digest of the patch text, never the head blob SHA, which names the new
side of a file and not a diff against a base ([caching](../caching.md) § Immutable blob cache). The
file's `sha` is still the key a source reads the new side by.

### Find

Find is a document operation. `searchDocument` walks a document's code rows in order and returns a
page of up to 500 matches by path, patch key, segment, and row, with a cursor to the next page. It
reads only as many files as the page needs, and at most 1,000 segments (`SEARCH_PAGE_SEGMENTS`), so a
query that matches little returns a short or empty page with a cursor. Ignoring case uses a
case-insensitive regular expression, because lowercasing a line can change its length and shift the
offsets after it.

The same module holds the limits a route enforces: 32 segments per request, 5,000 files per
document, and a 256-character query.

## The source port

`DiffSource` keeps the viewer ignorant of pull requests and working trees. The caller resolves its
own queries and hands over accessors and callbacks: the topology, where segments come from, how to
search, which threads to place, and what a comment does. The members are plain functions, not a
provider object the viewer could reach through. An omitted optional member hides its control instead
of needing a stub. A source with no `fileText` draws gaps that can't expand, and a source with no
`reply` draws threads with a disabled reply box.

The document members are `topology`, `loadSegments`, and `search`. The viewer asks `loadSegments` for
a few segments at a time, only near the viewport, never for the whole document. A rejection shows that
segment as failed with **Retry**, and a source whose segments can go stale refreshes its topology as
it rejects. No member hands the viewer a whole patch.

`signature` and the topology's `revision` are separate. `signature` says which files are on screen,
and changing it drops the remembered scroll place, the collapsed files, and any gap you opened.
`revision` says what those files claim now, and changing it stops requests for the old revision and
leaves you where you were. A working tree needs them apart, because an agent saving a file mid-review
moves the content every poll. A pull request doesn't: a new commit changes both, so the GitHub pane's
signature is its revision.

A new revision reloads only what moved. Segments are keyed by content, so an unchanged file keeps its
rows, and an agent saving one file reloads that file's segments only.

Three members cover what a caller draws that the viewer has no concept of:

- `threads` are inline conversations, complete when the topology is, placed by line number.
- `lineExtra` puts content under a code row. `anchors` names every line that has some, up front, so
  the document reserves space before the segment loads. `render` draws one line's content inside the
  segment, so its height is measured with it. The Changes pane uses it for review notes.
- `lineAction` adds a click action on a code line. Its `title` is the second line of the **Ask
  agent** button's tip. The Changes pane uses it for Alt-click to send a line reference to the agent.

The Changes source and a task's GitHub source also supply `openLine`. An added line then shows a hover
button in its first gutter that opens the task's file at that line in the editor. Repository pull
request browsing has no task editor, so it omits the callback. The viewer hides the button on deleted
lines. A pull request's line number comes from the pull request head, so the local file can differ if
the worktree has moved on.

The same task-owned sources supply `inlineChat`. Its gutter action opens an **Ask agent** card under a
code line in either mode. The card's anchor is named before its segment loads, so it uses the same
measured-block path as review notes. Repository browsing omits it, because no task owns the agent
session. Inline chat stays separate from review notes and GitHub review comments.

`plugins/github/src/client/DiffForPull.tsx`, `plugins/github/src/client/ComparePreview.tsx`, and
`plugins/changes/src/client/changesModel.tsx` are the three implementations, and each is short enough
to read in one sitting.

## Data flow

The Node builds every document. A provider parses and cuts each patch once, answers the descriptors,
and answers segments by patch key on request:

- A **pull request**'s patches are cut when they're mirrored, and each file's descriptors are stored
  as a small blob beside its patch body ([GitHub integration](../github-integration.md) § Diff
  documents). `GET …/pulls/:number/diff` reads the file rows and those blobs and parses nothing.
  Segments and search are two repository routes, `POST …/diff/segments` and `POST …/diff/search`,
  because a segment is addressed by the patch digest.
- A **compare preview**'s patches arrive inline from GitHub. The compare route stores each under its
  digest and returns a document, so the preview loads segments through the same two routes.
- A **working tree**'s document is read by path and status key (`POST …/local/document`), diffed in
  batches of paths, and held in a process-local cache
  (`plugins/changes/src/server/localDocument.ts`). [The Changes pane](./changes-pane.md#working-tree-documents)
  owns the details.

The GitHub task pane and repository browsing read the same document. The file list beside them reads
the summaries the pull request list already loaded. The client never holds a whole patch.

The row types (`DiffThread`, `CodeRow`, and their siblings, in
`packages/client-core/src/kit/diff/diffModel.ts`) are structural, not named after either plugin's
wire types. GitHub's `Thread` and the Changes review notes satisfy them without either plugin
importing the other. The parser follows the same idea. A GitHub per-file patch has hunks only, so
`synth` puts a header in front of it for `gitdiff-parser`. It lives in `@acorn/diff-document`,
because both GitHub patches and local `git diff` output reach that parser on the Node.
