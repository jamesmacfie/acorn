# Phase 3: a live code search source

Date: October 20, 2026. Status: proposed. Needs nothing.

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
