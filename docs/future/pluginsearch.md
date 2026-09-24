# Search within plugin lists

Status: proposal, 2026-09-24. No implementation has started. Reviewed against commit `aae3e0ac`.

Replace the Linear, Rollbar, and GitHub list filters with **Search**. Typing should narrow the rows
already loaded without waiting for a request, then ask the provider for matches outside that set. A
search must retain the project's mapping and the selected list state. The user should be able to tell
when the provider is still answering, failed, or has more matches than the page shows.

This is a search within one browse list. The command palette already has project-scoped Linear and
Rollbar search commands. The Archive page's `ctx.search` contract is different: it groups hits across
task-related providers, resolves task scope, and caps each group at 20. Extending that contract to a
project's provider list would mix two navigation and result models. Reuse the provider logic where it
fits, not the Archive search route or its hit type.

## What the lists load

| List | Data source and limit | What the visible filter misses |
| --- | --- | --- |
| Linear rail | `/v1/p/linear/rail-items` asks each mapped connection for the first 250 active issues. | The desktop and terminal host filter loaded titles. They cannot find issue 251 in a connection's answer. |
| Rollbar rail | `/v1/p/rollbar/rail-items` reads the active-item mirror. It fetches at most three 100-item pages per connection. | The host filters loaded titles. The Rollbar palette command also searches only this capped mirror. |
| GitHub pull requests | Open PRs come from a local mirror refreshed from one 100-item GitHub page. Closed PRs load 50 at a time. | Both tabs filter loaded PRs by title, author, or number. The closed tab hides **Load more** while a filter is set. |

The GitHub open-list comment calls its mirror complete, but `refreshOpenPulls` requests one page and
uses that page to decide which open rows remain in the mirror. Do not build open search on the
assumption that this mirror contains every open PR. That completeness issue deserves separate review
when implementation begins because it also affects list membership outside search.

The data flows are:

```text
Linear/Rollbar connection and project mappings on the Node
  -> plugin route -> provider or local mirror -> PluginRailItem[]
  -> broker and per-Node client cache -> desktop or terminal source list
  -> host title filter -> selected row -> project-scoped detail surface

GitHub routed project -> owner/repository -> plugin PR list route
  -> open mirror or one closed provider page -> client query cache
  -> PullList filter -> selected PR detail or create-task action
```

Linear and Rollbar are loaded plugins. Their manifests declare project-scoped, host-drawn rail
sources. `packages/protocol/src/plugin/contract.ts` defines a source with an `items` route but no
search route. Desktop draws it in
`packages/client-core/src/host/chrome/ChromeSourcePanel.tsx`; the terminal draws the same data in
`apps/tui/src/plugins/SourcePanel.tsx`. Both use
`packages/client-core/src/host/chrome/chromeData.ts` to read and validate rail rows. GitHub's PR
list is instead a compiled client component, `plugins/github/src/client/PullList.tsx`, with its own
Open and Closed tabs and persisted per-workspace filter text.

## Recommended behavior

An empty **Search** field shows the normal list and makes no search request. On each keystroke, match
the loaded rows immediately. After a short pause, ask the plugin's Node route for provider results.
Keep the local matches on screen with a searching indication until that answer arrives, then show the
provider result set as the authoritative answer. This transition matters because provider search
syntax and local substring matching are not identical. Clearing the field restores the ordinary list
from its existing cache.

Do not display the source's normal empty-state message while a search has zero matches. That message
describes an empty active list, not a search result. Before the provider answers, say that the search
is running. After a successful empty answer, say that no matches were found within the selected scope.
If the provider fails, retain the loaded matches and say that the wider search failed. A cached or
local match must never be presented as proof that the provider search completed.

The command palette's 250 ms debounce, two-character minimum, and 200-character query bound are
reasonable initial limits. Apply them to outbound calls, not local filtering. Cancel work when the
query, project, tab, source, or Node changes, and reject a late answer from an earlier scope. The
existing Node and user authorization still applies on every route call. A collapsed desktop rail can
retain the text in component state, but should not issue a hidden search request.

Keep search results separate from the normal list cache. A result key needs the Node's cache
partition, plugin and source, routed project, state, and normalized query. Search responses should be
bounded and report whether more matches exist. If there are more, offer **Load more** or ask the user
to refine the term. Silent truncation would repeat the current failure at a different limit.

## Host and plugin contract

Add an optional search route to the source descriptor. The host supplies the typed `q` and its own
routed `project` value, as it does for the ordinary rail read. A plugin cannot choose a different
project, Node, route namespace, or selection action through a search result. The route answers with
the same `PluginRailItem` shape as the list, plus bounded pagination metadata. Use the existing row
sanitizer and route ownership check for each answer. Keep the source's declared `onSelect` action for
search results, so navigation and **Create task** continue to work.

The palette's `CommandSearchItem` is not a substitute for `PluginRailItem`: it lacks the rail's
promotion seed, state mark, and display fields. Linear can share its scope and provider filter
functions with the palette while projecting the answer into the rail row contract. Rollbar can share
its connection scoping, but its palette's local ranking over the capped mirror must not be the new
provider search.

This optional route belongs on loaded source descriptors because the host owns those lists. GitHub
does not need a source descriptor: add a PR search route in the GitHub plugin and call it from
`PullList`. Share small client behaviors, such as debounce and stale-request protection, only if
doing so makes the desktop, terminal, and PR implementations easier to read. Do not create a general
search service for three lists with different scopes and provider APIs.

## Provider work

### Linear

`plugins/linear/src/server/index.ts` already builds `projectIssueSearchFilter`: it combines the
mapped project or team clause, the active-state clause, and title or identifier matching. The palette
route in `plugins/linear/src/server/routes/linear.ts` uses it to search beyond the ordinary 250
unfiltered issues. Keep the project mapping on the Node. A team mapping includes issues with no
Linear project, while a connection mapped to nothing must contribute no rows. Preserve the
`<connection>:<identifier>` rail identity because issue keys can collide across connected Linear
workspaces.

The palette reuses the 250-row triage query. A list search should request fewer fields and a bounded
page, then use Linear's `pageInfo` and cursor if the user asks for more. It must say when that first
page is incomplete. Retain partial success across connections, but show an error if every eligible
connection fails. Avoid claiming that a broad term is exhaustive after one page. Linear documents
[server filtering](https://linear.app/developers/filtering) and
[cursor pagination](https://linear.app/developers/pagination).

### Rollbar

The Rollbar palette route calls `listItems` and filters its active mirror. The
[items endpoint](https://docs.rollbar.com/reference/list-all-items) also accepts `query`, `status`,
and `page`; use that provider search for list searches. Ask only the connections mapped to the
routed project. Each connection represents one Rollbar project. Preserve
`<connection>:<counter>` identities, the normalizer's privacy allowlist, and the existing partial
failure policy. A search result must not restamp the active-list mirror as though it were a complete
refresh.

Rollbar's query is a search language. An unprefixed term searches titles, while `#123` addresses an
exact counter; other prefixes search occurrence fields. Decide whether this field accepts that
language or quotes and escapes text to behave as a plain search box. Document the chosen behavior
beside the input. Local title substring matches may disappear when the provider answers because
Rollbar's default search is a prefix match. The provider's
[search field guide](https://docs.rollbar.com/docs/searchable-fields) names the syntax.

### GitHub

The PR list is repository-scoped. Add a Node route that fixes the repository and `is:pr`, then adds
the selected Open or Closed state and the reader's term. Build provider qualifiers from trusted route
scope, not by concatenating untrusted text into an unrestricted search expression. A pasted PR
number can use an exact PR lookup. GitHub's
[issue and PR search API](https://docs.github.com/en/rest/search/search#search-issues-and-pull-requests)
can search beyond both loaded pages, but has a separate rate limit, returns at most 1,000 matches,
and can report incomplete results. Expose those limits when they affect the answer.

Search results do not carry every field that `PullList` uses for **Create task**, including the head
branch. Keep row rendering on the available summary and fetch PR detail before an action that needs
the missing fields. Do not fabricate a branch or silently disable an otherwise valid action. The
open mirror's one-page completeness should be assessed alongside this work, but provider search
must not depend on expanding the mirror first.

## State scope

Only GitHub has Open and Closed list tabs. Linear and Rollbar rail sources list active records and
have no state tab. The first search change should respect GitHub's selected tab and search active
Linear and Rollbar records. This keeps the new field aligned with the list it replaces.

Historical tabs for Linear and Rollbar require a product decision. Linear currently excludes both
`completed` and `canceled`; Rollbar names `resolved`, `muted`, and `archived` separately from
`active`. A single generic Closed value would hide those distinctions. If historical tabs are
wanted, define their labels and status membership first, then add state to the host request, the
plugin query, the result cache key, and the empty states. Provider statuses are documented by
[Linear's issue filter](https://linear.app/developers/filtering) and
[Rollbar's items endpoint](https://docs.rollbar.com/reference/list-all-items).

## Delivery and verification

1. Add the optional rail search contract, the shared read and validation path, and the desktop and
   terminal input behavior. Keep list and search caches distinct.
2. Add Linear provider search using the palette's mapping filter, followed by Rollbar provider
   search through the items endpoint. Return rail rows and explicit incomplete status.
3. Add GitHub PR search scoped to the routed repository and selected tab. Fetch missing PR detail
   before actions that require it.
4. Update the owning plugin, integration, caching, and UI documentation when the behavior ships.

Tests should prove that each provider finds a match beyond its ordinary list limit, keeps the
project and connection mapping, and never mixes Open and Closed results. Exercise a query changed
while a request is in flight, a project or Node switch, partial and total provider failure, empty
results, and an incomplete page. Check that a result still navigates to the correct detail and
supplies or fetches the data its row actions need. Run `pnpm lint` and the relevant plugin and host
tests. Test the desktop interaction in a real Tauri window and the terminal list's focus and `/`
shortcut, following `docs/local-development.md`.

## Verify before building

- Recheck the route, manifest, and result schemas against the implementation. Paths above locate the
  design's owners, not frozen APIs.
- Verify provider search behavior with fixtures or a disposable account before promising matching
  semantics, especially Rollbar's query language and GitHub's search result fields.
- Measure the number of mapped connections and provider calls for a typical search. Set a bounded
  first page and a request deadline that fits the client fan-out deadline.
- Decide whether Linear and Rollbar need historical tabs. If they do, settle the status vocabulary
  before adding a generic state field to the source contract.
