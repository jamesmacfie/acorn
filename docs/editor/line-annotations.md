# Line annotations

This page covers the muted text other plugins draw after the end of the cursor line in the desktop
Editor, such as Git's line blame, and the tooltip behind it. It's part of [editor](../editor.md).

## The point

Editor opens `editor:line`, an [annotation](../plugins/rows-and-annotations.md#annotations) point
keyed `{ taskId, path, line, revision }`:

- `path` is the case-preserving path relative to the task's worktree.
- `line` is one-based.
- `revision` is the SHA-256, in hex, of the file's exact UTF-8 bytes. It's the body hash line markers
  send ([matching the displayed text](./line-markers.md#matching-the-displayed-text)).

The names live in `plugins/editor/src/contract/lineAnnotations.ts`. The point keeps one mark from each
of up to two contributors, and it sets `acceptsDetail`, so each mark's `detail` reaches the tooltip.

Because `revision` is part of the key, an answer about another body of the file attaches to nothing.
A contributor that reads the file on disk should answer only when its hash matches `revision`, before
and after it does its work. Git's blame does both.

## When Editor asks

Editor asks about the cursor line only, 300 ms after the cursor settles. It asks nothing when:

- The document has unsaved changes or is saving.
- **Settings > Editor > Show line blame** is off. It's on unless you turn it off.
- The selection spans more than one line.

Moving the cursor or typing hides the label at once. After autosave, Editor asks again without the
cursor moving, because the saved body changed. The terminal client registers the point but never
asks, because it edits files in `$EDITOR`.

## Drawing

The label is a CodeMirror widget at the end of the line, in `--text-faint`, with each mark's `text`
joined by ` · `. It isn't part of the document, so the cursor can't land in it, it can't be selected,
and copying never includes it. With word wrap on, it wraps like other text at the end of a line.

Resting the pointer on the label for 300 ms opens a tooltip. It stays open while the pointer moves
into it, so its text can be selected, and closes when the pointer leaves both, or on Escape. The
**Show line blame details** command opens the same tooltip from the keyboard. The tooltip opens from
the label's own pointer events, not from a hover over text positions, so language hover on the same
line still works.

Each mark draws its `detail`, or its `text` when it has none, through `richTooltipDom`, the renderer
language hover uses. Markdown is escaped and then sanitized: only `https` links survive, and images
become placeholders, so nothing loads from the network. The host writes the "From <plugin>" credit
under each mark.

## Line blame

Git fills the point with a compiled `marks` contributor that posts to `/v1/p/git/editor/line-blame`
(`createLineBlame` in `plugins/git/src/server/lineBlame.ts`). For each key, at most eight per request,
it does the following:

1. Refuses a key whose path leaves the worktree, whose line isn't a positive integer, or whose task
   has no worktree.
2. Hashes the file. A hash that differs from `revision` gets no mark.
3. Runs `git blame --porcelain -L <line>,<line>` with a 10-second timeout. A line that isn't committed,
   or a file that isn't in `HEAD`, reads `You, not committed yet`.
4. Reads the commit's author, email, date, and message with `git log -1`, cached for up to 500
   commits.
5. Hashes the file again, and drops the mark if it changed while blame ran.

The label reads `<author>, <age>`, such as `Ada Lovelace, 4 years ago`. The Node computes the age when
it answers, so a label left on screen drifts until the next ask. The detail is Markdown: the author
and email, without the characters the renderer reads as markup, then the commit message as written, then the date in the
Node's time zone, any `#1234` from a subject ending in `(#1234)`, and the seven-character commit ID.
Git keeps the message under the 16 KiB detail cap.

Git's own blame configuration applies, such as `blame.ignoreRevsFile`.

## Limits

- One line, one request. A point that asked about many lines would read and hash each file twice per
  request, so widen it only with a cheaper freshness check.
- A mark has no actions. The tooltip has no copy button and no link into the Git pane.
- The label is drawn only by the desktop Editor.

## Open questions

These came with the plan and haven't been decided:

1. Should **Show line blame** stay on by default, as in Zed?
2. Should `#1234` be a link? Git could build an `https` address from a GitHub `origin` remote, but
   that puts more code in Git and ties the tooltip to one host.
3. Should blame ignore whitespace-only changes with `-w`? It keeps Git's default for now.
4. Should the date use the device's locale and time zone? Git formats it on the Node, which may be a
   remote machine.
