# Context sections

Task context is the bundle of pull request, issues, notes, and plugin sections an agent reads about
its task. This page covers how the Node assembles it, the rules a section follows, and the route that
serves it. The registry is in `packages/node-core/src/server/agentTools/contextSections.ts`.

## Context sections

Plugins register sections through the Node context-section registry. Each one declares its order, and
the registry sorts by it, so core keeps no list of plugin IDs. Core applies byte and token budgets,
records each section's status and freshness, and returns a deterministic snapshot. GitHub, notes,
Linear, Rollbar, and task sections are optional, and one failing section keeps its siblings.

The plugin that owns a section's rows also shapes it: `pr` is in
`plugins/github/src/server/contextSection.ts`, and `notes` is in the same file in its own package.
`@acorn/plugin-api/node` offers `truncateBytes` and `formatOmitted`, so a section's `format` applies
core's arithmetic, and core keeps the assembly, the order, and the 512 KiB budget. It also offers
`pastedContent`, which wraps text you didn't write in `<pasted_content>` tags that Claude Code's
system prompt explains. `pr` wraps the pull request body with it. The tag ID is a hash of the text,
because context is assembled again on every read and compared for changes.

Core's own `issues` section registers at module scope, not through `wireAgentTools`, because the
standalone Node (`pnpm dev:node`, and any Node paired over the LAN) doesn't call `wireAgentTools`.
`issues` and `task_links` are core tables ([external items](../data-layer.md)). GitHub and Rollbar
write them through the `ExternalItemStore` seam. `issues` is the only section that reads the database
handle, so the shared `PluginContextSection` contract withholds it from every other section.

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

## Drawing inside a section

A section the Node assembles is data. What the Context pane draws under it comes from the
`context:section` extension point, a `remote` point that stacks, keyed by section ID
([cooperative extension points](../plugins/cooperative-extension-points.md)). A compiled plugin
contributes a component, and a loaded plugin contributes a bundle entry that runs in a worker.

Memory uses standing session context instead of a section
([standing memory](../managed-agents/sessions.md#standing-memory)). Its tool card shows direct saves
with **Open** and **Undo**. `memory_get` returns a hash, and updating or deleting a memory needs that
hash ([memory](../notes-and-memory.md#memory)).
