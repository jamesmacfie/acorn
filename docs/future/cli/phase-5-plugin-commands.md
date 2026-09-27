# Phase 5: typed commands from loaded plugins

Status: proposed implementation handoff, 2026-09-27. Depends on the core CLI contract in Phases 1
through 4. This is a proposed contribution kind, not an existing plugin API.

## Outcome and rationale

An active third-party plugin can declare a command under `acorn plugin PLUGIN_ID COMMAND`. The CLI
discovers its descriptor from the selected Node, validates structured input, invokes that plugin's
owned Node route as the paired device, and projects structured output. This uses the same active
plugin selection, trust, worker permissions, and route ownership as other Node plugin operations.

The existing client command palette is for navigation and host interaction. Many entries open panes
or rely on a selected row, modal, or surface action. Agent MCP tools run under a task principal with
tool grants. Workflow step kinds run with workflow context. None is an appropriate generic mapping
to a shell command. `cliCommands` should be a separate declarative contribution with its own
input/output contract and policy review.

## Proposed descriptor and dispatch

A manifest contribution should describe a stable command name, title, summary, input schema,
output schema, risk class (`read` or `write`), accepted scope (`node`, `workspace`, `project`, or
`task` as appropriate), required plugin capability, and a plugin-owned route reference. The host
must validate names, schema size/depth, route ownership, collisions, and declared permissions at
activation. The executable handler stays in the plugin's Node worker and is reached only through
its `/v1/p/<id>` namespace with normal device auth. The host does not grant extra filesystem,
network, secret, or database permissions because a command exists.

An illustrative shape, to refine against the real manifest types:

```json
{
  "cliCommands": [{
    "name": "search",
    "title": "Search memory",
    "summary": "Find saved memory by text",
    "risk": "read",
    "scope": "project",
    "inputSchema": { "type": "object", "required": ["projectId", "query"] },
    "outputSchema": { "type": "object", "required": ["matches"] },
    "route": { "method": "POST", "path": "/cli/search" }
  ]
}
```

This JSON is design notation, not a current valid manifest. Keep the route relative and prevent a
plugin from naming core or another plugin's route. A read-risk command may use POST for structured
input but must be side-effect-free; risk class is a truthful declaration that tests and review can
check, not an authorization mechanism on its own. A write-risk command requires an idempotency key
and explicit help text describing effects. A destructive command should require a more specific
host policy before this general seam exposes it.

## Work to deliver

1. Extend the manifest validator, plugin API type, activation record, and contribution registry.
   Decide whether command descriptors are static manifest data or served through a versioned
   authenticated discovery route. Prefer static metadata for offline validation and consistent
   help; if active configuration changes availability, expose that as a separate live status.
   Installed-but-inactive plugins do not contribute runnable commands.
2. Add `plugin list`, `plugin ID commands`, and `plugin ID COMMAND --help`. Names are lower-case,
   stable, and scoped to a plugin ID, so two plugins can both declare `search`. Built-in verbs never
   collide with plugin commands. On plugin disable/reload, a command disappears or reports
   unavailable immediately; no stale executable registration persists in the CLI process.
3. Provide `--input-file PATH|-` as the universal structured input, with optional generated flags
   only for scalar schema fields that have unambiguous types. Preserve JSON types, reject unknown
   fields when the schema does, cap input size, and print schema errors with field paths. Output
   follows the CLI's versioned JSON and JSONL conventions. Reject a handler response that fails
   its declared schema; do not emit half a JSON resource to stdout.
4. Verify the invoking device's normal access to the plugin route and the descriptor's required
   scope. A typed `Workspace`, `Project`, or `Task` input must match the selected `nodeId` and
   authorized resource. Recheck scope on the Node; CLI-side validation is for usability, not trust.
   Keep secrets in custody and existing connection services. A plugin command cannot ask the CLI
   to forward raw bearer tokens or bypass worker permissions.
5. Migrate one first-party read command as proof, then one write command in a safe fixture plugin.
   Memory search is a candidate read path. The database plugin's bounded read-only query service
   is a second candidate; it is distinct from the pane's arbitrary SQL editor and must retain its
   read-only transaction and row cap. Treat either as an example only after checking current routes
   and permissions. Publish authoring docs, schema examples, versioning rules, and a testkit case.

## Example use

```sh
acorn plugin memory commands --output json
acorn plugin memory search --input-file memory-search.json --output json
acorn plugin database query --input-file query.json --output json
```

Do not implement PATH-discovered `acorn-foo` executables in this phase. Those cannot be enumerated
from the active Node, validated against plugin scope, or kept within the Node worker's declared
permissions. A future local-only helper mechanism would need a different trust and versioning
contract. Also do not expose a raw `acorn api METHOD PATH` as the plugin interface; it would turn
the CLI into an unreviewed proxy around capability and output contracts.

## Tests and acceptance

- A test plugin declares one read and one write command. Activation validates the schemas and
  route paths. The commands appear only while that plugin is active on the selected Node; a
  second Node with a different active version yields its own help and availability.
- Inputs with wrong types, unknown fields, excessive size, wrong `nodeId`, or missing scope fail
  before dispatch where possible and always at the Node boundary. A malicious route reference or
  duplicate command name fails activation. A handler response violating its output schema yields
  a structured error and no partial stdout.
- Worker permissions remain unchanged. A command cannot reach another plugin's route, read an
  undeclared secret, access a forbidden network target, or turn a task principal into a device
  principal. The write command reuses an idempotency key on retry.
- Memory and database examples are documented from their actual loaded routes. Database read
  refuses write SQL and preserves the service's row limit. A third-party author can implement a
  read command using only the authoring guide and testkit.

## Verify before building

- Read `packages/node-core/src/server/plugins/manifest.ts`, the plugin activation and route
  mounting code, `packages/plugin-api/src/node.ts`, and
  [plugin authoring](../../plugin-authoring.md) before fixing the descriptor shape.
- Read [plugin map](../../plugin-map.md), [package shape](../../plugins/package-shape.md),
  [contribution kinds](../../contribution-kinds.md), and [security](../../security.md).
- Inspect actual memory and database service routes before using either example. After
  implementation run `pnpm lint`, plugin validator and isolation tests, and the cases in
  [verification](./verification.md).
