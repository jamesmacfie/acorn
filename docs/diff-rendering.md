# Diff rendering

The shared diff viewer is in client-core and is used by the GitHub PR pane, the GitHub compare
preview, and the Changes pane. All three hand it the same thing: a document, laid out by a topology
with no source text in it and filled in segment by segment as the reader comes near.

It arrives in three layers, and the split is enforced (`tools/arch/boundaries.test.ts`):

- `packages/diff-document/` (`@acorn/diff-document`) is the document itself: the patch parser, the
  segmenter, the descriptors, search, and a parse cache. It has no DOM, node, Solid, database, or
  transport dependency, because the node builds documents and the renderer reads them
  ([architecture-overview.md](./architecture-overview.md) § Node API and client flow).
- `kit/diff/` is the toolkit: the row model, the row components, the layout index and its measure
  scheduler, the find marks.
  Props in, DOM out, no application state, so a plugin can reach for a piece of it to build a simpler
  surface.
- `features/diff/` is the viewer: `DiffPane` and the parts only it uses. This layer reads
  preferences, registers a command and a keybinding, and keeps session scroll state, none of which
  `kit/` may do.

`DiffPane` is the whole viewer as one component, and a caller drives it through a `DiffSource`
(`features/diff/source.ts`). Both are on the plugin API, `DiffPane` on `@acorn/plugin-api/ui` and the
port type, with the document types it is written in, on `@acorn/plugin-api/ui/diff`.

## The document

A document is a topology and its segments (`packages/diff-document/src/model.ts`).

The **topology** lists every file in order with its status, counts, new-side key (`sha`), and patch
key, and for each file the segments its patch was cut into. A segment is described by counts alone:
its unified rows, its split bands, how many of those rows are gaps, its widest line in columns, and
the first and last old-side and new-side line numbers its code rows carry. The totals and a revision
over every path and patch key close it off. That is enough to lay out the whole diff, size the
scrollbar, place every file header, and put every inline thread in the right segment, before any row
exists. It carries no line of code, no token, and no comment body.

A **segment** is the plain rows of one bounded slice of one file's patch: gaps, hunk headers, and code
lines with their numbers and raw text. Segments are bounded two ways, by `SEGMENT_MAX_ROWS` (64) and
by `SEGMENT_MAX_BYTES` (32 KiB of row text), because a row count alone does not bound a generated
file with one enormous line per row. A single row over the byte limit is kept whole, alone in a
segment marked `oversize`. The segmenter (`segmentRows`) is deterministic:

- A hunk joins the segment before it only when it fits whole, so boundaries fall between hunks where
  they can.
- A top or middle gap always opens a segment, and the bottom gap always closes one. An expanded gap
  is therefore always at a segment's edge, and its revealed lines slot in beside the segment rather
  than through the middle of it.
- A hunk too big for one segment is split at the last point in the back half of the segment that
  does not separate a deletion run from the insertions after it, so the split view's pairs stay
  whole, or at the limit when there is no such point. The descriptor's band count is computed on the
  segment's own rows with the same pairing `toBands` does, so it is exact either way.
- A patch the parser cannot read falls back to its raw lines, unnumbered, still bounded.

A segment's identity is its content. `segmentContentKey(patchKey, ordinal)` joins the diff-document
version, the patch's own digest, and the segment's ordinal in its file, so a key is stable while other
files come and go, different whenever the patch or the parser changes, and never tied to a position
in the document. The patch key is a digest of the patch text, never the head blob SHA, which
identifies the new side of a file rather than a diff against a particular base
([caching.md](./caching.md) § Immutable blob cache). The file's `sha` stays what it was, the key a
source reads the new side by.

Find is a document operation too. `searchDocument` walks a document's code rows in order and answers
a page of up to 500 matches by path, patch key, segment and row, with a cursor to the next page. It
only reads as many files as the page needs, and at most 1,000 segments (`SEARCH_PAGE_SEGMENTS`), so a
query that matches little answers a short or empty page with a cursor instead of scanning the whole
document in one request. Ignoring case goes through a case-insensitive regular expression rather than
lowercasing each line, because lowercasing can lengthen a line and shift the offsets after it.

The limits a route enforces are in the same module: 32 segments per request, 5,000 files per
document, a 256-character query.

## The source port

`DiffSource` is how the viewer knows nothing about pull requests or working trees. The caller resolves
its own queries and hands over accessors and callbacks: the topology, where segments come from, how to
search, which threads to place, what a comment does. Two rules keep the seam honest. The members are
plain functions rather than a provider object the viewer could reach through, and an omitted optional
member hides its affordance rather than needing a stub, so a source with no `fileText` renders gaps
that cannot be expanded and a source with no `reply` gets thread rows whose reply box is disabled.

The document members are `topology`, `loadSegments`, and `search`. `loadSegments` is asked for a few
segments at a time, only near the viewport, and never for the whole document. A rejection shows that
segment as failed with a Retry, and a source whose segments can go stale refreshes its topology as it
rejects. There is no whole-patch member: a source never hands the viewer a patch.

`signature` and the topology's `revision` are separate on purpose. `signature` says which files are
on screen, and changing it drops the remembered scroll offset, the collapsed files, and any gap the
reader opened. `revision` says what those files currently claim, and changing it stops the requests
for the old revision and leaves the reader where they were. A working tree needs the two apart,
because an agent saving a file mid-review moves the content every poll, and treating that as a new
diff would throw the reader back to the top each time. A pull request does not: a new commit is both,
so the GitHub pane's signature is the revision.

A new revision reloads only what moved. Every segment is keyed by its content, so a segment whose file
did not change keeps its rows, and an agent saving one file reloads that file's segments and nothing
else.

Behind the changes pane's document is one resource, `LocalStatus`, which carries the branch, its
upstream, and how far the branch is each way alongside the file list, so no two regions of the panel
can describe different trees. It is one `git status --porcelain=v2 --branch --untracked-files=all`
call plus two numstats and a filesystem check for a half-finished merge or rebase, and the node shares
all of it across clients for two seconds ([workspaces-and-tasks.md](./workspaces-and-tasks.md)
§ Worktree status reads). Two reads would
disagree for a poll interval, which is why the header's totals, the groups, the branch bar's counts
and the banner all derive from this one record. The last flag is what makes an untracked directory
arrive as the files inside it: git's default collapses one to a single `dir/` entry, and a row named
after a directory has no patch to show and no file to discard.

Three members exist for what a caller draws that the viewer has no concept of. `threads` are inline
conversations, complete when the topology is, and placed by their line number. `lineExtra` puts
content under a code row: `anchors` names every line that has some, up front, so the document reserves
for it before the segment loads, and `render` draws one line's inside the segment so its height is
measured with it. `lineAction` adds a click affordance on a code line. The changes pane uses the
second for review notes and the third for Alt-click to send a line reference to the agent.
The Changes source and a task's GitHub PR source supply `openLine`: an added line shows a hover button
in its first gutter that opens the task's file at that new-side line in the editor. Repository PR browse
has no task editor, so its source omits the callback. The viewer hides the button for deleted lines,
which have no corresponding line in the current file, and for sources without the callback. A PR's
line number comes from the PR head; the local task file can differ if its worktree has moved on.

Review-note writes publish `plugin:changes:review-notes-changed` only after create, edit, delete, or
sent-state persistence changes the public result. The frame carries `{ taskId, total, unsent }`, not
note ids, paths, snippets, or bodies, so badges and delivery gates can react without receiving review
content. Consumers that need the notes themselves continue to use the task-authorized route.

`plugins/github/src/client/DiffForPull.tsx`, `plugins/github/src/client/ComparePreview.tsx` and
`plugins/changes/src/client/changesModel.tsx` are the three implementations, and each is short enough
to read in one sitting. That is the measure of whether the port is the right size.

## Data flow

Every document is built on the node. A provider parses and cuts each patch once, answers the
descriptors, and answers segments by patch key when they are asked for:

- A **pull request**'s patches are cut when they are mirrored, and each file's descriptors are stored
  as a small blob beside its patch body ([github-integration.md](./github-integration.md) § Diff
  documents). `GET …/pulls/:number/diff` reads the file rows and those blobs and parses nothing.
  Segments and search are two repository routes, `POST …/diff/segments` and `POST …/diff/search`,
  because a segment is addressed by the patch's digest and a compare preview stores its patches the
  same way.
- A **compare preview**'s patches arrive inline from GitHub. The compare route stores each under its
  digest and answers a document, so the preview loads its segments through the same two routes.
- A **working tree**'s document is read by path and status key (`POST …/local/document`), diffed in
  batches of paths rather than a process per file, and held in a process-local cache
  (`plugins/changes/src/server/localDocument.ts`). A segment request whose patch key is not the one the
  last document gave its file is refused with `409 revision_conflict`, and the Changes source refreshes
  its document when it sees one, so the viewer never draws one file from two states of the tree.
  Staged and unstaged are separate documents, and segments and search go out under the staging area
  of the document that described them. The batch pins git's `a/` and `b/` prefixes and reads each
  path literally, so a user's diff settings or a path such as `app/[slug]` cannot change what a file
  is given. A batch git cannot print, such as one past its output cap, is read one file at a time,
  and a file git cannot read has no diff rather than failing the document. The pane asks for at most
  the first 5,000 stacked files. A failed document read keeps the last document on screen.

The GitHub task pane and repository browse read the same document; the file list beside them still
reads the summaries already warmed by the PR list. The client never holds a whole patch.

The changes pane's list is a navigator, not a selector: every file's hunks are stacked in one
scroller and clicking a row scrolls to it, the way the pull-request pane's list works. Staging is a
checkbox, one per row and one per group; the two verbs that are not staging, Discard and Send to
agent, are in the row's overflow menu.

The panel's footer reads top to bottom in the order things happen: the banner while a merge or rebase
is in flight, the branch bar, the `changes:push-actions` slot where another plugin says what to do next
([plugins.md](./plugins.md) § Cooperative extension points), the commit editor, and the button row. The
bar's primary button carries one verb, and which one is a function of the one status read: **Publish** with
no upstream, **Pull** when the branch is behind, **Push** when it is ahead, and **Fetch** when the two
are level. Behind wins over ahead, because a push from behind fails and a pull from ahead does not, so
the button offered is the one that can work.

Nothing here watches the filesystem. The panel re-reads on its own mutations, on the rail's status poll
every 10 seconds, and on `head:changed` ([api-reference.md](./api-reference.md) § Events). An agent's
file save shows up within 10 seconds and an agent's commit within one poll, which is the same freshness
the rail's dirty marker has. The poll and `head:changed` only count while the pane is drawn. The host keeps
the pane's model after the reader leaves the task, and a refresh missed then is made once when the
pane is drawn again ([panes.md](./panes.md) § Layout model).

The list draws three groups: Conflicts, Tracked, and Untracked. An unmerged file has its own status
rather than reading as a modification, it has no line counts, and it has no checkbox, because git's
answer to "stage a conflict" is "mark it resolved" and there is no half of one that can sit in the
index while the rest does not. Its overflow menu says so. A tracked file staged and then edited again
is one row with an indeterminate checkbox, and ticking that stages the rest.

Discard means one thing wherever the row sits: put this file back the way the last commit has it. It
is `git restore --source=HEAD --staged --worktree`, both areas at once, because a worktree-only
restore rewrites the file from the index and a file that was staged simply comes back — discarding a
newly added file did nothing at all. A rename is discarded by both of its names, or the old one stays
deleted. An untracked file has nothing to restore from, so it is deleted instead.

It stacks one staging area at a time, and `stackFor` in `plugins/changes/src/client/model.ts` says
why: git reports a file staged and then edited again twice, once per area, and the row model keys a
file by its path alone, so a combined stack would hold two files claiming the same identity. Which
area is on screen is the one the highlighted row's checkbox names — checked stacks the index, checked
partly or not at all stacks the working tree — and the default is the first unstaged change, because
one staged file should not hide twenty unstaged ones from a reader who has not clicked anything.

Filling a gap needs the new side of the diff, and for a working tree that is not a ref: `git show`
reads objects, and the new side of an unstaged diff has never been written to one. `localNewSideText`
serves both cases, the index for a staged diff and the file on disk for an unstaged one, and refuses a
symlink because a repo can hold one pointing anywhere and the path arrives over HTTP. The pane carries
the staging area in the document file's `sha`, which the viewer never reads and hands straight back
through `fileText`. A deleted file gets a null `sha`, which is how its gaps render inert: there is no new side
of a file that is gone.

The row types (`DiffThread`, `CodeRow`, and their siblings, in `kit/diff/diffModel.ts`) are
structural rather than named after either plugin's wire types. GitHub's `Thread` and Changes' review
notes satisfy them without either plugin importing the other, so the renderer describes what it needs
rather than one caller's type. The parser follows the same reasoning. A GitHub per-file patch is
hunks-only, so `synth` puts a header in front of it for gitdiff-parser, and it lives in
`@acorn/diff-document` because both GitHub's patches and local `git diff` output reach that parser,
on the node.

## Parsing and highlighting

The node parses; the renderer only builds rows for segments it has, and colours them afterwards.

The viewer's list is of items, not rows (`features/diff/documentView.ts`): one per file header, one
per segment, one per no-diff file, and one per 64-row slice of an expanded gap, all built from the
topology. The segment loader (`features/diff/segmentLoader.ts`) is told, every time the virtual range
moves, which segments are on screen and which are near: the virtual range plus two segments beyond
each end. It asks the source for the missing ones in batches of eight, the ones on screen first, at
most two requests in flight. Anything queued that has left the range is dropped, and a request whose
every segment has left is aborted, so a pane left open does no more work than its range needs. There
is no background drain. A new revision stops every request in flight and cannot publish into the new
document, because a segment is published by its content key and a stale answer's key is not one the
new topology asks for.

A loaded segment publishes its plain rows at once: each code line is one token of its raw text. The
segment is then queued for colour, in the same demand order, one segment at a time: syntax tokens per
hunk-side through the highlight worker, and word spans for paired changes through the word-diff
worker (`enrichDiffRows`). The coloured rows replace the plain ones under the same index, so no row is
remounted and nothing moves, and only when the segment still holds the rows the colouring started
from. An oversize segment stays plain. A dead or slow worker leaves plain text on screen, which is
correct and readable.

The loader keeps no rows of its own. They go into the node's resident segment cache, described in
§ Resident segments below, which is how a pane opened a second time draws without asking the source.

Highlighting runs in `highlighter.worker.ts` (`client-core/src/infra/highlight/`), off the thread that
draws. Tokenizing a 45-file diff on the main thread cost about 2 seconds, in unbroken per-file blocks
of up to 325ms.

The worker also solves a content security policy problem. Shiki's fast path compiles Oniguruma to
WebAssembly, and `WebAssembly.instantiate` is gated by `script-src`. The renderer's policy is
`'self'` with no `wasm-unsafe-eval` (`apps/desktop/src-tauri/src/app_scheme.rs`), so the WASM engine
throws at startup there and Shiki falls back to its JavaScript regex engine, measured at 4.6x slower
on the same input. A worker loaded from a same-origin URL takes its policy from that script's own
response headers rather than from the document, so `app_scheme.rs` serves `highlighter.worker.ts`,
and only that file, with `wasm-unsafe-eval` added. Nothing else widens: the worker's own policy is
stricter than the document's in every other direction (`default-src 'none'`, `connect-src 'none'`),
because it has no DOM, no bridge to the shell, and no network, and it only takes strings and returns
colours. Keep `shiki/wasm` on the inlined build (622 KB of base64 inside the module); a build that
fetches its `.wasm` at runtime would need a network permission the worker is better off without.

Every call into the worker sends a whole document, never a line. A `postMessage` per line is roughly
2,600 round trips for a 45-file diff, slower than the main-thread code it replaces. Batching by
document also lets Shiki thread grammar state from line to line, so a block comment, a template
literal, or a docstring spanning several lines colours correctly. Per-line calls started every line
from a cold grammar state and got all three wrong. A request that has not returned after 10 seconds
counts as stuck rather than slow. The slowest real document measured was about 110ms, and the first
request of a session also pays for spawning the worker and instantiating the WASM engine, about 340ms
end to end, so 10 seconds is a backstop rather than a budget.

The worker tracks one of three states: `cold` (nothing tried), `live` (spawned and answering), or
`dead` (unavailable, or it failed its first request). Once `dead`, every later call goes straight to
the main-thread fallback instead of retrying, because both failure modes, no `Worker` in the
environment and the policy not applying to the worker script, last for the life of the window. The
fallback logs loudly. The failure it replaces was silent, because the WASM engine's rejection landed
inside the highlighter's own promise and every surface rendered grey with no error a developer would
see.

Grammars load lazily. They total about 1.7 MB across the set, and a given diff touches two or three,
so a TypeScript-only pull request does not pay for the C++ grammar (419 KB, the largest single one).
`messages.ts` defines the wire format the worker and the main thread share, and imports nothing from
either side. The worker must not pull in `kit/diff/diffModel.ts`, which would drag `diff` and
`gitdiff-parser` into the worker bundle, and the client must not pull in the worker's Shiki imports,
which would put the WASM engine back on the main thread.

Paired delete/insert lines use a second worker for word-level diffs, with the same cold/live/dead
shape and a main-thread fallback as highlighting, without sharing Shiki's wider worker policy or
lifecycle. One segment's pairs are sent as one batch so the comparison cannot block scrolling.

## Resident segments

A segment's rows outlive the pane that loaded them. `features/diff/segmentCache.ts` keeps the node's
recently read segments in memory, so returning to a diff draws its last rows at once, already
coloured, and asks the source only for what the cache no longer holds.

**One cache per node.** The cache is found by the pane's query client (`segmentCacheFor`), which is
one per node (§ Renderer query cache in [caching.md](./caching.md)). It has the same partition and
lifetime as the rest of what the renderer holds for a node. A node switch mounts the other node's
client and so the other node's cache. `dropNode` clears the removed node's cache at once. Unmounting a
pane leaves the cache alone. The terminal client has its own diff loader and no resident cache.

**Keys.** An entry is one segment of one file, keyed by `residentKey`: the segment's content key
(the patch digest, the diff-document version, and the ordinal), the path, and the sha. Rows are a
pure function of those four. The path picks the grammar, and the sha is what a gap reads the file
through, so two files with the same patch never share rows. The key holds no source, route, pane,
revision, or projection. The same patch on a task's pull request and on the repository's view of it
is one entry. Review threads are not in the key, so resolving a thread or editing a comment leaves
the code rows alone. Theme is not in the key either, because every token carries both themes'
colours. The renderer's own parser and tokenizer cannot change within a process, and nothing is
persisted, so there is no separate enrichment version.

**Plain rows and colour.** An entry holds its plain rows and, once colouring lands, its coloured
rows beside them. `plainWeight` and `enrichmentWeight` weigh the two apart. A reader returning to a
segment whose colour was evicted sees plain rows at once, and the loader colours it again. When the
highlight worker timed out on a segment, its colour is the main thread's fallback and the entry marks
it `provisional`. The pane that got it draws it and does not try again. The next pane to show the
segment colours it once more, because a timeout can come from a busy worker rather than the code.

**Budget.** Two ceilings, both counted over every entry: 40,000 rows (`SEGMENT_CACHE_ROWS`) and
32 MiB of estimated bytes (`SEGMENT_CACHE_BYTES`). The byte estimate is a budget, not the engine's
heap. It counts a fixed allowance per row, array, and token, and two bytes a character for text the
entry owns. Strings rows share, such as the path and the raw text a plain token points at, count
once. A row count keeps an underestimated allowance from letting the cache grow without bound. The
numbers were chosen by hand, not from a heap sample. When an insert or a colouring leaves either
ceiling exceeded, the cache walks from the least recently wanted segment. At each segment that no
pane holds, it drops the colour first, and then the plain rows if that was not enough. It stops as
soon as both ceilings hold.

**Holds.** Each pane's loader holds the segments on screen, the two either side, and whatever it is
loading or colouring, and replaces that claim on every range change. A held segment is never evicted.
A batch is held from its request until the request ends, however it ends. A request that the reader
scrolled away from is aborted and its claim dropped. A new revision keeps the old claim until the next
range change replaces it, so rows that survive the revision are not evicted in between. Unmounting
releases everything the pane held. When two panes ask for the same segment at once, the entry that
landed first stays, with any colour it has, because the rows are a pure function of the key.

**Oversize.** If what panes hold is over a ceiling after an insert, nothing unheld is left and the
cache counts an oversize insert. It keeps the held segments, however large, and the next change to a
claim evicts them once nothing holds them. With 64-row, 32 KB segments this needs a single row near
16 million characters.

**Revisions.** Nothing in the cache ever changes content, because a moved file has a new patch digest
and so a new key. What differs is when old entries go:

- When the file set stays the same and a file's patch moves, as a working tree's does on every save,
  the pane drops the old patch's segments of that file at once (`supersede`). A second pane holding
  them keeps them. A Changes poll that finds nothing new moves no revision and drops nothing.
- When the file set changes, as a pull request's does with each commit, the old entries stay until
  the budget takes them, because another view may still show that revision.

**Not cached here.** Heights stay with the pane (§ Row geometry), and so do DOM nodes, Solid state,
composers, drafts, observers, and requests. Nothing in this cache is written to disk or to the query
cache's persisted snapshot.

The health reading's `resident` group reports the cache's weight against both ceilings and its
inserts, evictions, and oversize inserts, plus the pane's own hits and misses. The telemetry samples
are listed in [telemetry.md](./telemetry.md) § Renderer seams.

## Row geometry

Code lines do not soft-wrap. A long line scrolls sideways instead, and the line numbers and the +/-
marker stay pinned to the left edge while it does.

The layout depends on that. It positions items, not rows: a segment's container is absolutely
positioned and its rows are in normal flow inside it. Every code row and hunk header is exactly one
line tall and a gap row is 28px, so a segment's code is an exact height from its descriptor before its
rows arrive. `diff.css` holds each of those heights to the pixel, because nothing measures them. A
segment on screen whose rows are still loading draws a placeholder of exactly its height that says so,
so nothing below it moves when they arrive and the scrollbar never collapses. When lines wrapped, a
row's height was a layout question: each one painted at its estimate and was corrected a frame later,
and a first correction above the scroll offset moved `scrollTop` to compensate. Scrolling flashed and
stuttered.

The height of the document is two sums kept apart:

```text
document height = exact fixed height of every item + every dynamic block's height
```

The fixed side is code rows, hunk headers, gaps, file headers and no-diff rows, from the topology. The
dynamic side is whatever can change height: an inline thread, and whatever a line draws under itself
(the source's note, another plugin's marks, an open comment composer), which is one block per line.
`kit/diff/layoutIndex.ts` holds the fixed heights in a prefix array, rebuilt only when the list of
items changes: a new document, a collapsed file, an opened gap, or the other projection. Each item's
dynamic total sits in a Fenwick tree, so a block that resizes updates one item's total in O(log
items), and nothing is done for the code below it. Inside an item, a block sits at a point in the
item's code rows (a note after its line, a thread after the line it is anchored to), so a place in the
document is either a point in an item's code rows or an offset into a block. The health reading's
`fixedRebuilds` counts the rebuilds, so a resize that caused one would show.

`features/diff/diffLayout.ts` is the range and scroll authority built on that index. It derives each
item's blocks from its rows when they are loaded, and from its threads' line numbers when they are
not, reserving 140px for an open thread and 50px for a collapsed one until they are measured. It
decides which items are mounted, 800px beyond each edge of the viewport, in pixels rather than items,
because an item is a 36px header in one place and a 64-row segment in another. That is at most a few
hundred rows mounted at any size of document. The item keys are the file path and the segment ordinal,
so an item that stays in range keeps its DOM while the range moves and a composer typing inside it
keeps its focus. It sets the canvas height itself, so a scroll correction is never clamped against a
canvas the renderer has not grown yet. TanStack Virtual is no longer in the diff: its single-lane path
rebuilds every offset after the earliest resized item and writes `scrollTop` from inside its measure
callback, which is the cost this layout exists to avoid.

Only dynamic blocks are measured, by `kit/diff/measureScheduler.ts`. One `ResizeObserver` per pane
watches the scroller and every mounted block, marked with `data-block`, and nothing else. Its callback
marks blocks dirty and reads nothing. A pass then reads every dirty, connected block in one batch,
compares each reading with the height the geometry holds, and commits the changes as one. At most one
commit lands in a frame; a second waits for the next. The pass runs inside the observer's callback,
after layout and before paint, so a thread opening on screen and the content it pushes down move in
the same frame. While the reader is scrolling, a block wholly above the place they are reading stays
dirty until the scroll settles (150ms after the last scroll event), because its commit would have to
move `scrollTop` in the middle of the gesture. Everything else commits at once, since it moves nothing
under the reader. A block that is not mounted keeps its estimate or its last measured height, and
makes no DOM.

A measured height is reused only while the block's fingerprint matches: for a thread, whether it is
collapsed or resolved and its comments; for a line, what it draws and whether its composer is open.
Typing is not in the fingerprint, because typing only happens in a mounted block, which is measured.
Heights are kept per projection, with the width bucket (80px of scroller width) they were measured
at. A pane resize re-measures every mounted block, because each one reports its own new size; one
that is not mounted keeps its old height as an estimate until it is. The 150ms settling window and
the 80px bucket were chosen by hand, because no WebKit momentum or resize probe has run.

Every geometry change keeps the reader where they were by identity. Before the change the layout
notes the reader's place: the item the viewport starts in and a point in its code rows, or the block
and an offset into it. After it, it resolves that place in the new geometry and makes at most one
scroll write:

- A block wholly above the viewport that changes height moves the view by the change, so the reader's
  row stays put.
- A change below the viewport moves nothing.
- A block the reader is inside keeps its own top where it was, and grows or shrinks below it.
- A place whose item has gone, as a collapsed file's segments do, lands on that file's header, and the
  health reading counts it as substituted.

Its scroll writes are marked as its own until the frame after them (`kit/lib/scrollAuthor.ts`, which
the `Timeline` shares), and the reader's wheel, touch, pointer and key input is timestamped, so a
correction's own scroll event never reads as the reader moving, and never keeps the settling window
open.

Because nothing wraps, something has to be wide enough to hold the widest line, and unified and split
answer that differently.

In unified the canvas itself is that wide, and the whole pane scrolls sideways. The width comes from
the topology (`totals.columns`, the widest code line in the document, widened by any gap the reader
opened, handed to CSS as `--diff-cols` in columns, since the font is monospace and one column is 1ch)
rather than from `max-content`: only the items inside the virtual window have boxes, and a
layout-derived width would change as you scrolled vertically and drag the horizontal scroll position
with it. Because the number is in the topology, the canvas is its final width before any row loads.

File headers stay visible while the wide canvas scrolls sideways, the same way the gutters do:
each head is `position: sticky; left: 0` inside its canvas-wide row, sized to the visible
scrollport with `100cqw` (`.diff` is an inline-size container). That is also why the sticky
current-file header renders inside the row canvas rather than as a direct child of the scroller —
a sticky element can only travel within its containing block, and the scroller's content box is
only one scrollport wide. Hunk headers and expand bands scroll away with the code, as they do on
GitHub.

The two line numbers and change marker share one sticky gutter box. A normal code line owns no local
signals: the comment composer, including its busy and error state, mounts only for the one open line.

In split the pair always fits the pane, so half the pane stays half the pane however long a line
gets, and each column scrolls horizontally inside itself. The scroller is each row's own code box, so
there is one per row and `splitScrollSync.ts` keeps a column's rows in step, across every mounted
segment. Their scrollbars are
hidden, since forty stacked would be noise rather than navigation, so a column scrolls by trackpad or
shift+wheel.

## Modes

- Unified mode renders old/new lines in one stream and is the default.
- Split mode renders the same items, each segment's rows paired into bands inside the segment. Its
  height comes from the descriptor's band count, so the scrollbar is exact in both modes.
- Word-level spans are attached only to paired delete/insert runs, preserving unchanged text, and
  their comparison runs in `wordDiff.worker.ts`.
- Gap rows reveal context from the new side the source reads by `fileText`. The revealed lines are
  keyed by the file's path and the content key of the segment the gap sat at the edge of, so a new
  revision of that file leaves them behind by construction. The path is in the key because two files
  with the same patch, such as one version bump in several manifests, share a content key, and they are drawn as 64-row slices beside that segment so
  opening a five-thousand-line gap mounts no more than any other part of the document.
- Find (Cmd+F) asks the source for a page of matches across the whole document
  (`features/diff/findController.ts`) and takes the reader to one by its segment and row. The row's
  pixel is walked from the segment's loaded rows in the current projection, so split mode lands on
  the band that holds the row, and is scaled from the descriptor before the rows load. Only that
  segment loads; the marks draw on whichever matched rows are mounted, keyed by path as well as
  segment. Only a change of match moves the reader. The next page is fetched when the reader steps
  past the last match, and a page with no matches but a cursor is read past at once. The query goes
  to the source and nowhere else.

## Review threads and state

Inline thread anchors use file path, side, and line coordinates. A thread is placed in the segment
whose line span covers its line, from the topology, so its space is reserved before its segment
loads, and drawn under the code row with that line number when it does. Thread state is fetched with
the PR detail and updates through GitHub mutations. Viewed-file state is local app data and is merged
into the file projection; it is not sent to GitHub.

The source's selected path scrolls to that file's header as soon as the topology is in, because its
offset is exact before any of its rows load. The GitHub pane reads it from `?file=`. Collapsing a file
drops its segments from the list and keeps its header; collapsing one from the sticky header scrolls
back to that header, so the reader stays on the file they collapsed.

The reading place and collapsed files are remembered per scope for the session (`diff/viewState.ts`):
a task and the classic browser keep separate entries for the same content, and a task's entries are
evicted when it is archived. The place is the identity described in § Row geometry, not a pixel
offset, so it survives a thread measured above it or a narrower pane. Both are tied to the source's
signature and the place to its projection, so new commits drop the stale place and collapse choices
instead of restoring them against a different diff. An explicit file navigation wins over a saved
place.

### Marks from other plugins

A diff pane may name an `annotation` extension point, and the host draws every contributor's marks under
the code row they name ([plugins.md](./plugins.md) § Cooperative extension points). The two owners are
`changes:diff-line` and `github:diff-line`, both keyed `{ file, line, side }`, and `side` is the row's
own kind rather than the view mode: a mark on "line 42 as it will be" means the new side whether the
reader is in split or unified.

The marks compose with the source's own `lineExtra` rather than replacing it, in that order, because
the source's annotation is the one the person using the pane wrote. They are drawn inside the segment,
so a mark arriving for a row already on screen grows the segment instead of overlapping the rows below.

Rows with no source annotation and no contributed mark do not mount an annotation component or an
empty wrapper.

Only the code rows of the items in the virtual range are asked about, in one request per contributor.
The host compares the key set before asking, so a scroll within the same segments costs a string
compare, and a coverage plugin on a million-line diff is asked about the few hundred rows the reader
is near.

Two owners open a line point: `changes:diff-line` over the working tree, and `github:diff-line` over a
pull request. Both declare the same three fields in the same order, both hand the point's name to
`DiffPane`, and a contributor that answers one can answer the other without knowing which pane it is
drawing in.

The pull-request navigator keeps no scroll entry of its own any more. It used to, in a
`reviewViewState.ts` beside the pane; the navigator is a region of a host layout now, and the diff
column's own position and collapsed files are still the viewer's, in `diff/viewState.ts`, keyed by the
same scope.

## What large-surface rendering refuses

The document, the segment loader, the dynamic-block layout, and the resident cache were built on
2026-09-26 to keep a 2,200-file, million-row pull request bounded, after GitHub's account of
[rendering huge pull requests](https://github.blog/engineering/user-experience/rendering-huge-pull-requests-in-the-github-copilot-app/).
These are the alternatives that work refused. Each one will be suggested again, so reopen it with new
evidence against the reason, not beside it. The timeline's share is in
[client-surfaces.md](./managed-agents/client-surfaces.md).

**Reading a provider's first page as the whole.** Refused. A fast view of a truncated pull request is
wrong. Every connection is walked to its end, the pages are staged and swapped in at once rather than
published as they arrive, and an upstream ceiling is reported as incomplete
([github-integration.md](./github-integration.md) § Pull request detail and files).

**Keying a patch by the head blob SHA.** Refused. Two bases can produce different patches that end at
the same blob. Patch and segment keys come from the patch text. Only new-side file bodies keep the
blob SHA.

**Fixing only the DOM.** Refused. The DOM was already virtualized. The cost was parsing, colouring,
keying and scanning every file, and changing overscan or the row components leaves all of that in
place.

**Letting idle time drain the document.** Refused. Idle work delays the cost without bounding it, and
it competes with the next interaction. Work outside the demand range is dropped, not deferred.

**Waiting for colour before showing text.** Refused. Plain rows are correct and readable. Colour is
enrichment under the same row identity, so a dead or slow worker cannot leave a segment blank.

**One variable-height table for every row.** Refused. A comment changing height must not rebuild exact
code geometry. Dynamic blocks have their own index, and fixed rows keep theirs.

**Fixed-height comment slots.** Refused. Markdown, images, disclosures, suggestions and composers
combine without limit. A large slot leaves whitespace and a small one clips. An estimate is only a
reservation until the block is measured.

**A `ResizeObserver` that writes heights.** Refused. Reading and writing around the same element feeds
back, and a burst of blocks would commit many times in one frame. The observer marks blocks dirty and
one pass reads and commits.

**Inferring reader input from `scroll` events.** Refused. Corrections, navigation and browser clamps all
emit `scroll`. Input events say the reader moved, and the layout marks its own writes.

**A pixel as the reading place.** Refused. Loading, resizing, disclosure and collapse all invalidate a
pixel. The place is an item or block identity and an offset into it.

**An imperative recycled-DOM renderer.** Refused. The Solid row components own accessibility, comment
interactions, annotations, editor actions, plugin seams and two projections, and a second renderer
would have to rebuild all of them. Reopen only if a real-window profile of the `canonical` fixture
puts the remaining cost in mounted component overhead.

**Provider types in client-core.** Refused. The document describes files, rows, anchors and threads.
GitHub's cursor, review and REST types stay in the GitHub plugin, and staging and worktree types stay
in Changes.

**An old-and-new `DiffSource` adapter.** Refused. Building whole patches and segmented documents side
by side doubles memory and keeps two behaviours alive. The port moved once, in plugin API major 2
([package-shape.md](./plugins/package-shape.md) § The plugin API).

**Caching whole documents by count.** Refused. One document is 50 rows and another is a million. The
resident cache weighs segments by rows and bytes.

**Persisting parsed rows, tokens, heights or DOM.** Refused. They are large, cheap to rebuild, and tied
to the parser, tokenizer, width and rendering version. The node's patch and descriptor blobs are the
durable layer ([caching.md](./caching.md) § Immutable blob cache).

**Document content in diagnostics.** Refused. Diffs hold proprietary source and comments. Health
numbers carry fixed labels and no path, line, body or query
([telemetry.md](./telemetry.md) § Rendered-surface health).

**Timing budgets from GitHub or one machine, or a stress test only in jsdom.** Refused. Hardware,
WebKit and build mode move the milliseconds, and jsdom has no momentum, layout or paint. The tests
assert scaling and lifecycle invariants, and absolute budgets wait for a real-window run on a
supported host ([testing.md](./testing.md) § Large-surface fixture).

**A streaming transport for the topology.** Refused as a starting point. The `canonical` topology is
about 2.5 MB over the ordinary JSON route, and it is not paged. Add a stream only if a real-window run
shows people waiting on that transfer, and keep one revision and one ready point when you do.

## What the Changes panel refuses

Ten decisions from the programme that built the panel, each with what would reopen it. They are here
rather than in a design folder because every one of them is a thing the panel will keep being asked
for.

**A branch picker in the bar.** Refused. Zed's `acorn / main` opens a branch list, and checking one out
is how you move between pieces of work in an editor. In acorn a task *is* the piece of work and its
branch is part of its identity: the worktree directory is keyed by owner, repo and branch, and a
worktree's HEAD is checked against its task's branch before it is handed out
([workspaces-and-tasks.md](./workspaces-and-tasks.md) § Worktrees and setup). Checking out another
branch inside a task's worktree is the exact state the `worktree-stale` refusal catches, and it would
hand that task's agent another branch's files. The branch in the bar is a label. To work on another
branch, start a task.

**Hunk and line staging.** Deferred, with the door named. The viewer is shared with the pull-request
pane, renders unified rows through one layout, and has no gutter control. Adding one means a kit
affordance on a diff row, a `git apply --cached` path built from the viewer's row model, and a terminal
rendering for the control, and each of those is its own design. `DiffSource` already has `lineAction`,
and a `hunkAction` beside it is where a stage-this-hunk verb would land.

**Other remotes.** Refused for now. A task's worktree is created from `origin`, its pull request opens
against `origin`, and the branch prefix and base ref are project settings. A second remote is a project
decision, and the day one is needed it belongs on the project row beside the base ref rather than in a
per-push picker. Until then every remote verb says `origin` and means it.

**Chords on the remote verbs.** Refused. The keymap is one shared registry with user overrides and
conflict resolution, so a chord costs every other plugin a chord
([command-palette-and-shortcuts.md](./command-palette-and-shortcuts.md) § Plugin shortcuts). Fetch,
pull and push are used a few times a day and have palette rows. Commit and amend are used many times a
day and have the two chords the `commit` intent already reserves. Force push has neither: arming is its
prompt, and a palette row that ran on Enter would have none.

**A split button in the kit.** Refused. Zed's **Stage All**, **Pull** and **Commit** are split buttons.
A `Button` that opens a menu, drawn beside a `Menu`, draws the same thing out of two nodes that already
exist, and the admission rule asks for two surfaces that cannot be expressed in what exists
([ui-design.md](./ui-design.md) § The closed kit). This is one surface that can.

**A separate Git pane.** Refused. It would put the file list and the checkbox that stages a file in one
pane and the diff of that file in another. The list column of the Changes pane is the rectangle Zed's
dock occupies, and the model behind it is already built once per task.

**A git surface on the rail.** Refused. The rail takes marker data and nothing else, and
`tabrail.task-row` was removed on purpose
(`packages/client-core/src/host/registries/extensionPoints/slots.ts`). The dirty marker keeps saying how
many files changed. An ahead count there would be a marker through the same registry, and it is a
separate change.

**Git write tools for agents.** Not refused on principle, and not built. `local_changes`, `local_diff`
and `git_log` are read-only and share `plugins/changes/src/server/localDiff.ts` with the bridge so the
agent and the person see one tree. An agent has a terminal and uses it, and a write tool defaults
denied under the permission tiers anyway ([agent-tools.md](./agent-tools.md)).

**A commit history in the panel.** Refused. `git_log` exists for the agent and the pull-request pane
shows commits once there is a pull request. A log view is a fourth region or a new pane, and neither is
what the panel is for.

**A warning on archive about unpushed commits.** Refused. The archive check warns about uncommitted
files, and with `ahead` known it could warn about unpushed commits too. Archiving removes the worktree
and not the branch, so those commits survive in the main checkout. A warning that says "your work is
safe" is noise.
