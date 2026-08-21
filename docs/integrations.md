# Integrations

Integrations are Node-owned provider connections. The core integration registry stores provider
identity, account metadata, scopes, capabilities, health, and encrypted credential references. The
plugin that implements a provider contributes descriptors, validation, routes, and projections.

## Connection lifecycle

Settings → Integrations lists provider descriptors and current connection state. A connection can be
created, replaced, tested, disabled, enabled, or deleted. Secret fields are write-only; the client
receives presence, health, scopes, and account metadata instead of plaintext.

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
external-item cache — the same store a mirrored resource receives on `ProviderResourceContext.items`.
It exists for the one read `resource()` cannot express: resolution that spans connections, where an
identifier has not yet been attributed to a connection so there is no `connectionId` to key a resource
call on. The ownership check runs at the ask, and the store it returns is built for that provider —
every query it makes carries the provider, and a freshness-marker key outside the provider's own
`provider:<id>:` namespace is refused — so a plugin can never read or write another provider's rows
through it.

Deleting a connection cascades its cached external items, freshness markers, project links, and task
links. The provider mirror is disposable and is never treated as the upstream source of truth.

## Connection and integration contributions

Every provider registers a `ConnectionProviderContribution`: connection lifecycle, capabilities,
request budgets, and optionally a project source and a model catalog. A provider that also mirrors
external items, such as GitHub or Linear, extends that into an `IntegrationProviderContribution`,
adding the external-id contract, mirrored resources, a codec, task-context formatting, reference
resolution, and mutations. Two registries hold them: the connection registry holds every provider, and
the integration registry holds only the ones that extend it. Model providers such as OpenAI and
Anthropic register in the connection registry only, because they have nothing to mirror.

`projects` lives on the base `ConnectionProviderContribution` rather than on the integration
extension, because whether a connection can be scoped to a set of the provider's projects is a
property of the connection, not of whether the provider also mirrors items. Keeping it there means a
provider with nothing to enumerate is excluded simply by declaring nothing, with no separate flag that
has to agree with the first.

A route reaches core state only through `ExternalItemStore` (`integrations/itemStore.ts`), scoped to
one provider at construction, never through core's own database handle. Provider routes used to
receive that handle directly, which let a route write to any core table and tied Linear's and
Rollbar's schemas to every core migration. `ExternalItemStore` confines a route to its own rows in the
external-item cache and nothing else.

## Project sources

A provider may declare a `projects` source on its connection contribution: given a connection and its
unsealed credential, list the projects that connection offers as `{ id, label }`. It exists so core's
own workspace-mapping picker can ask every provider the same question without knowing which provider it
is asking, and it is served on a core route, `GET /v2/core/integrations/:id/projects`.

Declaring it is optional and its absence is the answer, not an error: a provider with nothing to
enumerate never appears in the picker. The public descriptor carries `supportsProjects`, derived from
the presence of the source in two places independently — the projection and the registry's descriptor
check — so a provider cannot advertise projects it has no source for.

The host runs the source, never the plugin: inside the credential's secret scope, inside the provider's
request budget, per connection so one connection's failure stays its own. Nothing is cached, because a
picker's list is a claim about the provider now and a stale one tells the owner they have no projects
when they have just made one. The returned list is bounded and re-checked before it is offered for
selection — an entry's `id` becomes a database row, so an unusable or over-long one is dropped rather
than truncated into a different project. The bound matches what the workspace-mapping write already
accepts through Zod: up to 500 projects, ids and labels capped at 200 bytes each, generous enough that
no honest provider notices.

It is deliberately not a mirrored resource under a reserved id. That contract mirrors external *items*:
the provider is handed the external-item store and nothing else, and the sync engine re-reads that store
after every refresh. A project list would have had to be written into `issues` — the table behind task
links, agent context sections and cross-connection identifier resolution — to travel that path.

## GitHub

GitHub is connected with the OAuth device authorization flow. Its account metadata is separate from
the node-owner identity used to scope identity-owned records; it is not an acorn login. See
[github-integration.md](./github-integration.md).

## Linear

Linear uses GraphQL and supports multiple connections. Projects and issues carry the connection ID;
issue keys are not globally unique across connections — which is why a rail row and a task link both
carry the connection, and why a bare `ENG-42` from PR text is resolved by asking each connected
workspace in turn.

Linear ships as a LOADED plugin. Its rail source lists issues, promotes one to a task with the issue's
own suggested branch, links issues, posts comments, recognises `linear.app` issue URLs, and renders
the reference panel github's PR detail shows — as manifest descriptors and a sandboxed frame rather
than compiled contributions. It contributes a project source, so its workspaces appear in core's
project picker.

The rail lists only the issues of the projects a workspace has linked. With none linked, the source
declares its own `emptyState` ("no linked Linear projects") rather than falling back to any issues
([plugins.md § Descriptors](./plugins.md)). An earlier version fell back to the viewer's own open
issues, cover for a rail that had no way to explain an empty list; that fallback is gone now that a
source can author the message itself (see the linear-migration summary in
[third-party/README.md](./third-party/README.md)).

The rail used to be a client-side browse pane with its own filtering, sorting and faceting over a
locally loaded issue set. None of that survived the move to a host-drawn rail: a rail row is data the
host renders, so there are no filter inputs, facet selects or state columns for a source to serve.
Ordering and the priority projection did survive, moved onto the node since that is where the rows are
now built.

Ticket attachments are proxied through a Node route rather than loaded straight into the frame: a
plugin frame's CSP allows no network calls ([plugin-authoring.md § The client
half](./plugin-authoring.md)), and Linear's upload host wants the same credential the GraphQL API
takes. The route accepts only that one host, `uploads.linear.app`, as a fetch target. An issue
description is third-party content, and any other host would turn the route into a general-purpose
proxy spending the owner's Linear key on the caller's behalf.

The ticket frame renders from host-supplied context alone, never from its own idea of which surface
it is. A reference panel carries an unscoped `refId`, an identifier another plugin found in its own
content such as `ENG-42` in a PR body, resolved across every connected workspace because nothing
told the panel which one owns it. A pane carries either `item` (a rail row was clicked) or `taskId`
(show whatever this task already links). The frame reads whichever the host set.

A `linear.app` ticket link inside rendered ticket content re-points this same view rather than
going through the host's usual link resolution. The host's resolution would swap the reference
panel's subject, or remount the pane, losing the reader's open tab, scroll position, and the way
back to whatever ticket they came from; every other link in the ticket still goes over the bridge to
the host's normal in-app-or-browser handling.

## Rollbar

Rollbar is a read-focused provider. It lists active items, loads item/occurrence details, promotes an
item to a task, and contributes a task pane/source. Payloads are normalized through a strict privacy
allowlist before persistence or rendering. List, detail, occurrence history, and occurrence detail
have independent freshness.

A Rollbar credential is a project access token, so a connection *is* one project. Its project source
therefore makes no outbound call: it returns the single project recorded on the connection when the
token was validated. It is declared rather than omitted because Rollbar's rail scopes on the connection
ids in a workspace's mapping, so without one selectable row that mapping could not be expressed at all.

An occurrence detail is capped for size: up to 10 trace chains, 200 frames total, 7 code lines per
frame, 8 KiB per string, and 192 KiB per detail (`CAPS` in `plugins/rollbar/src/server/normalize.ts`).
Tests assert against the same constants, so a cap cannot drift between the code and its coverage.

## Model providers

OpenAI and Anthropic connections are registered through the model-provider plugin. Adapters expose a
typed `generate` capability for consumers such as database SQL generation. Prompts and responses are
not written to the model-provider database; ambiguous generation failures are not automatically
retried.

The model-providers plugin has no database and no routes: it only turns a stored credential into an
OpenAI or Anthropic HTTP call. There is no generic model HTTP endpoint. A consumer calls
`CoreServices.models.generateText` and owns its own route, because a shared endpoint would be an
unbudgeted proxy to whatever the caller asked for. Each connection provider registers before its
matching model adapter; the model registry refuses an adapter naming a connection provider that
has not registered yet, or one that has not declared `textGeneration`.

## Provider boundaries

Provider credentials are read through named plugin accessors and CoreServices. Outbound calls are
made by the owning provider plugin; there is no shared host allowlist or central outbound guard.
Each provider maps responses into protocol-safe projections; raw payloads and credential material
do not cross into the renderer.

Every outbound provider call, for a connection test, a mirrored resource, a project list, or a route
handler's own fetch, runs inside `secrets.use`'s callback rather than after it returns the plaintext.
A provider that echoes its own credential back in an error body has it scrubbed at that boundary,
before the failure is logged or reaches the client (`main/core/secrets.ts`).

A provider failure that is not a deliberate `ProviderOperationError` is flattened to
`provider_unavailable` before it reaches the client (`integrations/respondProvider.ts`), shared by
core's own connection routes and by plugin-owned connect flows such as GitHub's device flow. An
upstream exception message can quote a URL, a token fragment, or a response body, so a second copy of
that mapping would only be a second place for one of those to leak through.
