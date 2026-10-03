# Linear

The Linear plugin is a loaded plugin that reads Linear issues into a rail, a task pane, a project pane,
and a reference panel. This page covers connections, teams and projects, the rail, the ticket view,
and palette search. The plugin is in `plugins/linear/`.

## Linear

Linear uses GraphQL and supports several connections. Projects and issues carry the connection ID,
because issue keys aren't unique across connections. So a rail row and a task link both carry the
connection, and a bare `ENG-42` from pull request text is resolved by asking each connected workspace.

Its rail source lists issues, promotes one to a task with the issue's suggested branch, links issues,
posts comments, recognizes `linear.app` issue URLs, and draws the reference panel GitHub's pull
request detail shows. All of it is manifest descriptors and host-drawn trees, not compiled code. Its
provider declares `detail`, `comment`, and `image`, so an agent can read a linked ticket, comment on
it, and view its screenshots ([tracker tools](../agent-tools/tracker-tools.md)). It contributes a
project source.

Promoting a pull request to a task settles which connection a Linear link names before it writes. One
connected Linear answers that. With several, the repository's project map decides: the Linear
connections mapped to this project or its whole workspace are candidates, and exactly one candidate is
the answer. A repository following two Linears, or none, gets no Linear link
(`plugins/github/src/client/pullTasks.ts`).

## Teams and projects

A workspace can map a Linear team as well as a Linear project. An issue belongs to one team and may
belong to no project, so a team that works from its backlog has nothing else to map. The project
source lists both, and a team's ID carries a `team:` prefix (`TEAM_PREFIX`), so the rail filter
matches Linear's `team` field instead of `project`. Core stores the ID without reading it. An ID with
no prefix is a project. Mapping a team casts a wider net, and a busy team makes a long rail.

## The rail

The rail lists only issues in the projects and teams a workspace linked. With none linked, the shell
doesn't draw the source ([rail and routing](../frontend/rail-and-routing.md)). Its `emptyState` covers
the remaining case: projects are linked and none has an active issue
([descriptors](../plugins/descriptors.md)). A rail row is data the host draws, so there are no filter
inputs or facets. Ordering and priority are computed on the Node, where the rows are built.

## The ticket view

Ticket attachments go through a Node route, because a plugin's client code has no network and Linear's
upload host takes the API credential. The route fetches only from `uploads.linear.app`. Any other host
would make it a proxy spending your Linear key for the caller. The pane draws an image in a ticket as a
link, not inline, because a base64 screenshot as a tree prop could trip the batch cap and take the
whole ticket down.

The ticket draws from what the host mounted it with. A reference panel carries an unscoped identifier
another plugin found, resolved across every workspace. A pane carries that same `item`, or a `taskId`
to show what the task links. A `linear.app` ticket link inside the ticket re-points this same view, so
you keep your tab, scroll position, and way back. Other links go to the host's normal handling.

Opening another issue clears the one on screen before the fetch, so the detail can't show a different
issue from the list. A refresh keeps the issue and reports a failure above it. A failed load is a
titled state with the reason in words and **Try again**. The rail row is the state icon, title, and
key. The detail shows the state's name beside a badge toned by Linear's state type.

## Palette search

Find a Linear issue asks Linear instead of filtering a cache. Linear's `IssueFilter` takes the mapping
filter the rail already sends, `project: { id: { in: … } }`, so a title clause and an identifier
clause ride along (`projectIssueSearchFilter` in `plugins/linear/src/server/index.ts`). There's no
cached set to filter, because `/rail-items` calls `providerFetch` directly. Filtering the first
hundred active issues per keystroke would cost the same requests and miss the hundred-and-first.
`searchableContent` isn't used, because it searches descriptions too and is the field most likely to
vary by plan. [From the command palette](../integrations.md#from-the-command-palette) has the shared
rules.
