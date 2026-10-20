# Linear

The Linear plugin is a loaded plugin that reads Linear issues into a rail, a task pane, a project pane,
and a reference panel. This page covers connections, teams and projects, the rail, the ticket view,
rail search, palette search, the data sources, and the browser handoff. The plugin is in
`plugins/linear/`.

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

## Rail search

The rail's `search` route, `/rail-search`, asks Linear for matches in the same mapped projects and
teams the rail lists, so it finds an issue beyond the rail's first 250
([searching a source](../plugins/descriptors.md#searching-a-source)). Each mapped connection returns
one page of 50 (`RAIL_SEARCH_QUERY` in `plugins/linear/src/server/index.ts`). That query leaves out
labels, which make a page of issues expensive, and reads `pageInfo`. A full page, or a connection
that failed, marks the answer incomplete. Rows keep the `<connection>:<identifier>` ID and the
promotion seed. Only a failure of every mapped connection is an error. The search covers active
issues, like the rail.

## Palette search

Find a Linear issue asks Linear instead of filtering a cache, through the same search as the rail's
**Search** field (`searchMappedIssues` in `plugins/linear/src/server/routes/linear.ts`). Linear's `IssueFilter` takes the mapping
filter the rail already sends, `project: { id: { in: … } }`, so a title clause and an identifier
clause ride along (`projectIssueSearchFilter` in `plugins/linear/src/server/index.ts`). There's no
cached set to filter, because `/rail-items` calls `providerFetch` directly. Filtering the first
hundred active issues per keystroke would cost the same requests and miss the hundred-and-first.
`searchableContent` isn't used, because it searches descriptions too and is the field most likely to
vary by plan. [From the command palette](../integrations.md#from-the-command-palette) has the shared
rules.

## Data sources

The plugin serves three [data sources](../data-sources.md) to dashboards and workflows. Each reads
one Linear connection the person picks, through the handler in
`plugins/linear/src/server/data/sourceHandler.ts`:

| Source | One record per | Reach |
| --- | --- | --- |
| Linear issues (`linear:issues`) | Issue, archived ones included | One Linear project, picked from the workspace's links |
| Linear cycles (`linear:cycles`) | Cycle, archived ones included | Every team the account reaches |
| Linear projects (`linear:projects`) | Project, archived ones left out | Every project the account reaches |

All three share one read in `plugins/linear/src/server/data/sourceRead.ts`. It sends the query's
filters to Linear, pages through every match, then sorts and takes. When a selection passes 5,000
records or 100 Linear pages, the read answers incomplete with no records, because sorting part of the
matches could put the wrong rows first. A finished selection stays for 60 seconds so the host can
page through it. Pressing a row opens it in Linear.

[Provider data sources](../data-sources/provider-sources.md#linear-issues-and-rollbar-error-groups)
covers the issues source's project and state rules. Beside its title, state, and dates, an issue
record carries its cycle and cycle ID, assignee, priority, estimate, and completed time. Its cycle ID
matches a cycle record's `id`.

A cycle record has its team, number, title, status, start, end, and completed times, progress, and
issue counts. Its title is the cycle's name, or "Cycle 12" when it has none. Its status is
`active`, `upcoming`, or `past`, and a cycle completed early is past. Filters on team, status,
start, and end go to Linear. Linear reports issue counts as one end-of-day figure per day of the
cycle, so the source reads:

- **Issues** and **Completed issues**: the latest day's figures. An upcoming cycle has none.
- **Issues added**: the latest day's total less the first day's. Removed issues count against it.
- **Progress**: Linear's own figure as a percentage. Completed estimate points plus a quarter of
  in-progress points, over all points.

A cycle has no address in Linear's API, so the record builds the one Linear's app uses,
`linear.app/<workspace>/team/<key>/cycle/<number>`, from the workspace's URL key.

A project record has its name, status, lead, up to 25 team names, progress, target date, and its
started, completed, and updated times. It leaves out the description. Its status is Linear's status
type, one of `started`, `planned`, `paused`, `backlog`, `completed`, or `canceled`, beside the
workspace's own name for it. Filters on status and the three times go to Linear.

Each source ships starter panels, defined with its description in `plugins/linear/src/shared/`. Cycles
offers active cycles, cycles finished in the last 12 weeks, and issues completed per cycle by team.
Projects offers projects in progress, projects by status, projects past their target date, and
projects completed in the last 12 weeks.

## Browser handoff

Linear declares an issue handoff for the [browser extension](../browser-extension/handoffs.md) in its
manifest's `browserHandoffs`. It matches the short and the slug address, `linear.app/<workspace>/issue/<key>`
and `…/issue/<key>/<slug>`. It has no anchors, so the extension offers it in the sidebar beside the
page rather than as a button in the page. Linear's issue page needs a signed-in session and its class
names are generated, and no selector has been checked against it.

`POST /v1/p/linear/browser/issue`, in `plugins/linear/src/server/browserHandoff.ts`, reads the issue
through the `linear.issues` resource, the same read as the ticket view. The provider router in
`plugins/linear/src/server/routes/linear.ts` serves it, because that router answers every path under
`/v1/p/linear` over HTTP. It asks every connection that
isn't disabled, with a fresh read, so a deleted issue or a rejected key isn't hidden by the cache. Two
workspaces can both have an `ENG-42`, so a connection's answer counts only when Linear's own address
for the issue is in the page's workspace. Each connection that passes is one item, and the person
picks one. The bare-identifier routes take the first workspace that answers; this one doesn't.

An item's projects come from the workspace mappings in [teams and projects](#teams-and-projects): a
mapping on that connection of the issue's Linear project or its team, covering the whole Acorn
workspace or naming the project. That is the rail's rule read the other way. Nothing is guessed from
the workspace in the address. A project with no folder on disk isn't offered, as with GitHub's
handoff. An issue in no mapped project or team has no projects, and the person can still pick a task
with **Add to a task**.

The seed is the one the rail's **+Task** uses (`linearTaskFields` in `plugins/linear/src/shared/rail.ts`):
origin `linear`, `<key> <title>`, and Linear's suggested branch. It adds the issue as one
connection-stamped link, which is how the extension finds a task that already holds it, in any
project. The proposed context is the key, title, address, state, assignee, priority, team, project,
labels, and up to 8,000 bytes of the description.

The route's errors:

| Case | Answer |
| --- | --- |
| No connection, or only disabled ones | 403, asks the person to connect Linear |
| No workspace has the issue in the page's workspace | 404, says it may be deleted or in a workspace Acorn isn't connected to |
| A key Linear rejects, or a connection that needs reauthentication | 403, names the connection and asks for a reconnect |
| Linear rate limiting | 429, asks the person to try again in a minute |
| Linear unreachable | 502 |

A workspace that answered wins over one that failed, as on the rail. Linear reports a rate limit as
HTTP 400 with `RATELIMITED` in the body, so `linearRateLimited` reads the body, and the `linear.issues`
resource reports it as `provider_rate_limited`.

