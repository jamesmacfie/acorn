# Rollbar

The Rollbar plugin is a loaded, read-focused provider. This page covers what it shows, how it scopes
to a workspace, the limits on an occurrence, rail search, and palette search. The plugin is in `plugins/rollbar/`.

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
