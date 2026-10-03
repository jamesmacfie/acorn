# API reference

This page is the map of a Node's `/v1` API. Read it to find the page that owns a route, a header, or
a frame before you change one.

The Node serves one Hono application under `/v1`, built by `createApp()` in
`packages/node-core/src/server/index.ts`. Core owns `/v1/core/*`, and each plugin owns
`/v1/p/<plugin>/*`. Both sit behind one auth gate, so a route can't escape it by choosing a prefix.
`GET /v1/node` and `POST /v1/pair` are the only routes a caller reaches without a credential. Every
route answers JSON with an `X-Request-Id`, and there's one authenticated WebSocket at `/v1/events`.

Core route builders and response types are published through `@acorn/protocol/api.ts`. The route
modules own field and validation details, and there's no OpenAPI document or generated client.

## Pages

<a id="transport"></a>
<a id="pairing"></a>
<a id="versioning"></a>
<a id="request-processing"></a>
<a id="errors"></a>
<a id="captured-client-origins"></a>

[Transport, pairing, and versioning](./api-reference/transport.md) covers the namespaces, the broker's
request deadline, pairing codes and their limits, the protocol major and the tolerant handshake, the
middleware order, idempotency keys, and the error envelope.

<a id="core-routes"></a>
<a id="node-administration"></a>
<a id="preferences-and-integrations"></a>
<a id="workspaces-and-tasks"></a>
<a id="worktrees-configuration-and-run-targets"></a>
<a id="task-script-reads"></a>

[Core routes](./api-reference/core-routes.md) lists every `/v1/core` route with its gate: node
administration, plugins, schedules, preferences, integrations, telemetry, workspaces, projects,
tasks, run targets, task scripts, data sources, queries, and dashboards.

<a id="plugin-routes"></a>
<a id="github"></a>
<a id="agents"></a>
<a id="notes-and-memory"></a>
<a id="other-feature-plugins"></a>
<a id="changes-diff-document"></a>
<a id="command-palette-routes"></a>
<a id="loaded-agent-tools-and-context-sections"></a>
<a id="memory-library-operations"></a>

[Plugin routes](./api-reference/plugin-routes.md) lists the route families of GitHub, agents,
terminal, changes, editor, Docker, notes, memory, preview, browser, and the loaded plugins, with the
GitHub pull request and Changes diff document contracts.

<a id="terminal-workflows-and-execution"></a>

[Workflow routes](./api-reference/workflow-routes.md) lists the workflows plugin's run, processing
history, definition, and schedule binding routes.

<a id="websocket"></a>
<a id="logical-event-viewers"></a>

[WebSocket](./api-reference/websocket.md) covers `/v1/events`, logical viewers, the preview tunnel,
channel prefixes, and the eleven Node events.

## Related pages

- [Authentication](./authentication.md) owns principals, device tokens, and internal tokens.
- [Transport and authentication](./security/transport-and-auth.md) owns the gates and why each route
  sits behind the one it does.
- [Node API](./architecture/node-api.md) owns the route families and the platform seam from the
  client's side.
