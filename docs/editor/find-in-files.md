# Find in files

This page covers the search behind the editor pane's search panel. It's part of
[editor](../editor.md). [Pane contributions](../panes/contributions.md#find-in-files) covers where the
panel sits and how `⌘⇧F` opens it.

## Find in files

The Node resolves the task's authorized worktree and streams ripgrep's JSON records
(`plugins/editor/src/server/searchProcess.ts`):

- The Node keeps at most 2,000 matches, with previews cut to 300 characters. One more match proves
  the result was truncated. Exactly 2,000 matches with nothing after them is a complete result.
- Paths and lines that ripgrep encodes as non-UTF-8 bytes aren't supported, and don't count toward
  truncation.
- Match columns are one-based UTF-16 offsets.

A record can span output chunks and split a UTF-8 character. Each record can be up to 64 MiB, so a
match in a minified line keeps its exact column. An oversized or invalid record is an error. The Node
keeps 64 KiB of stderr. No match returns an empty result. An invalid regex, a missing executable, a
missing task root, a timeout, malformed output, and cancellation each produce their own error. A
truncated result ends its ripgrep process and waits for it to exit and both pipes to close before
returning.

The panel captures its query client's Node, the task, the query, and the options. Changing the input
or a toggle, or disposing the panel, aborts its request through the client transport. The Node owns
ending the process, and escalates past SIGTERM when it has to. Hiding the panel keeps its query,
results, and request.
