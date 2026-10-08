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

**Find in folder** on a tree folder opens this panel with that relative folder captured. **Clear
folder scope** returns to the task root. **Search details** accepts comma-separated ripgrep globs in
**Files to include** and **Files to exclude**. Whitespace around commas and empty entries are ignored.
Excludes win. Negative globs belong in the exclude field; literal commas in patterns are unsupported.
Each field accepts 20 patterns of at most 256 characters, with a combined 4 KiB limit. The Node
rejects invalid filters, missing folders, and symlink scopes outside the task before searching.

Filtered searches run one bounded ripgrep filename pass to select paths, then search text with
ripgrep's ordinary ignore and hidden-file defaults. The filename pass uses ripgrep glob rules;
there is no shell expansion or separate JavaScript matcher. Query, scope, filters, results, and
reading place remain in the Node/task session when the sidebar is hidden or remounted. A rename or
trash affecting the scope leaves a reset action instead of redirecting the search.
