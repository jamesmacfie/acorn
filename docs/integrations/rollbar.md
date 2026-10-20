# Rollbar

The Rollbar plugin is a loaded, read-focused provider. This page covers what it shows, how it scopes
to a workspace, the limits on an occurrence, the occurrence counts data source, rail search, palette
search, and the browser handoff. The plugin is in `plugins/rollbar/`.

## Rollbar

Rollbar lists active items, loads item and occurrence detail, promotes an item to a task, and
contributes a task pane, a project-scoped pane, and a rail source. Picking a rail row draws the item
beside the list at `/p/:projectId/x/rollbar/items/:item`, with no task. The task pane is the linked
items view. Payloads pass through a strict privacy allowlist before they're stored or drawn. List,
detail, occurrence history, and occurrence detail each have their own freshness.

Refreshing an open item keeps its detail and tab visible. A failed refresh shows above the last
loaded detail. **Overview** loads the newest occurrence through the same cached route the
**Occurrences** tab reads, and shows its message and stack.

The rail row spends its width on severity, the error, and frequency: an error, warning, or info icon,
the title, and the occurrence count with a thousands separator. A collapsed row shows the `#id`, which
also heads the detail. Environment and connection stay in the detail.

## Scoping

A Rollbar credential is a project access token, so a connection is one project. Its project source
makes no outbound call: it returns the project recorded when the token was validated. It's declared
anyway, because Rollbar's rail scopes on the connection IDs in a workspace's map, and the map needs a
row to select.

The scoping fails closed. A rail request with no `?project=`, which a stale plugin package sends,
returns no rows instead of every connection's.

## Occurrence limits

An occurrence detail is capped at 10 trace chains, 200 frames in total, 7 code lines per frame, 8 KiB
per string, and 192 KiB per detail (`CAPS` in `plugins/rollbar/src/server/normalize.ts`). Tests assert
against the same constants.

## Occurrence counts source

`rollbar:occurrence-counts` answers "errors per day" and "which errors spiked this week", which the
error groups source can't: a group record carries one total. It returns one record per error group
per UTC day that had at least one occurrence. A record holds the group's item ID, counter, title,
permalink, level, and environment, the day as the start of that UTC day in epoch milliseconds, and
the day's occurrence count. It never carries an occurrence's message, stack, request, or person.
Pressing a record opens the group in Rollbar.

The handler, `plugins/rollbar/src/server/data/occurrenceCountSource.ts`, sends one query to
Rollbar's [Metrics API](https://docs.rollbar.com/reference/post_api-1-metrics-occurrences),
`POST /api/1/metrics/occurrences`, with daily granularity in UTC, grouped by item, counter, title,
level, and environment. The query's lower and upper bounds on `/day` become the Metrics API's start
and end times, widened to whole UTC days, so each count covers its whole day. A day whose start falls
outside the bounds then drops out. Equality filters on level, environment, and counter go to Rollbar
as filters.

Rollbar's other count endpoints don't fit. `GET /reports/occurrence_counts` takes no time window and
counts one item per call, and `GET /reports/top_active_items` stops at 168 hours. Listing each item's
occurrences costs a call per 20 occurrences.

The query asks Rollbar for at most 5,001 rows, newest day first. When it gets more than 5,000, the
read keeps the newest 5,000, answers `more` until the last page, and marks that last page
`incomplete` with `host-budget`. Pages of one run share the read for 60 seconds, so a run makes one
call to Rollbar. Rollbar's documentation doesn't say whether the row limit counts rows or groups
when granularity is set, so the read counts the rows itself. No real token was available to check
the response against the documentation on October 20, 2026.

The Metrics API needs a token with `read` scope and an account plan that includes it. Rollbar
answers 403 otherwise, and the source fails with a reason that says so. A 429 passes through as a
rate limit.

Four starters ship with the source: errors per day stacked by level, errors per day stacked by
environment, a heatmap of error titles by day over 14 days, and the noisiest errors over seven days.
They bucket days in UTC, as Rollbar does, so a day's count never shifts to a neighboring day in the
viewer's time zone.

## Rail search

The rail's `search` route, `/rail-search`, asks Rollbar's
[items endpoint](https://docs.rollbar.com/reference/list-all-items) with `status=active` and the
reader's text as `query`, for each connection the routed project maps
([searching a source](../plugins/descriptors.md#searching-a-source)). It reads beyond the three
100-item pages the mirror holds. The text passes through as Rollbar's
[search language](https://docs.rollbar.com/docs/searchable-fields): a plain word matches the start
of a title, and `#123` names an item's counter. A token reads only its own project, so the text
can't widen the scope. The route also drops any item that isn't active, in case the text names a
status of its own.

Each connection returns one page. A full page, or a connection that failed, marks the answer
incomplete. Rows go through the same normalizer as the mirror, but the search writes nothing to it,
so a search never changes which items the list shows. Because Rollbar matches word prefixes, a row the
loaded list matched by a substring can drop out when Rollbar answers.

## Palette search

Find a Rollbar item filters a list the Node already has. The route reuses the rail's
`scopedConnections` and `listItems`, which reads the mirrored `rollbar.items` resource the rail keeps
fresh on a two-minute TTL ([provider mirrors](../caching.md#provider-mirrors)), so typing spends no
provider budget. One connection failing keeps the rows another returned, and only a total failure is
an error. [From the command palette](../integrations.md#from-the-command-palette) has the shared rules.

## Browser handoff

Rollbar declares an item handoff for the [browser extension](../browser-extension/handoffs.md) in its
manifest's `browserHandoffs`. It matches two addresses, each with or without the trailing slash:

- Rollbar's permalink, `rollbar.com/item/<id>/`. It names the item by Rollbar's system-wide id, the
  same address the plugin gives every item.
- The signed-in account address the permalink lands on,
  `app.rollbar.com/a/<account>/fix/item/<project>/<counter>`. It names the item by the project's
  name and the project counter (`#142`) that the rail and task links use.

The id and the counter differ, and the route never treats one as the other. The handoff has no
anchors, so the extension offers it in the sidebar beside the page. Rollbar's item view needs a
signed-in session, and no selector has been checked against it. Signed out, Rollbar redirects both
addresses to its login page.

`POST /v1/p/rollbar/browser/item`, in `plugins/rollbar/src/server/browserHandoff.ts`, reads the item
through the `rollbar.items` resource. The provider router in `plugins/rollbar/src/server/routes/rollbar.ts`
serves it, because that router answers every path under `/v1/p/rollbar` over HTTP. Every read is
fresh, so a deleted item or a rejected token isn't hidden by the cache.

- For a permalink, the route reads `{ kind: 'item', itemId }`, which asks Rollbar's `/item/<id>`. A
  connection is one project, so the route asks every connection that isn't disabled. A connection
  counts only when Rollbar's id for the answer is the page's.
- For an account address, the route reads `{ kind: 'detail', identifier: counter }`, which asks
  Rollbar's `/item_by_counter/<counter>`. A counter means something only inside its project, so the
  route asks only connections whose project name, recorded from Rollbar when the token was checked,
  is the address's project. When none is, it answers 404 and names the project.

Each connection that counts is one item, and the person picks one. The read stores the item
under the counter Rollbar answered with, in the one item cache, so the occurrence reads that follow
find its id there.

An item's projects are the checkouts whose workspace maps that connection, the rail's
[scoping](#scoping) read the other way. A mapping that names one Acorn project covers only that
project, and a project with no folder on disk isn't offered.

The seed is what the rail's **+Task** uses (`rollbarTaskFields` in `plugins/rollbar/src/shared/rail.ts`):
origin `rollbar`, the title, and the item as one connection-stamped link on its counter, with the
system id and permalink in the reference. The seed has no branch, because Rollbar suggests none. The
rail's task dialog asks for one, and the handoff card has no branch field, so the task starts without
a branch.

The proposed context is the item's counter, title, permalink, level, environment, status, occurrence
count, first and last time seen, framework, and resolved version. It adds the newest occurrence:
exception and message, environment, code version, server branch and host, platform, the request's
method and address without its query string, and the stack trace with source lines for the frame that
raised. It leaves out the person, headers, cookies, bodies, custom data, and crash reports. Most of
these the [normalizer](#occurrence-limits) drops already, and the person is dropped here. The context
stops at 12,000 bytes. An item whose occurrences can't be read is still handed over without them.

The route's errors:

| Case | Answer |
| --- | --- |
| No connection, or only disabled ones | 403, asks the person to connect Rollbar |
| No connection's project has the item | 404, says it may be deleted or in a project Acorn isn't connected to |
| A token Rollbar rejects, or a connection that needs reauthentication | 403, names the connection and asks for a reconnect |
| Rollbar rate limiting | 429, asks the person to try again in a minute |
| Rollbar unreachable | 502 |

A project that answered wins over a connection that failed, as on the rail. The resource reads
Rollbar's 403 as a token to reconnect, as every Rollbar read does. If Rollbar answers 403 rather than
404 for another project's item, the handoff would ask for a reconnect where "not found" is right. No
real token was available to check which one it sends.
