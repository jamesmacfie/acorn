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

Two registries answer two different ownership questions there. A mirrored resource and the
external-item store exist only on an integration provider, so `resource()` and `items()` ask the
integration registry. Reading a connection and spending its credential belong to the connection
contribution, which every provider has, so `connections()` and `withConnections()` ask the connection
registry. Asking the narrower one for a credential would refuse a plugin the use of its own
connection whenever it mirrors nothing, which is the position both the model providers and the
Sentry exporter are in.

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
adding the external-id contract, mirrored resources, a codec, task-context formatting, item detail,
reference resolution, and mutations. Two registries hold them: the connection registry holds every provider,
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

### Item detail

`detail` is the read behind core's `issue_detail` agent tool: given an identifier, return everything
the provider has on that one item, or `null` if this connection does not have it. Core calls it once
per connected workspace and takes the first answer.

The provider composes its own resources through the one method core lends it, because only the
provider knows how many the answer takes. Linear reads the issue and Rollbar reads the item, its
occurrence list and the newest occurrence. Declaring nothing means this provider offers summaries
only, which is the honest state for a provider whose items have no body.

Why the tool lives in core and the read lives here: `issue_detail` is the stable aggregation across
every connected issue and error provider. A loaded plugin can declare its own task-scoped tool, but
that would be provider-specific rather than automatically covering other providers. For the full
contract, see [agent tools](./agent-tools.md) § issue_detail.

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

The source row spends its narrow width on severity, identity, frequency and the error itself: a
semantic error/warning/info icon, one fixed-width `#id` field, the numeric occurrence badge, and an
ellipsised title. Environment and connection remain in the item detail and promotion seed; repeating
them in every source row crowds out the error name.

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

## Sentry

Two plugins carry the Sentry mark in Settings, and that is deliberate.

`sentry-telemetry` is the one that exists. It is a **sink**, not an integration: it reads this node's
own telemetry and posts it to Sentry as envelopes, so an error becomes an issue, a span becomes a
transaction, a log record becomes a structured log, a metric becomes a trace metric, and a
`schedule.run` span becomes a cron check-in ([telemetry.md](./telemetry.md) § Writing a sink). It
mirrors nothing, browses nothing and promotes nothing, so it registers a
`ConnectionProviderContribution` rather than an integration one, and its only surface is a settings
page.

`sentry` is the id held back for the plugin that reads Sentry issues into the rail, with the Rollbar
shape: mirrored items, a task pane, a source and promotion.
[future/integration-ideas.md](./future/integration-ideas.md) lists it and nothing is built.

The two are separate because they need different credentials and disclose different things. The
exporter needs a DSN, which authenticates ingestion into one project and can read nothing. The
integration needs an organisation token, which reads the owner's whole Sentry account. One plugin
holding both would ask for the wider credential to do the narrower job.

The connection is `kind: 'observability'`, `authKind: 'api-key'`, one row, three fields: the DSN as a
password, and `environment` and `release` as text. `validate` parses the DSN into a public key, a
host, an optional sub-path and a numeric project id, then posts an envelope with a header and no
items to prove the host answers. Sentry stores nothing for one of those, so a connection test costs
the owner no quota and leaves no invented event in their issue list. `normalize` labels the row
`Sentry · <host>/<project>` and puts the two text fields in `config`, which is non-secret and
provider-owned. Pointing at a staging project is a second row with a different `environment` rather
than a mode on this one, and `maxConnections` is 1 because the exporter spends the first usable row:
a second would receive nothing and say so nowhere.

The exporter reads the DSN back through `ctx.providers.withConnection`, once per flush, which is what
makes disconnecting stop the export inside one five-second window instead of at the next restart.
[security.md](./security.md) § Credential handling has the posture, and
[telemetry.md](./telemetry.md) § The first sink has what the exporter does with a batch.

## Model providers

A **backend** is one thing a Generate control can spend: a model-provider connection this owner has
stored a key for, or an agent CLI installed on this machine. `ModelBackend` in
`packages/protocol/src/modelProviders.ts` is the one read model over both, and it is deliberately
flat: an id, a kind of `connection` or `harness`, a label, an optional glyph, a model catalog that may
be empty, and a default model id that may be `''`. A connection's auth kind, scopes, account and
timestamps do not cross it, because no consumer reads them and a harness has none of them. A caller
that wants the connection row itself still has `/v2/core/integrations`.

A CLI is not a synthesized connection, and that is the decision the rest of this section follows
from. `generateTextForConnection` reads a database row, checks its status, reveals its secret and
marks it `needs-auth` on failure, and an installed CLI has none of those to offer. Giving it a fake
`Integration` entry would have put an `if (synthetic)` branch in every one of those steps and put an
`authKind` on the wire that means nothing.

OpenAI and Anthropic connections are registered through the model-provider plugin. Adapters expose a
typed `generate` capability for consumers such as database SQL generation. Prompts and responses are
not written to the model-provider database, and ambiguous generation failures are not retried
automatically.

The model-providers plugin has no database and no routes. It turns a stored credential into an OpenAI
or Anthropic HTTP call, and nothing more. There is no generic model *generate* endpoint. A consumer
calls `CoreServices.models.generateText` and owns its own route, because a shared endpoint would be an
unbudgeted proxy to whatever the caller asked for. Each connection provider registers before its
matching model adapter, and the model registry refuses an adapter naming a connection provider that
has not registered yet, or one that has not declared `textGeneration`.

**Core mints the ids and core parses them.** There are two prefixes and no others:
`connection:<uuid>` is an integrations row this owner holds, and `harness:<profileId>` is an entry in
the agent-profile registry that declares a one-shot text mode. A string with no prefix is read as a
connection uuid, and that rule is permanent rather than transitional: two stores hold a bare uuid
written before these ids existed, the `connectionId` of a saved `database:generate` workflow step and
the changes plugin's own device preference, and neither is rewritten. `parseBackendId` beside the
type is the one reader, with a test that a bare uuid and its prefixed form resolve to the same
connection. Because an id reaches a saved workflow step and a device preference, renaming a profile
is a compatibility break rather than a label edit, the same rule
[managed-agents.md](./managed-agents.md) § Harnesses states for harness ids.

**Connections come first in the list, and things depend on it.** `models.available(userId)` returns
every connected model provider with text generation available, in the order
`/v2/core/integrations` already serves them, and then every profile with a one-shot mode whose
command is on this machine, in registry order. Two paths take `available()[0]` without asking anyone:
the database plugin's palette route, where **Generate SQL** runs with no picker at all, and the
changes plugin's fallback when nothing has been picked yet. Both keep spending the key the owner
configured on purpose, and a CLI is chosen for someone only when there is no key at all, which is
the lock-out this list exists to fix.

**Availability is probed on every read, and nothing is cached.** `which` costs milliseconds, and the
list is read when a dialog opens, a Settings page mounts, or the wizard reaches its step, so a cache
would be a second source of truth to invalidate when someone installs a CLI while acorn is running.
The read does wait on one thing first: `spawnsReady()`, the login-shell PATH probe
(`server/core/loginShellPath.ts`). Off a packaged macOS build that probe can still be running when
the first read lands, and `which claude` before it settles answers "not installed" for a CLI that is.
`runHeadless` waits on the same gate before spawning, so the read and the call it leads to agree. A
profile that goes missing between the two fails the call with `provider_not_connected`, exactly as a
connection deleted between the two does.

**`generateText` dispatches on the prefix.** A `connection:` id goes to `generateTextForConnection`
in `server/modelProviders/runtime.ts`, unchanged. A `harness:` id goes to `generateTextForHarness` in
`server/modelProviders/harnessRuntime.ts`. Both return the same result, whose `backendId` says which
was spent, and both run behind the same `validateInput` first: a 60-second ceiling, 100,000 system
characters, 1,000,000 prompt characters, and 128,000 output tokens. `maxOutputTokens` is validated
and then ignored for a harness, because neither `claude` nor `codex` has a flag for it, and a bound
the caller states and the backend cannot honour is still worth refusing when it is absurd.

**A CLI generate is contained, and the containment is the whole of that function.** Tools are off,
which the profile's own `aiArgv` does. The working directory is an empty temporary directory, removed
in a `finally`, and it is empty on purpose: Claude Code reads `CLAUDE.md` from the working directory
and Codex reads `AGENTS.md`, so a generate started in a worktree would answer with that repository's
house rules in front of the caller's prompt. Everything the caller wants the model to see is already
in the prompt. The environment is the broker's base allowlist plus `AGENT_TOOL_PASSTHROUGH`
(`server/agentProfiles/toolEnv.ts`, which moved into core so core can read it without importing a
plugin), which is configuration only: no `ACORN_API_URL`, no `ACORN_API_TOKEN`, no
`ACORN_TOOL_CEILING`, no MCP server in the child, and no key acorn holds anywhere in it, so the CLI
authenticates with its own stored login (§ Credential handling in [security.md](./security.md)). The
run goes through the same `providerRequestScheduler` a connection call does, in a lane keyed by
profile id and bounded at two at once, so four dialogs opened together do not put four agent CLIs on
the machine. The caller's abort signal is chained the same way. A failure logs the stderr tail with
the profile id, the status and the duration to the node log and sends the client
`provider_unavailable`, per § Provider boundaries below.

What a generate deliberately is not is `agents.sessionExecute`. That path needs a task, creates a
durable session row, and appends to the transcript ledger per call. A commit message is not a
session, and forty "Workflow: commit message" rows in Agent Center is the wrong record.

Managed-session naming is the internal consumer that deliberately has no route or model picker. It
spends `harness:<session.profileId>` only after that profile's first accepted interactive prompt, so
it never falls through to a stored API credential or a different CLI. A profile without `aiArgv`,
including Aider, is unavailable for this path and keeps the deterministic prompt fallback.

**One core read route, and it is not the generate endpoint this section refuses.**
`GET /v2/core/models/backends` is device-only and answers `backends` in list order plus `missing`,
which is every profile with a one-shot mode whose command is not on this machine. The refusal above
is of a generic generate endpoint, an unbudgeted proxy to whatever a caller asked for. This is the
ids-and-labels projection `/v2/core/integrations` already serves for connections, and its consumers
are core's own surfaces: the onboarding wizard's step, the Settings section that lists the backends
and holds the shared default, and the project-settings gate on the AI-SQL schema editor that used to
count connections client-side. Nothing but the wizard reads `missing`. A plugin frame keeps the proxy
route its own plugin serves, because `/v2/core/*` has no bridge scope and minting one would hand
every installed plugin the whole roster to serve one dropdown.

Three routes consume the seam, and each owns its own prompt:

| Consumer | Route | Prompt | Answer |
| --- | --- | --- | --- |
| database | `POST /v2/p/database/tasks/:taskId/generate` | The live schema, the repo's schema notes, and any saved queries picked as worked examples | SQL, with the fences stripped |
| changes | `POST /v2/p/changes/tasks/:id/local/commit-message` | The branch name and the diff the next commit would take, capped at 12,000 characters, smallest files first | A commit message, into the editor's draft |
| workflows | `POST /v2/p/workflows/defs/generate` | What a workflow is, the step kinds generated from the node's own catalog, and the workspace's valid definitions as worked examples, capped at 90,000 characters | A whole definition, into the editor's draft as one undo step |

All three take a `backendId` and none of them chooses it: the person picking from the dropdown does,
or the plugin's own fallback to the first available backend. All three check the same thing before
they spend anything: the caller is a device or the node's own service scope. An automation caller
holding a task-scoped token has no editor to put the answer in, and a generate spends either the
owner's provider key or a login on their machine (§ Credential handling in
[security.md](./security.md)). Workflows gets that gate from its `/defs` family being device-only,
which is stricter again. Each also offers the read half, `models.available(userId)`, through a route
of their own, for the same reason the core route exists and no bridge scope does. Ids and labels
cross; the key, or the command, stays on the node and is resolved inside `generateText`.

Workflows is also the one that asks the model twice. When the first definition does not pass the
workflow checker, the checker's messages go back once, and the repaired answer is taken if it parses
at all. That is why its route needs a longer request timeout than the broker's default
([workflows.md](./workflows.md) § Generating one from a description).

A `ProviderOperationError` reaches the client with the status the reader has to act on, 401 to
reconnect the key and 429 to wait, because a flattened 500 gives them nothing to do. Anything else the
provider throws is flattened to `provider_unavailable`, per § Provider boundaries below. Each
consumer's failure copy has one branch on the backend kind, because "the provider did not answer" is
the wrong advice for a CLI that is installed but signed out: a harness failure names the CLI and says
to run it once in a terminal. Nothing probes for that on read. The agents plugin owns the auth
probes, core cannot import a plugin, and a probe per read would be a process per dropdown.

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
