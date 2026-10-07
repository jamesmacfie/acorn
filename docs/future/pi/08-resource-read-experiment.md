# Phase 08: resource-read experiment

Status: proposed, 2026-10-03. Entry: phase 07 accepted. Next:
[phase 09](./09-session-reach.md).

## Outcome

Paired measurements establish whether read resources reduce first-turn context without reducing task
completion. The result either retains an off-by-default experiment or removes it. This phase does
not authorize replacing the normal tool surface.

## Design

The design as proposed on 2026-10-02. The implementation steps below refine it and win where they differ.

### Why

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

### What MCP already offers

MCP has resources: a server lists URI templates, and a client reads a URI. Claude Code exposes MCP
resources to the model through its own list and read tools, and Codex has equivalents. So acorn would
not need a new tool or a new protocol. It would add resource templates to the library server at
`packages/node-core/src/mcp/server.ts`, launched by the thin `apps/node/src/entries/mcp.ts`
entrypoint, and route each read to the same handler the matching tool uses.

### The shape

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

### The experiment

1. Add the templates beside the tools, behind a node setting that is off by default.
2. Pick 10 tasks from real use that each need two or more of the read tools.
3. Run each task on Claude and Codex three ways: tools only, tools plus resources, and resources plus
   write tools only (the read tools hidden from `tools/list` for that run).
4. Record per run: context tokens at the first turn, the number of failed or repeated read calls, and
   whether the task finished.

**Stop rule.** If resources-only does not save at least 15% of first-turn context, or loses any task
the tools-only run finished, delete the templates and record the numbers in this file. If it passes on
both harnesses, propose hiding the read tools behind the setting as a separate change.

### What this does not do

- It does not change what any plugin contributes. A loaded plugin's agent tools stay tools.
- It does not help harnesses that do not expose MCP resources to the model. Check `omp` and DeepSeek
  before counting them.

## Ownership and data flow

Agent resource request → thin stdio MCP transport → task-authenticated Node tool route → existing
registered handler and tool ceiling → bounded MCP resource content. One domain implementation and
one authorization path serve tools and resource aliases.

The executable at `apps/node/src/entries/mcp.ts` delegates to
`packages/node-core/src/mcp/server.ts`. Change the library transport, not the thin executable.
Read that server, `mcp/api.ts`, the task tool manifest/invocation routes, risk tiers, and signed
session ceiling. The live registry, not the comparison's count of 26 readers, defines eligibility.

## Implementation

1. Inspect Claude and Codex resource behavior with a minimal fixture before building aliases.
   Prove the model can discover and read resources on its own, without a person mentioning a URI.
   Record unavailable client support as a failed experiment precondition rather than manufacturing
   a new Acorn read tool to change the comparison.
2. Build a bounded alias catalogue for the design's implemented readers. Confirm each
   target is read-only, registered, available to the addressed task, and admitted by its tool ceiling.
   Advertise no resources outside a task and none for disabled/unavailable plugins. Re-resolve live
   availability and permission changes; an advertised URI never grants authorization by itself.
3. Add MCP resource templates/read handlers through the existing SDK. Decode parameters once,
   validate schemes and lengths, and translate to existing handler inputs. Preserve the same
   `before-tool-call` policy, principal, path validation, response bounds, and error semantics by
   invoking the existing Node route. No second domain handler or generic filesystem resolver.
4. Validate URI attempts involving another task, session, provider item, traversal, malformed
   escaping, or encoded separators at the same domain boundary as tools. Treat an URI as an alias,
   not proof of access. Keep writes, search, and nested result selectors outside the resource set.
5. Use a Node-held experiment mode, default `off`, with `tools-and-resources` and
   `resources-and-write-tools` variants. Freeze a mode for each measured session/process start.
   Hiding read tools changes discovery only; retained resource invocation still checks the signed
   ceiling. Do not turn experimental hiding into a global production removal of read tools.
6. Freeze 10 real task definitions and starting fixtures. Each needs at least two eligible reads.
   Run each on Claude and Codex in all three modes, with matched model/options, plugin roster,
   context, skill/advisor settings, and clean starting state. That is 60 runs for one paired pass.
   Use task completion criteria written before running. Do not use real outbound writes as benchmark
   side effects when fixtures or an isolated project can supply the same behavior.
7. Capture actual first-turn context tokens, completed outcome, failed/repeated reads, run settings,
   and protocol evidence. Treat unavailable token reporting as a measurement blocker. Compute
   savings against each harness's tools-only baseline, show per-task values and the aggregate, and
   rerun only ambiguous/failing comparisons whose outcome may be stochastic.
8. Apply the original stop rule per harness: resources-only must save at least 15% of aggregate
   measured first-turn context and lose no task completed by its paired tools-only run. If either
   harness fails, remove aliases and experimental modes and keep the evidence here. If both pass,
   retain the implementation off by default and propose a separate decision to change the default.

Do not expose additional plugin contribution formats, query selectors, generic URI writes, or a
new resource policy that bypasses agent-tool authorization.

## Verification and acceptance

Apply [shared verification](./README.md#verification-for-every-phase). Focus MCP/route tests on
authorization parity, mode isolation, disappearing readers, URI validation, and content conversion.
Check missing task identity, wrong task/session, restricted tool ceiling, disabled plugins, denied
tool hooks, and unavailable Node behavior through an actual MCP process.

Acceptance is a versioned benchmark table with reproducible fixtures and a clear pass/remove result.
For a removal outcome, rerun focused MCP tests to show ordinary tool discovery and calls remain
intact. A subjective report that resource reads feel simpler is insufficient.

## Documentation and handoff

Update [MCP](../../mcp.md) and [agent tools](../../agent-tools.md) only for retained implemented
behavior. Keep experimental measurements and the disposition in this file. Supply phase 11 with the benchmark artifacts,
configuration revision, and any code-removal revision.

## Verify before building

Recount eligible tools, inspect SDK resource support and both clients' model access, confirm
first-turn token reporting, and trace the existing tools route's principal/hook checks. Verify the
experiment mode cannot be supplied by a task principal to widen its own signed tool ceiling.

From the design:

- The tool list on a node with the default plugins, which decides the real count above.
- Whether Claude Code and Codex let the model read MCP resources on its own, or only when the person
  mentions one.
- How `packages/node-core/src/mcp/server.ts` builds `tools/list`, and where resource handlers would sit beside it.
