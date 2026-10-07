# Agent tools

Agent tools are Node-owned capabilities that agents call through MCP and the renderer calls through
HTTP. Read this page for the contribution type, the shipped tools, permissions, and the topic pages.
The registry and schemas are in `packages/node-core/src/server/agentTools/`, and each plugin keeps
its tools beside the feature they operate.

## Contribution

```ts
type AgentToolContribution = {
  name: string
  description: string
  risk: 'read' | 'write' | 'execute'
  input: ZodSchema
  requiresSession?: boolean
  execute(input, context): Promise<unknown>
}
```

The full type carries more metadata for rendering, permissions, and task context. A contribution
validates input again when it runs, and uses `CoreServices` for files, Git, processes, secrets, and
task lookup. To add a tool, add the contribution to the owning plugin, register it through
`ctx.tools.register` in the plugin's Node entry, add protocol and client rendering metadata if it
needs any, and test it through the real `createApp()` route and the MCP projection.

## Shipped tools

The registry is the authority on this list. These tools ship:

| Owner | Tools |
| --- | --- |
| Core | `task_current`, `task_context`, `repo_info`, `linked_issues`, `issue_detail`, `issue_comment`, `issue_image`, `pr_current`, `pr_changed_files`, `data_sources_list`, `data_sources_discover`, `data_source_describe`, `data_source_options`, `dataset_write`, `task_scripts_status`, `task_scripts_wait`, `task_scripts_logs`, `plugin_authoring`, `plugin_request` |
| `github` | `github_pull_create`, `pr_review_comments`, `pr_checks` |
| `changes` | `local_changes`, `local_diff`, `git_log` |
| `notes` | `notes_list`, `notes_read`, `notes_write`, `notes_append` |
| `memory` | `memory_list`, `memory_search`, `memory_get`, `memory_write`, `memory_delete` |
| `terminal` | `run_targets`, `run_status`, `run_start`, `run_stop`, `run_restart`, in tasks with run targets |
| `agents` | `agent_spawn`, `agent_prompt`, `agent_wait`, `agent_read`, `agent_cancel` |
| `browser` | `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_fill`, `browser_screenshot`, `browser_console` |

A loaded plugin adds tools named `<pluginId>_<id>` ([loaded tools](./agent-tools/loaded-tools.md)).
No tool drives a workflow, opens a database, or talks to Docker. [MCP](./mcp.md#tool-surface) says
why.

The four data source tools are read-only. The Node derives their workspace and project scope from the
task, and inputs can narrow the connection and source parameters but not substitute another task.
They return descriptors, schemas, or bounded option pages, and don't query records, return
credentials, or change provider state.

`dataset_write` is a write-risk core tool for agent-fed datasets. Its rows need evidence and a
reason. The Node derives workspace and project from the authenticated task and rejects other
datasets, stale schema versions, and malformed rows. A person can correct an agent row from a
published panel; that correction is stored separately and survives later feeder writes.

## Projections

The same registry is projected three ways:

1. `GET /v1/core/agent-tools`, for the Settings → Tools and permissions catalog. Each entry names its
   `owner`, a plugin ID or `core`. The page shows the three tiers first, then every tool grouped by
   owner or by tier.
2. `/v1/core/tasks/:id/tools` and `/v1/core/tasks/:id/tools/:name`, for the renderer.
3. The stdio MCP server, for a spawned agent.

The MCP server lists tools sorted by name, so reloading a plugin doesn't reorder a harness's tool list
and spoil its prompt cache. Every 10 seconds it compares the full definitions, including descriptions
and schemas, and sends `notifications/tools/list_changed` when any of them changes.

Renderer calls need a device principal. MCP calls need an internal principal whose token is bound to
the task. The Node applies the caller's scope, the task identity, and your per-tool permission before
it runs a tool.

## Permissions

Permissions have two layers, stored together as one prefs slice under `agentTools.perms`: a tier
default for `read`, `write`, and `execute`, and a per-tool override that wins over its tier. Turning a
tier off removes its tools from `tools/list` and rejects direct calls. Workflow and profile ceilings
apply after this and can only narrow.

A tier you've never touched falls back to `TOOL_TIER_DEFAULTS` in
`packages/protocol/src/agents/toolPermissions.ts`: `read` and `write` allowed, `execute` denied. So an
execute tool added in a later release stays off until you turn the tier on. The Node's
`isToolPermitted` and the Settings page read the same constant.

## Safety rules

- The Node validates tool input and every path and task ID at its boundary.
- A task-scoped caller can't address another task.
- Secrets are used through scoped provider APIs and never returned.
- Child processes use the process broker and bounded output.
- Agent text isn't control flow. Workflow gates read structured step output only.
- Tool failures use the common API error envelope and don't expose provider payloads or credentials.

## Pages

<a id="github"></a>
<a id="issuedetail"></a>
<a id="issuecomment-and-issueimage"></a>

- [Tracker and GitHub tools](./agent-tools/tracker-tools.md) covers `issue_detail`, `issue_comment`,
  `issue_image`, and the GitHub tools.

<a id="loaded-manifest-carriers"></a>

- [Loaded tools and context sections](./agent-tools/loaded-tools.md) covers the manifest form.

<a id="managed-session-orchestration"></a>

- [Managed-session orchestration](./agent-tools/orchestration.md) covers the `agent_*` tools.

<a id="context-sections"></a>
<a id="drawing-inside-a-section"></a>

- [Context sections](./agent-tools/context-sections.md) covers task context assembly and the route.

<a id="pluginauthoring"></a>
<a id="pluginrequest"></a>

- [Plugin tools](./agent-tools/plugin-tools.md) covers `plugin_authoring` and `plugin_request`.

<a id="browser-tools"></a>
<a id="task-script-tools"></a>

- [Browser and task script tools](./agent-tools/browser-and-scripts.md) covers the browser plugin and
  the setup and teardown tools.
