# 07. One read over many sources, as an experiment

Status: proposed, 2026-10-02. Not started. This is an experiment with a stop rule, not a plan to
replace acorn's tools.

Execution handoff, 2026-10-03: [phase 08](./phases/08-resource-read-experiment.md) owns protocol
preconditions, authorization parity, paired runs, and the retain/remove decision.

## Why

`omp` gives the model one `read` tool and treats everything as a path. `read pr://1428` returns a
pull request, `read issue://…` an issue, `read agent://<id>/findings.0.path` a field from a
subagent's result, and `grep` walks a diff like a directory. Its argument is that each extra tool is
another set of parameters the model must learn and the author must keep correct, while a path is
something every model already knows how to use.

Acorn's MCP server projects the agent-tool registry, and on a development node with the usual plugins
enabled that is 36 tools. About 26 of them only read: `task_current`, `task_context`, `pr_current`,
`pr_changed_files`, `pr_checks`, `pr_review_comments`, `linked_issues`, `issue_detail`, `issue_image`,
`repo_info`, `git_log`, `local_changes`, `local_diff`, `agent_read`, the `memory_*` and `notes_*`
readers, the `data_source*` readers, and `plugin_authoring`. Every one puts its schema in every
session's context, whether the session uses it or not.

The question is whether a resource read would cost less context and work at least as well. Nobody
has measured it for acorn, and the answer could easily be no: models are trained heavily on named
tools, and a resource template is less familiar.

## What MCP already offers

MCP has resources: a server lists URI templates, and a client reads a URI. Claude Code exposes MCP
resources to the model through its own list and read tools, and Codex has equivalents. So acorn would
not need a new tool or a new protocol. It would add resource templates to the library server at
`packages/node-core/src/mcp/server.ts`, launched by the thin `apps/node/src/entries/mcp.ts`
entrypoint, and route each read to the same handler the matching tool uses.

## The design

Map each read-only tool to one URI template, in the bare style `omp` uses:

| Template | Same handler as |
| --- | --- |
| `task://` | `task_current` |
| `task://context` | `task_context` |
| `pr://` | `pr_current` |
| `pr://files` | `pr_changed_files` |
| `pr://checks` | `pr_checks` |
| `pr://comments` | `pr_review_comments` |
| `issue://{kind}/{id}` | `issue_detail` |
| `changes://` | `local_changes` |
| `changes://{path}` | `local_diff` |
| `agent://{sessionId}` | `agent_read` |
| `memory://{name}` | `memory_get` |
| `notes://{kind}` | `notes_read` |

The templates don't carry Acorn's name. MCP clients already label each resource with the server it
came from, and `acorn://` is reserved for links that open the app. These addresses are relative to the
session's task, are only valid inside the MCP server, and are never links. `{kind}` in `issue://` is the
content-link kind that names the item everywhere else, such as `linear.issue`.

Rules:

- A resource read goes through the same route, principal, and tool ceiling as the tool. It is a second
  name for one handler, never a second implementation.
- Writes stay tools. `issue_comment`, `memory_write`, `notes_append`, and `agent_prompt` change things,
  and a write deserves a schema the model has to fill in.
- Search stays a tool. `memory_search` takes a query, which is not a path.
- No path selectors inside results, unlike `omp`'s `agent://<id>/findings.0.path`. That is a query
  language, and acorn refuses query languages in descriptors.

## The experiment

1. Add the templates beside the tools, behind a node setting that is off by default.
2. Pick 10 tasks from real use that each need two or more of the read tools.
3. Run each task on Claude and Codex three ways: tools only, tools plus resources, and resources plus
   write tools only (the read tools hidden from `tools/list` for that run).
4. Record per run: context tokens at the first turn, the number of failed or repeated read calls, and
   whether the task finished.

**Stop rule.** If resources-only does not save at least 15% of first-turn context, or loses any task
the tools-only run finished, delete the templates and record the numbers in this file. If it passes on
both harnesses, propose hiding the read tools behind the setting as a separate change.

## What this does not do

- It does not change what any plugin contributes. A loaded plugin's agent tools stay tools.
- It does not help harnesses that do not expose MCP resources to the model. Check `omp` and DeepSeek
  before counting them.

## Verify before building

- The tool list on a node with the default plugins, which decides the real count above.
- Whether Claude Code and Codex let the model read MCP resources on its own, or only when the person
  mentions one.
- How `packages/node-core/src/mcp/server.ts` builds `tools/list`, and where resource handlers would sit beside it.
