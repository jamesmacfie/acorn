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
than truncated into a different project.

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

The rail lists the issues of the projects the workspace has linked; with no linked projects it falls
back to the viewer's own open issues. That fallback started as a mitigation for having no writer and is
now a deliberate choice: a descriptor rail's empty state is a fixed "Nothing here yet." that no
contribution can author, so removing the fallback would show nothing and explain nothing
(see the linear-migration summary in [third-party/README.md](./third-party/README.md)).

## Rollbar

Rollbar is a read-focused provider. It lists active items, loads item/occurrence details, promotes an
item to a task, and contributes a task pane/source. Payloads are normalized through a strict privacy
allowlist before persistence or rendering. List, detail, occurrence history, and occurrence detail
have independent freshness.

A Rollbar credential is a project access token, so a connection *is* one project. Its project source
therefore makes no outbound call: it returns the single project recorded on the connection when the
token was validated. It is declared rather than omitted because Rollbar's rail scopes on the connection
ids in a workspace's mapping, so without one selectable row that mapping could not be expressed at all.

## Model providers

OpenAI and Anthropic connections are registered through the model-provider plugin. Adapters expose a
typed `generate` capability for consumers such as database SQL generation. Prompts and responses are
not written to the model-provider database; ambiguous generation failures are not automatically
retried.

## Provider boundaries

Provider credentials are read through named plugin accessors and CoreServices. Outbound calls are
made by the owning provider plugin; there is no shared host allowlist or central outbound guard.
Each provider maps responses into protocol-safe projections; raw payloads and credential material
do not cross into the renderer.
