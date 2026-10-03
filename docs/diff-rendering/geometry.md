# Diff row geometry and modes

This page covers how the viewer sizes and positions rows, measures what can change height, keeps your
place, scrolls long lines, and draws unified and split modes. It's part of
[diff rendering](../diff-rendering.md).

## Row geometry

Code lines don't wrap. A long line scrolls sideways, and the line numbers and the `+` or `-` marker
stay pinned to the left edge.

The layout depends on that. It positions items, not rows: a segment's container is absolutely
positioned, and its rows flow inside it. Every code row and hunk header is exactly one line tall, and a
gap row is 28px, so a segment's code has an exact height from its descriptor before its rows arrive.
`diff.css` holds each height to the pixel, because nothing measures them. A segment on screen whose
rows are loading draws a placeholder of exactly its height, so nothing moves when they arrive and the
scrollbar stays the same size.

The document's height is two sums kept apart:

```text
document height = exact fixed height of every item + every dynamic block's height
```

The fixed side is code rows, hunk headers, gaps, file headers, and no-diff rows, from the topology.
The dynamic side is what can change height: an inline thread, and whatever a line draws under itself,
such as a review note, another plugin's marks, or an open comment box, as one block per line.

`packages/client-core/src/kit/diff/layoutIndex.ts` holds the fixed heights in a prefix array. It
rebuilds only when the item list changes: a new document, a collapsed file, an opened gap, or the
other mode. Each item's dynamic total sits in a Fenwick tree, so a block that resizes costs O(log
items) and nothing for the code below it. A place in the document is a point in an item's code rows or
an offset into a block. The health reading's `fixedRebuilds` counts rebuilds.

`packages/client-core/src/features/diff/diffLayout.ts` decides the range and the scroll on top of that
index. It derives each item's blocks from its rows when loaded, or from its threads' line numbers
when not, reserving 140px for an open thread and 50px for a collapsed one until measured. It mounts
items within 800px of each edge of the viewport (`DIFF_RUNWAY_PX`), measured in pixels, because an
item can be a 36px header or a 64-row segment. That's at most a few hundred rows mounted for any
document. Items are keyed by file path and segment ordinal, so an item that stays in range keeps its
DOM, and a comment box keeps its focus. The layout sets the canvas height itself, so a scroll
correction is never clamped against a canvas that hasn't grown yet.

### Measurement

Only dynamic blocks are measured, by `packages/client-core/src/kit/diff/measureScheduler.ts`. One
`ResizeObserver` per pane watches the scroller and every mounted block marked `data-block`. Its
callback marks blocks dirty and reads nothing. A pass then reads every dirty, connected block in one
batch, compares each with the height the layout holds, and commits the changes together, at most once
a frame. The pass runs inside the observer callback, after layout and before paint, so a thread
opening and the content it pushes down move in the same frame.

While you're scrolling, a block wholly above your place stays dirty until scrolling settles, 150 ms
after the last scroll event (`DIFF_SCROLL_SETTLE_MS`), because committing it would move `scrollTop`
mid-gesture. Everything else commits at once. A block that isn't mounted keeps its estimate or its
last measured height.

A measured height is reused only while the block's fingerprint matches: for a thread, whether it's
collapsed or resolved and its comments; for a line, what it draws and whether its comment box is
open. Heights are kept per mode, with the 80px width bucket they were measured at
(`DIFF_WIDTH_BUCKET_PX`). The 150 ms window and the 80px bucket were chosen by hand.

### Keeping your place

Every geometry change keeps you where you were. Before the change, the layout notes your place: the
item the viewport starts in and a point in its code rows, or a block and an offset into it. After the
change, it finds that place in the new geometry and makes at most one scroll write:

- A block wholly above the viewport that changes height moves the view by the change, so your row
  stays put.
- A change below the viewport moves nothing.
- A block you're inside keeps its top where it was and grows or shrinks below.
- A place whose item has gone, such as a collapsed file's segment, lands on that file's header.

The layout marks its own scroll writes until the next frame
(`packages/client-core/src/kit/lib/timeline/scrollAuthor.ts`, shared with `Timeline`), and timestamps
your wheel, touch, pointer, and key input. So a correction's scroll event never reads as you moving.

### Horizontal scrolling

With no wrapping, something has to be wide enough for the widest line, and the two modes answer
differently.

In unified mode, the canvas is that wide and the whole pane scrolls sideways. The width comes from
the topology: `totals.columns`, the widest code line, widened by any gap you opened, handed to CSS as
`--diff-cols` in `ch` units. A width measured from layout would change as you scrolled vertically,
because only items in the visible range have boxes. With the width in the topology, the canvas has
its final width before any row loads.

File headers stay visible while the canvas scrolls sideways. Each header is `position: sticky; left:
0` inside its canvas-wide row and sized to the visible width with `100cqw`, because `.diff` is an
inline-size container. That's also why the sticky current-file header draws inside the row canvas: a
sticky element moves only within its containing block. Comment threads and the open line's comment
box are pinned and sized the same way. Hunk headers and expand bands scroll away with the code.

The two line numbers and the change marker share one sticky gutter box. A normal code line owns no
local state. The comment box, with its busy and error state, mounts only for the open line.

In split mode, the pair always fits the pane, and each column scrolls sideways inside itself. Each
row's code box scrolls, and `splitScrollSync.ts` keeps a column's rows in step across every mounted
segment. Their scrollbars are hidden, so a column scrolls by trackpad or Shift+wheel.

## Modes

The viewer draws the same items in each mode:

- Unified mode draws old and new lines in one stream. It's the default.
- Split mode pairs each segment's rows into bands inside the segment. Its height comes from the
  descriptor's band count, so the scrollbar is exact in both modes.
- Word-level spans attach only to paired delete and insert runs, and keep unchanged text.
- Gap rows reveal context from the new side, read through the source's `fileText`. The revealed lines
  are keyed by the file's path and the content key of the segment the gap sat beside, so a new
  revision of the file leaves them behind. The path is in the key because two files with the same
  patch, such as one version bump in several manifests, share a content key. Revealed lines draw as
  64-row slices, so opening a 5,000-line gap mounts no more than any other part of the document.
- Find (Cmd+F) asks the source for a page of matches across the whole document
  (`packages/client-core/src/features/diff/findController.ts`) and takes you to one by segment and
  row. In split mode it lands on the band that holds the row, and before the rows load it scales from
  the descriptor. Only that segment loads. Marks draw on matched rows that are mounted. Only a change
  of match moves you. The next page loads when you step past the last match, and a page with no
  matches but a cursor is skipped at once. The query goes to the source and nowhere else.
