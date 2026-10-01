# CLI command authoring

`cliCommands` is a loaded Node plugin contribution for headless, structured calls. It is separate
from the client command palette and agent tools. Only a running plugin's descriptors appear under
`acorn plugin ID commands`. The CLI and Node validate one bounded JSON object in and out; the Node
also checks device authority and resource scope at execution time.

Put this descriptor inside `contributions.cliCommands` in `acorn-plugin.json` (or in
`acorn-plugin.config.mjs` for a built package). The surrounding manifest also needs a Node entry,
`permissions.node.core: ["projects:read"]`, and a route contribution. This is one array element:

```json
{
  "name": "inspect",
  "title": "Inspect status",
  "summary": "Read a project status snapshot.",
  "risk": "read",
  "scope": "project",
  "capability": "projects:read",
  "route": { "method": "POST", "path": "/cli/inspect" },
  "inputSchema": {
    "type": "object",
    "properties": { "nodeId": { "type": "string" }, "projectId": { "type": "string" } },
    "required": ["nodeId", "projectId"], "additionalProperties": false
  },
  "outputSchema": {
    "type": "object",
    "properties": { "status": { "type": "string" } },
    "required": ["status"], "additionalProperties": false
  }
}
```

Declare the named core capability in `permissions.node.core`. The command does not grant the
worker any new core, filesystem, network, secret, or process permission. The Node owns the route
prefix `/v1/p/<pluginId>`; the descriptor names only `/cli/<name>`. Register that handler through
`ctx.routes.fetch` and return JSON. For example, a Node entry can register a handler with the same
path as the descriptor:

```js
export const examplePlugin = () => ({
  name: 'example',
  init(ctx) {
    ctx.routes.fetch(async (request) => {
      if (request.method !== 'POST' || new URL(request.url).pathname !== '/cli/inspect') {
        return new Response(null, { status: 404 })
      }
      const input = await request.json()
      return Response.json({ status: `Project ${input.projectId} is available` })
    }, { prefix: '' })
  },
})
```

The Node has already checked the paired device, `nodeId`, and project existence before this handler
runs. A real status command should read its status from a declared core service; this example only
shows route registration and JSON response shape. The loaded fetch carrier can register a broad route prefix,
so manifest activation proves the command path is confined but cannot prove the exact handler
exists. A missing handler fails at invocation. Use `validatePluginConfig` from
`@acorn/plugin-api/testkit` for a built package's configuration and exercise the handler against a
real Node route. `testCliCommandDescriptor` from that testkit supplies a fixture descriptor for
host tests; it does not validate an authored manifest.

Command names are stable lower-case kebab-case. Two commands in one manifest cannot share a name;
two plugins may both declare `inspect`. Input and output schemas use the bounded JSON Schema
subset accepted for plugin agent tools: object, array, scalar types, properties, required,
additionalProperties, enum, and basic length or numeric bounds. References and arbitrary
keywords are refused. The required scope ID (`nodeId` and, for non-node scopes, `workspaceId`,
`projectId`, or `taskId`) must be string fields in the input schema. Use
`additionalProperties: false` for exact inputs. Keep results below 256 KiB. Schema and scope
changes are a plugin compatibility change; keep a command name stable only when existing callers'
input still has the same meaning.

A write command has `risk: "write"`, a nonempty `effects` sentence displayed by help, and a
required idempotency key at the Node endpoint. The CLI sends one from `--request-id` or generates
one; a retry uses the same key and input. The ordinary device replay store provides the same
retry behavior as core writes. Do not expose destructive behavior through this generic seam.

For a complete read example, see the Database plugin's `query` descriptor and `/cli/query` handler.
It calls the existing `database.query` read-only service, not the pane's arbitrary SQL route, and
retains its 200-row cap. The CLI invocation is:

```sh
acorn plugin example inspect --input-file project.json --output json
```

`project.json` contains `{ "nodeId": "...", "projectId": "..." }` from the selected Node. A write
fixture in the Node plugin route tests shows keyed replay.
