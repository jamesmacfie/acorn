# What the panel studio programme won't build

Status: decided, October 5, 2026. Each item says why, and what would make it worth revisiting. Read
the [programme README](./README.md) first.

## A route for the studio

The studio is a full-window layer. A route would unmount a task's panes, plugin frames, and terminal
drawer when a panel is edited from a task pane aside, because the renderer draws from
`selectedSource()` and the active task, not the URL. Revisit if routes start owning what's on screen.

## Preview of the rows after one step

Showing the rows that come out of step 2 would make long plans easy to debug. The run returns only
final rows and per-step counts (`PlanStageCount` in `packages/dashboards-core/src/plan.ts`), so this
needs a Node change and a larger response. Revisit when people building multi-step panels ask for
it.

## A Graph tab

Workflows has **Outline**, **Graph**, and **Code**. A panel plan is a straight line of steps, and
relations between sources are rare. The outline already shows the order. Revisit if multi-source
panels with relations become common.

## An editable Plan tab

The **Plan** tab is read-only. Editing JSON bypasses the forms' guarantees and the label map, and the
AI already covers changes the forms can't make. Revisit if power users ask for it more than once.

## Hidden columns

The review's mockup showed a tick to show or hide a column. The plan has no hidden-column flag, and
adding one changes the schema and published digests. Removing a column does the same job.

## Stage ids

Adding ids to stages would make diffs exact. It would also change the persisted plan and every
published digest. The two-pass match in [phase 2](./02-plan-outline-model.md) is good enough for
review.

## Dismissable requirement warnings

Warnings for partly covered requirements show in the status bar and the publish review until a new
proposal replaces them. Storing dismissals adds state for little value. Revisit if people find the
warning noisy.

## Undo for quick edits

Each quick edit is a published revision. **Edit…** can change it back.

## Docking the AI in Workflows

[Phase 6](./06-docked-ai.md) builds the docked layout so Workflows can use it, but moving Workflows
needs its own outline diff. That's a separate change for the Workflows owner.

## A dashboard tool for coding agents

Agents in a task can read data sources and write datasets, but can't create panels. A
`dashboard_propose` tool that saves an unpublished draft for the launcher's "Unfinished" list would
fit this design. It isn't part of the editor work. Revisit after phase 6, when the review flow it
would feed exists.

## Discovered sources as inputs

An input names a statically registered source, such as `github:pull-requests`. Sources a plugin
discovers at run time, per scope, can't be inputs, because the approval dialog has to name the input
before any code runs. Revisit if a plugin needs to read a discovered source and can name the
discovery up front.

## Write-back through a derived source

Dragging a card from Blocked to Ready on a derived source means nothing upstream. Write-back stays
with the source that owns the record, and input handles have no write or action path. Revisit when a
plugin can name exactly which upstream field and value a choice maps to.

## Derived sources deeper than two levels

A derived source may read another derived source, two levels deep at most, and never in a loop.
Deeper chains make budgets and failure messages hard to explain. Revisit with a real case.

## A dashboard step that runs plugin code

Custom logic could have been a plugin-provided panel step instead of a source. That would put plugin
code inside the Node's plan runner and the history sampler, and break the closed set the editor and
the AI rely on. A derived source gives the same power at the boundary Acorn already enforces.

## Opening Settings from a loaded plugin

Loaded plugins can't open Settings, and this programme doesn't add a bridge verb for it. Acorn draws
every **Connect…**, **Reconnect…**, and **Review** button itself. Revisit if a plugin needs Settings
for something the host can't anticipate.
