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

## `plugin_authoring` — how to write one, from the node that will run it

The companion to `plugin_request`, and the piece the mechanics are useless without: the loop only works
if the agent is *taught* (`server/agentTools/pluginAuthoring.ts`, `read` tier). It takes no arguments and
answers with two halves — a markdown guide, and the same facts structured so a manifest can be checked
against them without parsing prose.

The rule it exists to enforce is **never answer a plugin API question from memory**. So everything in it
that an author gets wrong by remembering is *derived at call time* rather than written down: the manifest
key list, the cap on each contribution, the two closed action-verb sets, the frame targets, the host slots
and the command categories all come out of `z.toJSONSchema(pluginManifestShape)`; the `permissions.node`
blocks come from the same schema and its `core` facet list from `main/pluginPermissions.ts`; and the frame
bridge's message kinds, `ui` ops, document ops, webview ops and HTTP methods are read off the wire union
in `@acorn/protocol/pluginBridge.ts` through `satisfies`, so a new message kind is a **compile** error in
this module rather than a silent omission from the guide. What is left hand-written is process — the
sequence of acts, which no schema states — and `pluginAuthoring.test.ts` re-derives every list and asserts
it reached the rendered text.

Two things it deliberately does not carry. The `@acorn/plugin-api` export list: a hand-written plugin
cannot import that package at all, and a packaged node has no copy of `surface.snapshot.txt` to read — the
snapshot has its own drift gate and is the answer for a plugin that *is* built. And the grantable
`permissions.api` scope names: that allowlist lives in the client and the node cannot import it, so a list
here would be a copy, and a wrong scope name in a guide the agent believes is worse than none.

The same text is also a **context section** (`plugin-authoring`, `defaultIncluded: false`). That flag is
the whole affordability argument: a task that is not writing a plugin never assembles it and pays nothing,
while a human who *is* can tick "Plugin authoring" in the composer's context picker, or an agent can ask
for it with `task_context { include: 'plugin-authoring' }`. bb's equivalent is 1,678 lines carried by
every session because it has no such dial.

## `plugin_request` — asking for a change to acorn itself

One core tool sits apart from the rest, and it is worth reading before adding anything like it. It lets an
agent ask the owner to install, update or remove a plugin on this node
(`server/agentTools/pluginRequests.ts`, `execute` tier, never projected to the renderer). It is the only
tool whose subject is which code the node runs.

It installs nothing. It writes a row in an in-memory queue, broadcasts a content-free notice, and throws
`needs-trust` (409) with a sentence telling the agent to call again with the same arguments to collect the
owner's answer. The owner answers in the shell; **the device** then performs the install over the
device-gated `/v2/core/plugins/*` routes with its own principal. Prompt injection is a named threat, so an
agent must never hold a credential that can install code, and the defence here is structural: that module
imports no installer, no data root and no filesystem, and a test pins its import list so a future
convenience import fails the build rather than the boundary.

Only the first raise of a given request rings the bell, twenty outstanding requests is the cap, and
collecting a decision spends the row — so a second identical call is a new question, not a second use of
an old yes. The agent's `reason` string is capped and rendered as text; it explains the request and is not
evidence for it. Full flow in [plugins.md § Approval-mediated install](./plugins.md).

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
