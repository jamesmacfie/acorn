# Integrations

Integrations are Node-owned provider connections. The core integration registry stores provider
identity, account metadata, scopes, capabilities, health, and encrypted credential references. The
plugin that implements a provider contributes descriptors, validation, routes, and projections.

## Connection lifecycle

Settings → Integrations lists provider descriptors and connection state. A connection can be created,
replaced, tested, disabled, enabled, or deleted. Secret fields are write-only, so the client receives
presence, health, scopes, and account metadata instead of plaintext.

Provider routes are projected under `/v2/p/<provider>/...` and are protected from task-scoped internal
callers by the provider-access gate. The generic administration routes are under
`/v2/core/integrations`.

Built-in providers may contribute a Hono router. Loaded providers must contribute the portable fetch
carrier instead; the host rejects a live Hono instance from that tier. Both carriers pass through the
same provider-access gate. Fetch handlers receive an owner- and plugin-bound `PluginProviderRuntime`
for resource execution and connection enumeration. The runtime verifies that the requested provider
belongs to the calling plugin and keeps SQLite and the secret service behind host calls;
`withConnections` lends each decrypted credential only for the duration of the provider callback.

The runtime's fourth member, `items(providerId)`, hands a route the provider's slice of core's
external-item cache, the same store a mirrored resource receives on `ProviderResourceContext.items`.
It exists for the one read `resource()` cannot express: resolution that spans connections, where an
identifier has not yet been attributed to a connection so there is no `connectionId` to key a
resource call on. The ownership check runs at the ask, and the store it returns is built for that
provider. Every query it makes carries the provider, and a freshness-marker key outside the
provider's own `provider:<id>:` namespace is refused, so a plugin can never read or write another
provider's rows through it.

Deleting a connection cascades its cached external items, freshness markers, project links, and task
links. The provider mirror is disposable and is never treated as the upstream source of truth.

## Connection and integration contributions

Every provider registers a `ConnectionProviderContribution`: connection lifecycle, capabilities,
request budgets, and optionally a project source and a model catalog. A provider that also mirrors
external items, such as GitHub or Linear, extends that into an `IntegrationProviderContribution`,
adding the external-id contract, mirrored resources, a codec, task-context formatting, reference
resolution, and mutations. Two registries hold them: the connection registry holds every provider,
and the integration registry holds only the ones that extend it. Model providers such as OpenAI and
Anthropic register in the connection registry only, because they have nothing to mirror.

`projects` lives on the base `ConnectionProviderContribution` rather than on the integration
extension, because whether a connection can be scoped to a set of the provider's projects is a
property of the connection rather than of whether the provider also mirrors items. Keeping it there
means a provider with nothing to enumerate is excluded by declaring nothing, with no separate flag
that has to agree with the first.

A route reaches core state only through `ExternalItemStore` (`integrations/itemStore.ts`), scoped to
one provider at construction, never through core's own database handle. Provider routes used to
receive that handle directly, which let a route write to any core table and tied Linear's and
Rollbar's schemas to every core migration. `ExternalItemStore` confines a route to its own rows in the
external-item cache and nothing else.

## Project sources

A provider may declare a `projects` source on its connection contribution: given a connection and its
unsealed credential, list the projects that connection offers as `{ id, label }`. It exists so core's
own project map can ask every provider the same question without knowing which provider it
is asking, and it is served on a core route, `GET /v2/core/integrations/:id/projects`.

Declaring it is optional and its absence is the answer rather than an error: a provider with nothing
to enumerate never appears in the picker. The public descriptor carries `supportsProjects`, derived
from the presence of the source in two places independently, the projection and the registry's
descriptor check, so a provider cannot advertise projects it has no source for.

The host runs the source, never the plugin: inside the credential's secret scope, inside the
provider's request budget, and per connection so one connection's failure stays its own. Nothing is
cached, because a picker's list is a claim about the provider at that moment and a stale one tells
the owner they have no projects when they have just made one. The returned list is bounded and
re-checked before it is offered for selection. An entry's `id` becomes a database row, so an unusable
or over-long one is dropped rather than truncated into a different project. The bound matches what
the workspace-mapping write already accepts through Zod: up to 500 projects, ids and labels capped at
200 bytes each, generous enough that no honest provider notices.

### The map itself

A link is a row in `workspace_external_projects`: a workspace, a connection, one of that connection's
external projects, and optionally one project in that workspace. Leave the project off and every
project in the workspace follows it; name one and only that project's rails do. `''` in the column is
how the table spells "the whole workspace", because SQLite does not enforce a primary key across a
nullable column and this key is what stops a link being stored twice.

It is edited from the connection, in Settings → Integrations, not from a workspace at a time: one
Linear or Rollbar connection usually serves every workspace on the machine, so its whole map reads
better in one place. `GET` and `PUT /v2/core/integrations/:id/mappings` carry it. The write replaces
every row that connection owns, across all workspaces, which is what keeps a sibling connection's
rows out of it without anyone having to merge. `PUT /v2/core/workspaces/:id/external-projects` is the
same table from the other side, still there for a plugin replacing its own provider's slice.

Neither route is reachable from a plugin frame. Both spend nothing and read nothing outbound, but the
connection-side write replaces a whole map, so a frame that reached it could quietly unfollow
everything the owner had set up.

It is deliberately not a mirrored resource under a reserved id. That contract mirrors external items:
the provider is handed the external-item store and nothing else, and the sync engine re-reads that
store after every refresh. A project list would have had to be written into `issues`, the table
behind task links, agent context sections, and cross-connection identifier resolution, to travel that
path.

## The row menu

Every integration list draws the same overflow menu on a row, from the context-menu registry's
`item.row` location ([plugins.md](./plugins.md) § Context menus). Core's rail list draws it for
Rollbar and Linear, github's pull-request list draws its own, and both fill it from one registry, so
a row added for one tracker is a row on all of them. **Create task** is core's, or github's for a
pull; **Start workflow…** is the workflows plugin's
([workflows.md](./workflows.md) § Starting a run). A loaded plugin can add one through its manifest.

## GitHub

GitHub is connected with the OAuth device authorization flow. Its account metadata is separate from
the node-owner identity used to scope identity-owned records, and it is not an acorn login. For more
information, see [the GitHub integration doc](./github-integration.md).

## Linear

Linear uses GraphQL and supports multiple connections. Projects and issues carry the connection ID,
because issue keys are not globally unique across connections. That is why a rail row and a task link
both carry the connection, and why a bare `ENG-42` from PR text is resolved by asking each connected
workspace in turn.

Linear ships as a loaded plugin. Its rail source lists issues, promotes one to a task with the
issue's own suggested branch, links issues, posts comments, recognises `linear.app` issue URLs, and
renders the reference panel github's PR detail shows, all as manifest descriptors and a sandboxed
frame rather than compiled contributions. It contributes a project source, so its workspaces appear
in core's project picker.

The rail lists only the issues of the projects a workspace has linked, and with none linked the shell
does not draw the source at all (see the source gates in [the frontend doc](./frontend.md)). Its
`emptyState` therefore speaks to the case that remains: projects are linked and none of them has an
active issue. See descriptors in [the plugins doc](./plugins.md). An earlier version fell back to the
viewer's own open issues, cover for a rail that had no way to explain an empty list. That fallback is
gone, since a source can author the message itself. See the linear-migration summary in
[the third-party README](./loaded-plugin-migration.md).

The rail used to be a client-side browse pane with its own filtering, sorting, and faceting over a
locally loaded issue set. None of that survived the move to a host-drawn rail, because a rail row is
data the host renders, so there are no filter inputs, facet selects, or state columns for a source to
serve. Ordering and the priority projection did survive, moved onto the node since that is where the
rows are built.

Ticket attachments are proxied through a Node route rather than fetched by the plugin: a plugin's
client code has no network at all, and Linear's upload host wants the same credential the GraphQL API
takes. The route accepts only that one host, `uploads.linear.app`, as a fetch target. An issue
description is third-party content, and any other host would turn the route into a general-purpose
proxy spending the owner's Linear key on the caller's behalf.

**The pane no longer inlines those uploads, and an image in a ticket is a link.** It used to fetch each
one through that route and swap a `data:` URL into the markdown, which an iframe needed because its CSP
allowed no image host. A tree does not draw the markdown at all — the host does, from a `text` prop on
a message port — and a screenshot as base64 is a prop big enough to trip the batch cap and take the
whole ticket down with it. The route stays for anything that wants a proxied upload by URL.

The ticket renders from what the host mounted it with, never from its own idea of which surface it is.
A reference panel carries an unscoped identifier another plugin found in its own content, such as
`ENG-42` in a PR body, resolved across every connected workspace because nothing told the panel which
one owns it. A pane carries either that same `item` (a rail row was clicked) or `taskId` (show whatever
this task already links). The tree reads whichever the host set.

A `linear.app` ticket link inside rendered ticket content re-points this same view rather than going
through the host's usual link resolution. The host's resolution would swap the reference panel's
subject, or remount the pane, losing the reader's open tab, scroll position, and the way back to
whatever ticket they came from. Every other link in the ticket still goes over the bridge to the
host's normal in-app or browser handling.

## Rollbar

Rollbar is a read-focused provider. It lists active items, loads item/occurrence details, promotes an
item to a task, and contributes a task pane, a project-scoped pane and a source. Picking a row from
the rail draws the item beside the list at `/p/:projectId/x/rollbar/items/:item`, with no task
involved; the task pane is the linked-items view. Payloads are normalized through a strict privacy
allowlist before persistence or rendering. List, detail, occurrence history, and occurrence detail
have independent freshness.

A Rollbar credential is a project access token, so a connection is one project. Its project source
therefore makes no outbound call: it returns the single project recorded on the connection when the
token was validated. It is declared rather than omitted because Rollbar's rail scopes on the
connection ids in a workspace's mapping, so without one selectable row that mapping could not be
expressed at all.

That scoping closes rather than falls open. A rail request with no `?project=` on it, which is what a
stale plugin package sends, returns no rows instead of every connection's, because the alternative was
one workspace's errors listed under every other workspace.

An occurrence detail is capped for size: up to 10 trace chains, 200 frames total, 7 code lines per
frame, 8 KiB per string, and 192 KiB per detail (`CAPS` in `plugins/rollbar/src/server/normalize.ts`).
Tests assert against the same constants, so a cap cannot drift between the code and its coverage.

## From the command palette

Linear and Rollbar each contribute one project-scoped `search` command, declared in the plugin's own
manifest and answered by that plugin's own node half.
[command-palette-and-shortcuts.md](./command-palette-and-shortcuts.md) covers how the palette runs a
search, and [plugins.md](./plugins.md) § Command kinds holds the vocabulary.

| Command | Route | Rows |
| --- | --- | --- |
| Linear: find an issue | `/v2/p/linear/palette/issues` | active issues in the Linear projects the routed project's workspace links |
| Rollbar: find an item | `/v2/p/rollbar/palette/issues` | active items in the connections the routed project's workspace maps |

Each route is given two things and nothing else: `projectId`, the project the palette session
captured, and `q`, the typed text. Neither the manifest nor a previous answer writes either one.
Scope is resolved by the same code the rail beside it uses, so a connection the routed project maps
nothing of is never asked, and the command is not offered where there is no routed project.

**Rollbar filters a list it already has.** The route reuses the rail's own `scopedConnections` and
`listItems`, and `listItems` reads the mirrored `rollbar.items` resource, whose two-minute TTL the
rail is already refreshing (see the provider mirrors in [the caching doc](./caching.md)). Typing
therefore spends no extra provider budget. Partial connection success is preserved as it is on the
rail: one connection failing does not erase the rows another answered with, and only a total wash is
reported as an error.

**Linear asks the provider instead**, and the reasoning is the more interesting half. Linear's
`IssueFilter` supports the mapping filter the rail already sends, `project: { id: { in: … } }`, so a
title clause and an identifier clause ride along with it (`projectIssueSearchFilter` in
`plugins/linear/src/server/index.ts`). There is also no cached active mapped-project set to filter:
`/rail-items` calls `providerFetch` directly, and Linear's reads are exempt from
serve-then-revalidate. Filtering "the cache" would have meant fetching the first hundred active
issues per keystroke and searching those — the same request count, more bytes, and unable to find the
hundred-and-first. `searchableContent` was refused because it reads every description as well, which
is a different question from "find the ticket I am thinking of", and it is the field most likely to
vary by plan. `title` and `number` have been in `IssueFilter` since the beginning.

Both normalize their rows through their existing rail identity, `<connection>:<identifier>`, so two
connections whose teams or counters share a display identifier cannot collide. Each route returns at
most 50 rows, which is the bound the host renders to anyway, and both read through the same
per-connection scheduler and budget as every other read, so no rate-limit policy changed hands.

Picking a row runs the `navigate` verb, which no other command may name. An item's detail belongs to
the project rather than to a task, so a pick changes the URL and the surface beside the rail list
follows, exactly as clicking the same row in that list does. It is available only here because it
needs a selected row and a routed project, and a project-scoped search is the one command site with
both. The address is minted from the pattern the host registered, with the row's sanitized id as the
item: the response chooses nothing.

A search answers with display facts and that id, and with nothing else. There is no credential in a
row — Rollbar's and Linear's tokens are lent to the route by core and never travel outward — and no
action, route or verb, because the verb that runs is the static one the manifest declared. Creating
a task from a Rollbar item is not what picking one means. Promotion stays the deliberate act it is
on the rail. Commenting and issue mutation stay in the issue surface.

## Model providers

OpenAI and Anthropic connections are registered through the model-provider plugin. Adapters expose a
typed `generate` capability for consumers such as database SQL generation. Prompts and responses are
not written to the model-provider database, and ambiguous generation failures are not retried
automatically.

The model-providers plugin has no database and no routes. It turns a stored credential into an OpenAI
or Anthropic HTTP call, and nothing more. There is no generic model HTTP endpoint. A consumer calls
`CoreServices.models.generateText` and owns its own route, because a shared endpoint would be an
unbudgeted proxy to whatever the caller asked for. Each connection provider registers before its
matching model adapter, and the model registry refuses an adapter naming a connection provider that
has not registered yet, or one that has not declared `textGeneration`.

Three routes consume the seam, and each owns its own prompt:

| Consumer | Route | Prompt | Answer |
| --- | --- | --- | --- |
| database | `POST /v2/p/database/tasks/:taskId/generate` | The live schema, the repo's schema notes, and any saved queries picked as worked examples | SQL, with the fences stripped |
| changes | `POST /v2/p/changes/tasks/:id/local/commit-message` | The branch name and the diff the next commit would take, capped at 12,000 characters, smallest files first | A commit message, into the editor's draft |
| workflows | `POST /v2/p/workflows/defs/generate` | What a workflow is, the step kinds generated from the node's own catalog, and the workspace's valid definitions as worked examples, capped at 90,000 characters | A whole definition, into the editor's draft as one undo step |

All three check the same thing before they spend anything: the caller is a device or the node's own
service scope. An automation caller holding a task-scoped token has no editor to put the answer in,
and generation spends the owner's provider key (§ Credential handling in
[security.md](./security.md)). Workflows gets that gate from its `/defs` family being device-only,
which is stricter again. Each also offers the read half, `models.available(userId)`, through a route
of their own, for the same reason: `/v2/core/integrations` has no bridge scope, and minting one would
hand every installed plugin the whole connection roster to serve one dropdown. Ids and labels cross;
the key stays on the node and is resolved inside `generateText`.

Workflows is also the one that asks the model twice. When the first definition does not pass the
workflow checker, the checker's messages go back once, and the repaired answer is taken if it parses
at all. That is why its route needs a longer request timeout than the broker's default
([workflows.md](./workflows.md) § Generating one from a description).

A `ProviderOperationError` reaches the client with the status the reader has to act on, 401 to
reconnect the key and 429 to wait, because a flattened 500 gives them nothing to do. Anything else the
provider throws is flattened to `provider_unavailable`, per § Provider boundaries below.

## Provider boundaries

Provider credentials are read through named plugin accessors and CoreServices. The owning provider
plugin makes the outbound calls, and there is no shared host allowlist or central outbound guard.
Each provider maps responses into protocol-safe projections, so raw payloads and credential material
do not cross into the renderer.

Every outbound provider call, for a connection test, a mirrored resource, a project list, or a route
handler's own fetch, runs inside `secrets.use`'s callback rather than after it returns the plaintext.
A provider that echoes its own credential back in an error body has it scrubbed at that boundary,
before the failure is logged or reaches the client (`server/core/secrets.ts`).

A provider failure that is not a deliberate `ProviderOperationError` is flattened to
`provider_unavailable` before it reaches the client (`integrations/respondProvider.ts`), shared by
core's own connection routes and by plugin-owned connect flows such as GitHub's device flow. An
upstream exception message can quote a URL, a token fragment, or a response body, so a second copy of
that mapping would only be a second place for one of those to leak through.
