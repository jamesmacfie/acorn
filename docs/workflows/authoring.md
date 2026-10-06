# Workflow authoring

This page covers the Workflows rail source, the editor, scheduling a published workflow, and child
workflow steps. The editor is in `plugins/workflows/src/client/editor/`. On the Node,
`plugins/workflows/src/server/authoring/` generates proposals, `definitions/` loads definitions,
`files/` writes repository and user files, and `publication/` records revisions.

## Authoring

Workflows is a source in the left rail, present in every workspace because nothing has to be
connected for a workspace to have one. Its list holds every definition the workspace can run, read as
one list from the three layers above, with the workspace's recent runs under it. Each row says how
many steps the definition has, which project it belongs to, and which layer it came from. A parse or
cycle error is a row of its own rather than a definition that is quietly missing.

**New workflow** on the list toolbar creates a row named "Untitled workflow", bound to the project
the rail is showing, and opens it. The same verb is a palette command, `workflows.new`.

### The editor

Picking a definition goes to `/p/:projectId/x/workflows/:id`, where `:id` is `db:<rowId>` for a row,
`repo:<fileId>` for a committed file, or `user:<fileId>` for one under `~/.acorn/workflows`. The
editor is drawn by the rail source's detail region, so the terminal client puts the definition
list in its Browse panel and the editor in the main one, and the editor's own node list and inspector
are a `list-detail` pair inside that. Every control is a kit node, so none of this is plugin code
either host had to be given.

The primary view is an outline with three kinds of row. **Definition** carries the workflow's name,
approvals, tool limit, limits, and budget. **Inputs** carries the values supplied when a run starts.
A step row is two lines: the name, then the kind's label, or a summary when the step has something
of its own to say (an If's condition, a For each's source, a Find records query). Branch labels sit
at the row's end. Roots appear in declaration order, followed by each step after the last
dependency. A row indents only where the graph forks: a branch target, or a step that waits on more
than one. **Add step** groups the catalog's kinds as **Ask AI**, **Records**, and **Flow**, then one
group per plugin under its name, each sorted by label.

The selected row opens its configuration under a header bar: the kind's icon, the step name with the
kind's description behind its help mark, the kind badge, and **Move up**, **Move down**, and
**Delete**. Moving reorders declarations without changing stable IDs or explicit edges. Deleting a
step that other steps use names them before the edit applies. A contextual preview lists the branch,
a gate's form fields, and the output fields later steps can read, by name. It does not run an agent
or invent sample output.

A required field shows its error after someone touches it, or after **Publish…** or **Run…** is
pressed. The footer lists the first problem, which selects its step, and a count of the rest.
**Graph** and **Code** are secondary views over the same definition and stable step IDs. They do not
maintain a separate graph model. Outline edits, binding changes, code edits, and generated proposals
share one undo and redo history.

The inspector draws whatever the list has selected. For a node that is its name, the steps it waits
on as removable chips with a picker beside them, the agent fields when the kind runs an agent, then
the kind's own fields in declared order. A prompt field carries a chip per declared input and per
step that is certain to have finished first, and pressing one appends the reference. A `decide` node
draws its branches as verdict-to-step rows. For each selects **Agent session** or **Child workflow**. Agent sessions show a prompt, harness,
model and reasoning options, and an **On failure** choice. Each receives its current item
automatically and runs in the parent folder. Child workflows show the saved target and typed
item bindings.
A **Wait for a person** node has a **Form** section: the inputs list for its fields, with a 20-field
cap, and a typed binding picker per field that chooses where the proposal comes from. Removing every
field makes it a plain gate again, and the step preview lists each field and where it is filled from
([execution](./execution.md#human-gates)).
A kind that ships no `describe` draws its `with` table as raw JSON and says so.

**Find records** uses the shared query editor. Adding **For each** from a Find records step creates
the dependency and preselects that step's records output as one undoable edit. For each bindings and
direct conditions use the shared typed field picker. Conditions expose field, comparison, and typed
value controls. Agent output uses a field list with nested object and list fields, types, and
requiredness. Raw pointers and JSON Schema remain available in **Code**, but the normal setup does
not require them. Session or task title templates, ordinary-array identity keys, and execution limits remain
under **Advanced** until validation requires them.

<a id="scheduling-a-published-workflow"></a>

[Scheduled roots](./scheduled-roots.md#schedule-a-published-workflow) covers **Schedule…**.

The agent fields are the editor's, not any kind's: the harness from the catalog's profiles, then one
select per option that harness advertises through `GET /v1/p/agents/providers`, then where the step
runs and what it does with its upstream outputs. A plugin contributing a kind that runs an agent
never restates the model list. These choices come from the harness's newest connected session. If
none has connected yet, open a session on that harness once, then reopen the workflow editor.

**Workflow timeout in minutes**, under Definition's Budget section, limits the whole run and its
child workflows. **Step timeout in minutes** limits active step execution, including agent loops and child
workflow dispatches. Both accept fractional minutes and store `budget.maxWallTimeMs` in the
definition, or `max_wall_time_ms` in TOML. A step timeout must fit within the workflow timeout.
Clearing a timeout removes that limit and preserves the other budget fields.
The workflow timeout governs time spent waiting for human approval.

Without either time budget, agent turns default to 10 minutes. Set a step timeout such as 30 minutes
to allow longer work without setting a deadline for the whole workflow. A workflow time budget
also supplies the agent turn timeout, and the run's remaining time can stop a step earlier.

### Child workflow authoring

Add **Run a workflow** to start one saved workflow, or **Map to workflows** to start one copy for
each item in a structured result. The child workflow picker lists database, repository, and user
definitions that the selected project can resolve. The catalog includes each target's declared
inputs and terminal output schemas. It omits definition bodies, input defaults, credentials, and
values from a run.

From a mapped step, **Create a workflow for this record** creates a child draft with one required,
typed `record` input. It binds the current record, saves the parent reference, and opens the child.
The parent link returns to the same selected step. Unpublished leaf drafts remain selectable in the
editor and carry a **draft** label; generation only receives published targets. Parent publication
reviews a required child draft with the parent rather than making either draft runnable early.

The inspector draws one binding for each declared child input. A binding can use fixed text, a
declared parent input, or a JSON Pointer into a structured predecessor. A mapped step can also use a
JSON Pointer into the item. Required child inputs without a saved default must have a binding.

This definition runs one saved child and passes through the parent's `ticket` input:

```json
{
  "name": "Review one ticket",
  "inputs": [{ "name": "ticket", "required": true }],
  "steps": [{
    "name": "review",
    "kind": "workflow",
    "childWorkflow": {
      "ref": { "source": "database", "id": "WORKFLOW_ID" },
      "inputs": { "ticket": { "from": "input", "name": "ticket" } }
    }
  }]
}
```

A mapped step names a structured predecessor, the pointer to its array, a stable item key, and a
title for each child task:

```json
{
  "name": "Review selected tickets",
  "steps": [
    {
      "name": "select",
      "after": [],
      "prompt": "Select the tickets to review.",
      "schema": {
        "type": "object",
        "properties": {
          "tickets": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "id": { "type": "string" },
                "number": { "type": "string" }
              }
            }
          }
        }
      }
    },
    {
      "name": "review",
      "kind": "workflow-map",
      "after": ["select"],
      "items": { "step": "select", "pointer": "/tickets" },
      "itemKey": "/id",
      "childWorkflow": {
        "ref": { "source": "repo", "path": ".acorn/workflows/review-ticket.toml" },
        "inputs": { "ticket": { "from": "item", "pointer": "/number" } }
      },
      "title": {
        "template": "Review ${ticket}",
        "bindings": { "ticket": { "from": "item", "pointer": "/number" } }
      }
    }
  ]
}
```

The editor preserves unavailable targets, unsupported bindings, and malformed pointers in the
draft, then reports each problem beside the field and in validation. Saving the draft does not make
it runnable. The start path validates and resolves every child before it creates a task.

Renaming a step preserves map sources, structured bindings, graph edges, and prompt references.
The JSON tab, TOML import and export, save-to-repository flow, undo, and redo use the same
child workflow contract.

<a id="generating-and-editing-with-ai"></a>

[AI authoring](./ai-authoring.md) covers generating and editing a workflow with a model.

<a id="the-draft-rules"></a>
<a id="the-graph-view"></a>
<a id="the-json-tab"></a>
<a id="saving"></a>
<a id="where-positions-live"></a>

[Editor details](./editor-details.md) covers the draft rules, the graph view, the JSON tab, saving, and
where positions live.
