# Context sections

Task context is the bundle of pull request, issues, notes, and plugin sections an agent reads about
its task. This page covers how the Node assembles it, the rules a section follows, and the route that
serves it. The registry is in `packages/node-core/src/server/agentTools/contextSections.ts`.

## Context sections

Plugins register sections through the Node context-section registry. Each one declares its order, and
the registry sorts by it, so core keeps no list of plugin IDs. Core applies byte and token budgets,
records each section's status and freshness, and returns a deterministic snapshot. GitHub, notes,
Linear, Rollbar, and task sections are optional, and one failing section keeps its siblings.

The plugin that owns a section's rows also shapes it: `notes` is in `contextSection.ts` in its own
package. Core owns `pr`, which asks the code host that holds the task's primary change request for it
([code hosts](../plugins/code-hosts.md#agent-context)), so a GitLab task's merge request reads the same
way as a GitHub pull request. `@acorn/plugin-api/node` offers `truncateBytes` and `formatOmitted`, so a section's `format` applies
core's arithmetic, and core keeps the assembly, the order, and the 512 KiB budget. It also offers
`pastedContent`, which wraps text you didn't write in `<pasted_content>` tags that Claude Code's
system prompt explains. `pr` wraps the pull request body with it. The tag ID is a hash of the text,
because context is assembled again on every read and compared for changes.

The notes walk and budget also build the snapshot a delegated agent starts with, which doesn't go
through this registry. It applies the `notes` budget once across several tasks, and asks the
`core:before-snapshot` hook by assembling only the `notes` section. See
[notes in delegated agents](../notes-and-memory.md#notes-in-delegated-agents).

Core's own `issues` section registers at module scope. `pr` registers in `wireAgentTools`, with the
core tools, because it needs the Node's bindings to call a code host's routes.
`issues` and `task_links` are core tables ([external items](../data-layer.md)). GitHub and Rollbar
write them through the `ExternalItemStore` seam. Only core's sections read the database handle, so the
shared `PluginContextSection` contract withholds it from every plugin's section.

## Rules for a section

Orders are spaced by 10, so a section fits between two without renumbering. The order matters: every
prompt, the client's Manifest preview, and byte-exactness assume `pr`, `issues`, `notes` in that
sequence.

A section's `compact` text can't depend on which other sections ship with it. The client builds the
exact context block a send will produce from one `include=*` inventory, by filtering `ctx.sections`
and calling `formatContextBlock`. A section that reads sibling inclusion breaks that silently.

## The task context route

`GET /v1/core/tasks/:id/context` returns the task projection and the ordered `sections`
(`packages/node-core/src/server/routes/projects/taskContext.ts`). The renderer, the launch formatter,
agent tools, and MCP read section IDs and items. Core budgets each section's items and compact text
once, and reports omitted items and unavailable sources with that section. An explicit `include`
adds a section whose `defaultIncluded` is false, such as `plugin-authoring`.

The `task-scripts` section gives the setup and teardown states and how to find the
[task script tools](./browser-and-scripts.md#task-script-tools), without script bodies or logs.

The `issues` section ends with a line that names the [tracker tools](./tracker-tools.md) for the
providers linked to the task, and tells the agent it doesn't need a separate MCP server for them. An
agent sees only tool names until it searches, so without the line a Linear MCP server looks like the
way in. `trackerToolsHint` builds the line from the hooks each linked provider declares: `detail` for
`issue_detail`, `comment` for `issue_comment`, and `image` for `issue_image`. A new provider plugin
gets an accurate line without a change to core. A provider without `detail` isn't named at all.

## Drawing inside a section

A section the Node assembles is data. What the Context pane draws under it comes from the
`context:section` extension point, a `remote` point that stacks, keyed by section ID
([cooperative extension points](../plugins/cooperative-extension-points.md)). A compiled plugin
contributes a component, and a loaded plugin contributes a bundle entry that runs in a worker.

Memory uses standing session context instead of a section
([standing memory](../managed-agents/sessions.md#standing-memory)). Its tool card shows direct saves
with **Open** and **Undo**. `memory_get` returns a hash, and updating or deleting a memory needs that
hash ([memory](../notes-and-memory.md#memory)).
