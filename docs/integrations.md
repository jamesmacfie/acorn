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

Deleting a connection cascades its cached external items, freshness markers, project links, and task
links. The provider mirror is disposable and is never treated as the upstream source of truth.

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
than compiled contributions. The rail lists the issues of the projects the workspace has linked; with
no linked projects it falls back to the viewer's own open issues, because choosing linked projects is a
workspace write no loaded plugin can perform ([third-party/linear.md](./third-party/linear.md)).

## Rollbar

Rollbar is a read-focused provider. It lists active items, loads item/occurrence details, promotes an
item to a task, and contributes a task pane/source. Payloads are normalized through a strict privacy
allowlist before persistence or rendering. List, detail, occurrence history, and occurrence detail
have independent freshness.

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
