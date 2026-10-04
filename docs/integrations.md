# Integrations

Integrations are provider connections the Node owns, such as GitHub, Linear, Rollbar, Sentry, OpenAI,
and Anthropic. Core's registry stores each connection's provider, account metadata, scopes,
capabilities, health, and encrypted credential reference. The plugin that implements a provider
contributes its descriptors, validation, routes, and projections. Read this page for the connection
model and to find the page for each provider.

Typed Linear and Rollbar query operations are documented in [typed data sources](./data-sources.md).
GitHub pull requests and Actions jobs use an explicit connection. Workspace reach includes links
stored in `workspace_external_projects` and the repository facets of local projects; the latter are
GitHub's project association, not duplicate external-project rows. Linear's richer issue facts remain
demand-dependent.

Provider resource requests can set `requireFresh: true` to block on a refresh and return its failure.
This mode refuses cached fallback, including when the connection needs authentication or is disabled.
Ordinary resource reads and `force` refreshes retain their cache behavior.

## Connection lifecycle

Settings lists connections under **Connections** ([connection settings](./integrations/settings.md)).
You can create, replace, test, turn off, turn on, or delete a connection. Secret fields are
write-only, so the client gets presence, health, scopes, and account metadata, never plaintext.
Deleting a connection deletes its cached external items, freshness markers, project links, and task
links. The provider mirror is disposable and isn't the source of truth.

The generic administration routes are under `/v1/core/integrations`. Provider routes are under
`/v1/p/<provider>/...`, behind the provider-access gate, which keeps task-scoped internal callers out.

A built-in provider can contribute a Hono router. A loaded provider must contribute the portable
fetch carrier, and the host rejects a live Hono instance from that tier. Both pass the same gate.
Fetch handlers get an owner- and plugin-bound `PluginProviderRuntime`. It checks that the requested
provider belongs to the calling plugin, keeps SQLite and the secret service behind host calls, and
lends each decrypted credential through `withConnections` only for the callback.

The runtime asks two registries. `resource()` and `items()` ask the integration registry, because only
an integration provider has mirrored resources and external items. `connections()` and
`withConnections()` ask the connection registry, which every provider is in, so a plugin that mirrors
nothing, such as the model providers or the Sentry exporter, can still use its own connection.

`items(providerId)` hands a route the provider's slice of core's external-item cache. It exists for
resolution across connections, where an identifier has no `connectionId` yet. Every query carries the
provider, and a freshness-marker key outside the provider's `provider:<id>:` namespace is refused.

Provider resource requests can set `requireFresh: true` to wait for a refresh and return its failure,
with no cached fallback, even when the connection needs authentication or is off. Ordinary reads and
`force` refreshes keep their cache behavior ([provider mirrors](./caching.md#provider-mirrors)).

## Pages

<a id="settings"></a>
<a id="naming-a-connection"></a>

- [Connection settings](./integrations/settings.md): the Services and AI models pages, and naming.

<a id="connection-and-integration-contributions"></a>
<a id="item-detail"></a>
<a id="comments-and-images"></a>
<a id="the-row-menu"></a>

- [Connection and integration contributions](./integrations/contributions.md): the two contribution
  types, item detail, comment and image hooks, and the row menu.

<a id="project-sources"></a>
<a id="the-map-itself"></a>

- [Project sources](./integrations/project-sources.md): how providers list projects, and the map.

<a id="linear"></a>
<a id="rollbar"></a>
<a id="sentry"></a>

- [Linear](./integrations/linear.md), [Rollbar](./integrations/rollbar.md), and
  [Sentry](./integrations/sentry.md): the provider plugins.

<a id="model-providers"></a>

- [Model providers](./integrations/model-providers.md): backends for Generate controls.

<a id="provider-boundaries"></a>

- [Provider boundaries](./integrations/provider-boundaries.md): credentials, errors, and the RPC
  boundary.

## GitHub

GitHub connects with the OAuth device authorization flow. Its account metadata is separate from the
Node owner's identity, and it isn't an acorn login. [GitHub integration](./github-integration.md)
covers it.

## From the command palette

Linear and Rollbar each contribute one project-scoped `search` command, declared in the plugin's
manifest and answered by its Node half ([command kinds](./plugins.md#command-kinds)):

| Command | Route | Rows |
| --- | --- | --- |
| Find a Linear issue | `/v1/p/linear/palette/issues` | Active issues in the Linear projects and teams the routed project's workspace links |
| Find a Rollbar item | `/v1/p/rollbar/palette/issues` | Active items in the connections the routed project's workspace maps |

Each route gets two inputs, `projectId` from the palette session and `q`, the typed text. Scope comes
from the same code as the rail beside it, so a connection the routed project maps nothing of isn't
asked, and the command isn't offered without a routed project. Rows use the rail identity
`<connection>:<identifier>`, so two connections with the same display identifier can't collide. Each
route returns at most 50 rows and uses the same per-connection scheduler and budget as other reads.

Picking a row runs the `navigate` verb, which only a project-scoped search may name. An item's detail
belongs to the project, so a pick changes the URL and the surface beside the rail follows. The host
mints the address from its registered pattern with the row's sanitized ID. A row carries display facts
and that ID, no credential and no action. Promoting a row to a task stays on the rail.
[Linear](./integrations/linear.md#palette-search) and [Rollbar](./integrations/rollbar.md#palette-search)
say how each one searches.
