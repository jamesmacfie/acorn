# Find in files

This page covers the search behind the editor pane's search panel, and the Code matches data source
that reuses it. It's part of
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

Filtered searches intersect ripgrep's default filename listing with its glob-filtered listing,
then pass the same bounded globs to the text search. This uses three processes and preserves
default ignore and hidden-file rules, which positive globs can otherwise override. Excluded large
text files are not scanned. Ripgrep owns glob matching; there is no shell expansion or JavaScript
matcher. Each pass joins process closure after cancellation, overflow, or its timeout, with
SIGTERM followed by SIGKILL when needed. An invalid regex remains an error when no path is selected.

Scope and pattern changes abort immediately and debounce the replacement by 200 ms. Query, scope,
filters, results, and reading place remain in the Node/task session through hiding and remount.
`TabPanel` carries the serialized `scrollOffset` and reports changes through the kit's `onChange`
event. The host restores after remote result rows arrive. A rename or trash affecting the scope
leaves a reset action instead of redirecting the search. The focused-folder command captures a live
tree row whose collection identity includes its Node and task before the palette takes focus.
Only visible folders in the mounted tree are admitted. Editor resolves the entry through the
explicit Node and rejects completion after the captured tree owner unmounts.

## Code matches data source

`editor:code-matches` is a [data source](../data-sources.md) with one record per ripgrep match, so a
dashboard panel can count the TODOs in each folder or list the files that still import an old module.
It refreshes like any source, with no agent involved. Its settings are:

- `pattern`, required: the text to find. It's fixed text unless `regex` is on.
- `regex`: read the pattern as a regular expression. Off by default.
- `glob`: search only files whose name matches, such as `*.ts` or `*.{ts,tsx}`. The source turns it
  into a ripgrep file type, because a ripgrep `--glob` would bring back files that `.gitignore` lists.
  A type matches the file name only, so a glob with a folder in it matches nothing.
- `caseSensitive`: match case. Off by default.

A record holds the project's ID and name, the path inside the project, `folder` (the path's first two
folders, or `.` for a file at the top), `extension` (lowercase, without its dot), the line, and
`text`, the matched line cut to 200 characters. The text is code already on the device, and a list of
matches says nothing without it. A line with two matches is two records.

A workspace scope searches that workspace's project folders, and a project scope searches that one
folder. A query with neither fails, so the source never reads a path a query names. Projects whose
folder is missing are left out. Ripgrep skips what `.gitignore` lists and hidden files, as find in
files does.

One ripgrep process searches every folder, newest-modified files first, and stops at 5,000 matches or
30 seconds. Either cap keeps what it found and reports `incomplete` with `host-budget` on the last
page, so the budget keeps the files most likely to be current. The pages of one run share one search
for 60 seconds.

Each record names a task on the project folder the search read, and an `editor.file` target. That's
an active task with no branch of its own, or one made on the existing checkout, never a worktree task,
whose files can differ. The editor's client registers that content link, so pressing a row opens the
file at its line in that task's editor pane. A project with no such task has nowhere to open. The
starters chart matches by folder and by file type, and list every match with presses on. Each starts
with `TODO` as its pattern for the person to change.

`plugins/editor/src/server/codeMatchSource.ts` owns the read. The description and its starters are in
`plugins/editor/src/shared/codeMatchSource.ts`.
