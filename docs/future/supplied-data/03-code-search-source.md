# Phase 3: a live code search source

Date: October 20, 2026. Status: built on branch `phase-3-code-search-source`, not merged. Needs nothing.

## Completion note

Built October 20, 2026. The editor plugin serves **Code matches** (`editor:code-matches`), a data
source whose pattern is a setting. Its starters chart matches by folder and by file type, and list
every match. Pressing a match opens the file at its line in the editor pane.
[Find in files](../../editor/find-in-files.md#code-matches-data-source) documents the result.

### What landed

- **Runner.** `runRipgrep` in `plugins/editor/src/server/searchProcess.ts` takes `maxHits` and
  `partialOnTimeout`. A timeout with `partialOnTimeout` stops ripgrep the way the match cap does,
  keeping what it found and marking the result truncated. Find in files doesn't change.
- **Source.** `plugins/editor/src/shared/codeMatchSource.ts` holds the description, parameters, and
  starters. `plugins/editor/src/server/codeMatchSource.ts` holds the read, loaded on the first query
  behind a dynamic import. Only the registration in `shared/sourceRegistrations.ts` loads at boot.
  The read runs one ripgrep process over every project folder with `--sortr modified`, which orders
  files newest first across all the folders. It shares one search across a run's pages through
  `createDataSelectionPager`.
- **Press.** Each record carries `taskId` and an `editor.file` target whose item is `line:path`
  (`shared/fileTarget.ts`). The editor client registers that content link, and `EditorPane` answers
  the `plugin:select` intent it sends by revealing the line.
- **Launcher.** `starterForPick` in the studio keeps a starter's own parameters under the picked
  scope, with the pick's values winning. Every other source's starters have empty parameters, so
  nothing else changes.
- **Guide.** `panel_guide`'s `suppliedRows` section sends a question about the code to this source,
  with the text to find as `parameters.pattern`.
- **Tests and fixtures.** `codeMatchSource.test.ts` covers scope, a query with no scope, missing
  folders, `.gitignore` with and without a glob, fixed text, regex, case, the 5,000 cap across
  projects, record shape, the task choice, and the starters. `searchProcess.test.ts` covers the two
  runner options. `EditorPane.test.tsx` covers the press. The SDK field lists and both plugin-disable
  goldens list the source, its route, and its link.

### Decisions and deviations

- **The starters' pattern is `TODO`, filled in.** The doc asks for a placeholder. A field has no
  placeholder, and the Node refuses a starter whose required parameter is empty, which hides it from
  the launcher. So each starter carries `pattern: "TODO"` and the person edits it. The field's hint
  says "such as TODO".
- **`glob` matches file names only.** A ripgrep `--glob` brings back files `.gitignore` lists, so the
  source turns the glob into a ripgrep file type, which matches the file name and honours
  `.gitignore`. A glob with a folder in it, such as `src/*.ts`, matches nothing. Find in files keeps
  path globs with its three-process intersection, which this source doesn't need.
- **One record per match, not per line.** A line with two matches is two records, as find in files
  counts them. The record ID is a hash of project, path, line, and column, because a long path would
  pass the 200-character ID limit.
- **Which task a press opens.** An active task on the project folder: one with no branch, or one made
  on the existing checkout, which keeps the checkout's branch name. Never a worktree task, whose
  files can differ. A project with neither has no destination. A record whose `line:path` passes
  200 characters has no target.
- **Both caps report `host-budget`.** The 5,000-match cap is the host's record budget, and the
  30-second cap has no better cause in the protocol.
- **Folder.** The path's first two folders, or `.` for a file at the project's top.
- **Extension.** Lowercase and without its dot, an enum with 30 common values. A value outside the
  list, such as `mdx`, draws as a warning in the plan diagnostics ("File type has new values to
  map"), the same as any enum with unlisted values.
- **Decision 4 taken as its default.** The source reads the project folders of the workspace or
  project and nothing else, and fails with neither. A nested project's files go to the deepest
  project, and a match ripgrep reports twice counts once.

### What later work needs to know

- **A press from Home opens the file in the task without moving there.** The content link's pane rung
  calls `openPane`, which lays out the pane in the task and leaves the window where it is. Agent
  session rows behave the same way. Moving to the task after a pane open is a host change to
  `openReference` in `PublishedDashboardPanel`, and it would change every pane target, so this phase
  leaves it.
- **The Node service budget.** The base measures 1,915,026 bytes, and this branch 1,915,435 bytes,
  409 more, against a ceiling of 1,914,100 bytes. The added bytes are the registration and the route
  mount.
- **Real-app checks.** In `pnpm dev:agent` with `--prepared`, all three starters drew for `TODO`
  across a workspace with two projects, and a gitignored file never appeared. A press opened the
  file at its line in the task's editor. With 6,000 matches in an old file, a run kept the newest
  5,000, every newer file's matches included, and reported `incomplete`. The `panel_show` check
  didn't run, because it needs a chat agent in the session.

## Goal

The editor plugin serves **Code matches**, a data source whose pattern is a setting. Each record is
one match: the project, the file, its folder, the line number, and the match's kind. "Count the TODOs
in each folder", "which files still import the old client", and "how many `any` casts per package"
become panels that refresh on their own, with no agent in the loop.

## Starting point

- The editor plugin runs ripgrep for find-in-files (`plugins/editor/src/server/search.ts` and
  `searchProcess.ts`), bounded and off the Node's main thread.
- A source can take parameters, shown in the panel editor and checked by the Node
  ([provider sources](../../data-sources/provider-sources.md)).
- Sources that read the workspace's projects scope the way **Git commits** does
  (`plugins/git/src/server/data/commitSource.ts`), and share one paged read
  ([serve a query](../../data-sources/serve-a-query.md)).

## The design

### The source

Source id `code-matches`, labelled **Code matches**. Its parameters:

- `pattern`, required: a ripgrep pattern, as fixed text unless `regex` is set.
- `regex`, a boolean, off by default.
- `glob`, optional: which files to search, such as `*.ts`.
- `caseSensitive`, a boolean, off by default.

Each record holds:

- `project` and `projectName`.
- `path`, relative to the project, and `folder`, its first two path segments, so a bar can group by
  folder without a computed column.
- `extension`, as a choice field whose values the source lists.
- `line`.
- `text`: the matched line, cut to 200 characters. It's code the person already has on disk, and a
  list of matches is useless without it. Say so in the source's description.

Pressing a record opens the file at the line in the editor pane.

### Reach and limits

It searches the project folders of the query's workspace or project, never a path the query names,
and honours `.gitignore` (decision 4 in the [README](./README.md)). A query with no workspace or
project fails, as the core git sources do.

Each search is capped by time and by matches: 30 seconds and 5,000 matches across the projects,
newest-modified files first, so the budget keeps what's most likely current. A capped search reports
`incomplete` on its last page.

### Starters

| Starter | View |
| --- | --- |
| Matches by folder | Bar by `folder`, count |
| Matches by file type | Bar by `extension`, count |
| Every match | List, pressing a row opens the file |

Each starter leaves `pattern` for the person to fill in, with a placeholder of `TODO`.

## Steps

1. Read how the editor's search bounds its process, and reuse it from a lazily loaded handler.
2. Write the source, its parameters, and its starters, with tests for scope, the caps, `.gitignore`,
   and the record shape.
3. Teach the panel guide that code questions use this source, not supplied rows.
4. Document it in the editor plugin's reference doc and the [source catalog](../../data-sources/catalog.md).

## Acceptance

- In `pnpm dev:agent`, "Matches by folder" for `TODO` draws across a workspace with two projects.
- Pressing a match in the list opens the file at that line.
- A search over 5,000 matches draws the newest 5,000 and says it's incomplete.
- A file listed in `.gitignore` never appears.
- `panel_show` with "count the TODOs in each folder" uses this source with no edits.
