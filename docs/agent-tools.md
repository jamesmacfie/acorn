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
| Core | `task_current`, `task_context`, `repo_info`, `linked_issues`, `issue_detail`, `issue_comment`, `issue_image`, `pr_current`, `pr_changed_files`, `pr_checks`, `pr_review_comments`, `pr_create`, `data_sources_list`, `data_sources_discover`, `data_source_describe`, `data_source_options`, `dataset_write`, `panel_guide`, `panel_show`, `task_scripts_status`, `task_scripts_wait`, `task_scripts_logs`, `plugin_authoring`, `plugin_request`, `run_script` |
| `github` | `github_pull_create`, the older name for `pr_create` |
| `git` | `local_changes`, `local_diff`, `git_log` |
| `notes` | `notes_list`, `notes_read`, `notes_write`, `notes_append` |
| `memory` | `memory_list`, `memory_search`, `memory_get`, `memory_write`, `memory_delete` |
| `terminal` | `run_targets`, `run_status`, `run_start`, `run_stop`, `run_restart`, in tasks with run targets |
| `agents` | `agent_spawn`, `agent_prompt`, `agent_wait`, `agent_read`, `agent_cancel`, `session_history_search`, `session_history_read`, `agent_session_list`, `agent_session_search`, `agent_session_read` |
| `browser` | `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_fill`, `browser_screenshot`, `browser_console` |
| `trellis` | `app_guide`, `app_create`, `app_read`, `app_write`, `app_patch`, `app_show`, `app_list` |
| `workflows` | `workflow_catalog`, `workflows_list`, `workflow_get`, `workflow_validate`, `workflow_draft`, `workflow_run`, `workflow_read`, `workflow_wait`, `workflow_cancel` |

A loaded plugin adds tools named `<pluginId>_<id>` ([loaded tools](./agent-tools/loaded-tools.md)).
No tool opens a database or talks to Docker. [MCP](./mcp.md#tool-surface) says why. An agent starts
a workflow only one the owner approved for agents
([workflow tools](./agent-tools/workflow-tools.md#invocation-authority)).

The four data source tools are read-only. The Node derives their workspace and project scope from the
task, and inputs can narrow the connection and source parameters but not substitute another task.
They return descriptors, schemas, or bounded option pages, and don't query records, return
credentials, or change provider state. `data_sources_list` also names the provider each source reads
through, and lists the person's accounts for those providers by ID, label, and status, which is the ID
a plan's `connectionId` takes.

`dataset_write` is a write-risk core tool for agent-fed datasets. Its rows need evidence and a
reason. The Node derives workspace and project from the authenticated task and rejects other
datasets, stale schema versions, and malformed rows. A person can correct an agent row from a
published panel; that correction is stored separately and survives later feeder writes.

## Panels

`panel_guide` and `panel_show` let a chat agent answer "graph me X" with a dashboard panel in the
conversation ([dashboards](./dashboards.md#panels-from-a-conversation)).

- `panel_guide` is read-only. It returns the plan instructions the panel studio's AI gets, which both
  read from `PANEL_AUTHORING_INSTRUCTIONS` in `packages/dashboards-core/src/panelGuide.ts`, so a change
  there changes both writers. It adds the task's workspace, the rules for plans that work on Home,
  advice on choosing a view, and two worked plans for the GitHub pull requests source.
- `panel_show` is write-risk, and takes a title, a draft plan, and the `panelId` of an earlier card when
  it revises one. It runs the check publication runs: each source is described and the plan validated
  against it, as the Node, with no records read. A plan with problems fails the call with every
  problem and its path into the plan, such as `/view/x: A bar chart needs an enum or person axis, or a text column the plan summarizes by.`, and
  draws nothing. A valid plan returns `{ panelId, shownAt, description }`, where `description` is the
  plan in plain words. It never returns records, and stores nothing: the plan lives in the call, and
  the card runs it.

A plan can't name the task it was made in. Context bindings resolve the viewer and the workspace's
linked items, never the task, so a plan the card draws is the plan a Home tab draws.

## Apps

Seven tools from the `trellis` plugin let a chat agent build an app: a program in OpenUI Lang over
dashboard plans, drawn in the conversation as a card ([agent-built apps](./agent-built-apps.md)).
Each one works only on the calling task's apps.

| Tool | Risk | What it does |
| --- | --- | --- |
| `app_guide` | read | Returns the library and language, generated by lang-core from the running library, the plan instructions `panel_guide` returns, and worked examples. It tells the agent to use `panel_show` for one view of one plan. |
| `app_create` | write | Creates an app in the task with a name, a description, and an empty program. Returns its ID and the program's hash. |
| `app_read` | read | Returns one working file, `program` or `plans/<name>`, with its hash. Without a file, lists the files. |
| `app_write` | write | Replaces one working file, or deletes a plan when `content` is null. Needs the file's hash when it exists. |
| `app_patch` | write | Merges statements into the program by name. A statement replaces the one with its name, a new name adds one, and `name = null` deletes one. Needs the program's hash. |
| `app_show` | write | Runs the seven checks, publishes the next revision with a one-line note, and returns `{ appId, name, revision }`. A failure lists every problem with its code, path, and hint, and publishes nothing. |
| `app_list` | read | Lists the task's apps with their IDs and head revisions. A draft names its project app and the project revision it started from in `draftOf`. |

## Scripts

`run_script` runs a short JavaScript program that calls other tools, so an agent pays one round trip
for many calls and gets back only what the program returns. The program calls a tool as
`await tools.<name>(input)` and gives its answer with `return`. The result is
`{ ok, value, logs, calls }`, or `{ ok: false, error, logs, calls }` with the message and line.
`calls` names each tool the program called and its outcome, and the transcript card lists them.

Every call from a program passes the same checks as a direct call, in the same order:
`callAgentTool` in `packages/node-core/src/server/agentTools/callTool.ts` serves both the route and
the program. A refused call throws inside the program. A program can't call `run_script`, and each
inner call gets the call ID `<outer call ID>:<n>`, so a retried script repeats the same IDs.

A program reaches read-tier tools only, the tier of `run_script` itself. A harness asks the person
about a write or execute call by the tool's name, and so does an `agents:before-tool` policy. Inside a
script they would see only `run_script`, so those calls go to the harness one at a time. The same
holds for a harness rule or hook policy that names one read tool: it doesn't see that tool inside a
script. To stop a read tool everywhere, switch it off in **Tools and permissions**, or switch off
`run_script` itself.

The program runs in QuickJS, compiled to WebAssembly, with no file, network, timer, or process
access. Values cross as JSON copies. Each program gets a fresh engine, with these limits from
`SCRIPT_LIMITS` in `runScript.ts`: 120 seconds, 50 tool calls, 32 MiB of memory, and 32,768
characters of logs. The engine runs on the Node's event loop, so the program's own JavaScript gets
1 second in total. Time spent waiting on a tool call doesn't count. The program's text is at most 20,000 characters. Cancelling the outer call stops
the program and aborts its pending calls. Read the QuickJS changelog before you change its pinned
version, because a bug in the engine is a bug in this boundary.

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

Security diagnostics reads the registered name and risk catalog through core's narrow `agentTools`
service, then applies the stored preference. It shows only catalogued
tool names; a stale preference key cannot introduce a tool into the report.

## Safety rules

- The Node validates tool input and every path and task ID at its boundary.
- A task-scoped caller can't address another task.
- Secrets are used through scoped provider APIs and never returned.
- Child processes use the process broker and bounded output.
- The MCP server caps every result an agent receives ([tool result size](./mcp/result-size.md)), so a
  tool doesn't need its own cap for safety. Bound or page a tool's output only when that makes it more
  useful, such as when the middle of a long result matters.
- Agent text isn't control flow. Workflow gates read structured step output only.
- Tool failures use the common API error envelope and don't expose provider payloads or credentials.

## Pages

- [Tracker and GitHub tools](./agent-tools/tracker-tools.md) covers `issue_detail`, `issue_comment`,
  `issue_image`, and the GitHub tools.

- [Loaded tools and context sections](./agent-tools/loaded-tools.md) covers the manifest form.

- [Managed-session orchestration](./agent-tools/orchestration.md) covers the `agent_*` tools.

- [Cross-session reads](./managed-agents/cross-session-reads.md) covers `agent_session_list`,
  `agent_session_search`, and `agent_session_read`.

- [Context sections](./agent-tools/context-sections.md) covers task context assembly and the route.

- [Plugin tools](./agent-tools/plugin-tools.md) covers `plugin_authoring` and `plugin_request`.

- [Workflow tools](./agent-tools/workflow-tools.md) covers discovery, agent drafts, the owner's
  invocation approval, and run reads, waits, and cancellation.

- [Browser and task script tools](./agent-tools/browser-and-scripts.md) covers the browser plugin and
  the setup and teardown tools.
