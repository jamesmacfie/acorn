# Agent tools

Agent tools are Node-owned capabilities projected to the renderer and to task-scoped MCP clients.
The registry and schemas live in `packages/node-core/src/server/agentTools/` and plugin contributions
live beside the feature they operate.

## Contribution

```ts
type AgentToolContribution = {
  name: string
  description: string
  risk: 'read' | 'write' | 'execute'
  input: ZodSchema
  execute(input, context): Promise<unknown>
}
```

The exact type has additional metadata for rendering, permissions, and task context. A contribution
must validate input again at execution time and use CoreServices for files, Git, processes, secrets,
and task lookup.

Current tool groups include task/context inspection, Git and changes, notes, memory, terminal
handoff, workflow controls, database operations, Docker, and preview/browser operations.

## Projections

The same registry is projected into:

1. `GET /v2/core/agent-tools` for the Settings → Agent tools catalog;
2. `/v2/core/tasks/:id/tools` and `/v2/core/tasks/:id/tools/:name` for the renderer;
3. the stdio MCP server for a spawned agent.

Renderer calls require a device principal. MCP calls require an internal principal whose token is
bound to the task. The Node applies the caller scope, task identity, and the owner's per-tool
permission preference before executing.

## Context sections

Plugins register context sections through the Node context-section registry. Each contribution declares
its wire order; the registry sorts by that value rather than maintaining a core-owned list of plugin
IDs. Core applies byte/token budgets, records section status/freshness, and returns a deterministic
snapshot. GitHub, notes, memory, Linear, Rollbar, and task sections are optional contributions; one
failing section does not discard its siblings.

`sections` is the canonical context representation used by the renderer and MCP context formatter.
The response also retains the top-level `pr`, `issues`, `notes`, and `memory` fields as a bounded
compatibility projection for existing task-context clients and agent tools. This is an intentional
wire-compatibility adapter, not a second assembly path: both views are produced from the same
contribution and budgeted in one pass. A future protocol-version migration can remove the projection
after those consumers move to `sections`.

## Safety rules

- Tool input and all path/task IDs are validated at the Node boundary.
- Task-scoped callers cannot address another task.
- Secrets are used through scoped provider APIs and never returned by a tool.
- Child processes use the process broker and bounded output.
- Agent text is not control flow. Workflow gates consume structured step output only.
- Tool failures use the common API error envelope and do not expose provider payloads or credentials.

## Adding a tool

Add the contribution to the owning plugin, register it in the Node plugin host, add the protocol/client
rendering metadata if needed, and test it through the real `createApp()` route and MCP projection.
