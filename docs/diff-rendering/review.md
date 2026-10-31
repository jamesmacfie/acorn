# Diff review threads and marks

This page covers inline review threads, the file filter, the view state the viewer remembers, line
drafts, and the marks other plugins draw under a code row. It's part of
[diff rendering](../diff-rendering.md).

## Review threads and state

Thread anchors use file path, side, and line. A thread goes in the segment whose line span covers its
line, from the topology, so its space is reserved before the segment loads, and it draws under the
code row with that line number once the segment loads. Thread state comes with the pull request
detail and updates through GitHub mutations. Viewed-file state is local app data merged into the file
list, and it isn't sent to GitHub.

The source's selected path scrolls to that file's header as soon as the topology arrives, because its
offset is exact before any rows load. The GitHub pane reads it from `?file=`. Collapsing a file drops
its segments from the list and keeps its header. Collapsing one from the sticky header scrolls back to
that header, so you stay on the file you collapsed.

A pane with no router drives its diff with `presentation:file-scroll`, which names the diff's route
key, a path, and optionally a line and its side. Send it with `requestFileScroll`, which holds the last
one until a diff with that route key takes it, so a diff that's still mounting gets it. The diff goes
to the file's header once the topology arrives, and to the line once the segment that covers it loads,
centered in the view. A line no segment covers, such as one outside every hunk or one from an older
patch, lands on the file's header. A held place counts as explicit navigation, so the saved place
isn't put back over it.

The file filter at the start of the toolbar hides every file whose path doesn't match, header and
all, and scrolls the list to the top (`packages/client-core/src/features/diff/fileFilter.ts`). The
query matches whole, ignoring case, at its last position in the path, which is usually the file name.
The header marks the matched characters. Find still counts matches in hidden files. When nothing
matches, the viewer draws a centered empty state with **Clear filter** instead of the canvas.

### Remembered view state

The reading place, collapsed files, and file filter are remembered per scope for the session
(`packages/client-core/src/features/diff/viewState.ts`). A task and the classic browser keep separate
entries for the same content, and archiving a task evicts its entries. The place is the identity
[row geometry](./geometry.md#keeping-your-place) describes, not a pixel offset, so it survives a
thread measured above it or a narrower pane. The place and collapsed files are tied to the source's
signature, and the place to its mode, so new commits drop them instead of restoring them against a
different diff. The filter is text, so it survives new commits. An explicit file navigation wins over
a saved place.

The pull request navigator keeps no scroll entry of its own. It's a region of a host layout, and the
diff column's place and collapsed files belong to the viewer, keyed by the same scope.

### Rows and line drafts

The canvas iterates the layout's item keys. Items that stay in range keep their DOM, while their row
data, comment targets, indices, and offsets stay reactive. The key maps hold only the mounted window. A
content refresh changes the file's gap revision and removes its expanded context. A source or file-set
change advances the pane generation, and reads and tokenizing check both generations before they
publish, even when an identity changes and comes back. Unchanged files keep their expanded context
and reading place.

A line comment captures its controller, its original draft text, and its invalidation callback before
it awaits the write. A controller can provide `acknowledge(originalBody)` to clear exactly the draft
that was sent. `DiffPane` clears the visible draft only if its source, generation, key, and text still
match, so edits made while sending, and newer drafts, survive. Controllers without `acknowledge` fall
back to comparing text. A failed send keeps its draft.

## Marks from other plugins

A diff pane can name an `annotation` extension point, and the host draws every contributor's marks
under the code row they name ([plugins](../plugins.md) § Cooperative extension points). The points
are `git:diff-line` over the working tree, `github:diff-line` and `bitbucket:diff-line` over a pull
request, and `gitlab:diff-line` over a merge request. All are keyed `{ file, line, side }` with the
fields in the same order, and all hand the point's name to `DiffPane`. `side` is the row's own kind,
not the view mode: a mark on line 42 of the new file means the new side in split or unified mode.

The three code hosts add `task` after those fields, `{ file, line, side, task }`. `DiffPane` takes
`annotationKeyFields`, fields it adds to every row's key, and `ChangeRequestDiff` passes
`{ task: taskId }`, or `{ task: '' }` on a diff browsed outside a task. The host builds the lookup from
the declared fields, so a mark answered for one task's diff never draws on another task's diff of the
same file and line. A contributor that answers each mark with the key it was asked about serves all
four points with the same code.

A mark can be a note: `note`, `{ author, label }`, beside a markdown `detail`, on a point that
accepts detail. The three code hosts' points do. A source with an inline chat gets a row's notes in
`inlineChat.render(row, notes)` and draws them, and the host leaves them out of the row's marks.
`ChangeRequestDiff` draws them as the line's agent card, with each note as an opening message the
reader can reply to, credited to the mark's plugin id ([shared review views](../plugins/change-request-ui.md#build-a-model)). Anywhere
else a note is an ordinary mark.

Marks follow the source's own `lineExtra`, because the source's annotation is the one the person
using the pane wrote. They draw inside the segment, so a mark arriving for a row on screen grows the
segment instead of overlapping the rows below. Rows with neither mount no annotation component or
wrapper.

The host asks only about code rows in the visible range, in one request per contributor. It compares
the key set before asking, so scrolling within the same segments costs a string comparison, and a
coverage plugin on a million-line diff is asked about the few hundred rows you're near. A row keeps
its marks while the host asks about a new range, so scrolling never blanks and redraws a note's card
([rows and annotations](../plugins/rows-and-annotations.md)).
