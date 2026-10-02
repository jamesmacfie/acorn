# Workflow authoring

Part of [workflows.md](../workflows.md).

The Node's `plugins/workflows/src/server/authoring/` generates and grounds proposed definitions.
`definitions/` loads saved definitions, `files/` handles repository and user file writes, and
`publication/` records published revisions and drafts. The client editor stays under
`plugins/workflows/src/client/editor/`.

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
draws its branches as verdict-to-step rows. For each selects a child workflow and typed item bindings.
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
not require them. Task title templates, ordinary-array identity keys, and execution limits remain
under **Advanced** until validation requires them.

### Scheduling a published workflow

**Schedule…** appears only for a published database workflow. It opens one shared-kit editor on both
hosts; cadence, timezone, project, and typed input values are schedule setup, not fields on a normal
workflow draft. The first review shows three concrete future checks with their timezone offsets,
effective execution limits, and whether the first check processes current matches or establishes a
baseline from now.

Record repeat handling appears only for `workflow-map` loops. **Run again when these fields change**
uses the same typed field picker as authoring. **Since the last completed check** appears only when
the source declares incremental continuation and the query feeds one unambiguous loop. Saving stores
a disabled Node draft; activation is a separate device-only action and is never queued while offline.

The workflows list gives schedules their own section and labels Active, Paused, Needs review, or
Unavailable. A changed published dependency retains the prior approved snapshot and processing
history, pauses admission, and links back to both activation review and the published workflow.
**Start fresh** is folded under advanced review and names the consequence that matching records may
run again. Pause stops future checks, **Run now** still works while paused, an active run opens its run
surface for cancellation, and deletion retains run and processing history.

The agent fields are the editor's, not any kind's: the harness from the catalog's profiles, then one
select per option that harness advertises through `GET /v1/p/agents/providers`, then where the step
runs and what it does with its upstream outputs. A plugin contributing a kind that runs an agent
never restates the model list.

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

### Generating and editing with AI

**AI authoring** opens a bounded conversation in a dialog over the workflow draft. Closing the dialog
keeps the conversation on the device, and opening it again picks up the same thread. Each turn can request
allowlisted source metadata, dynamic source discovery, option IDs, or compatible child workflows;
ask an inline clarification; or return a proposal. API-backed model connections and text-only agent
harnesses use the same JSON response protocol over the existing `generateText` service.

The conversation stores pending context, clarifications, and proposals in device-local recovery
state keyed by Node and workflow. Source records stay out of the prompt unless the user enables
**Use preview records to help AI**. An enabled sample contains at most three selected records and
16 KiB. Cancellation keeps the draft unchanged, and each result reports model request and token use.

A proposal shows a semantic diff before it can change the draft. Applying it reconciles a stale
base against the current definition by stable step ID, refuses conflicts, and runs the workflow
validator again. One accepted proposal creates one undo entry. Rejecting it changes nothing. The
conversation cannot save, publish, run, activate, change a provider, or read credentials.

#### Legacy one-shot endpoint

The device-only `/defs/generate` route remains for compatibility with callers of the earlier
one-shot generation contract. The workflow editor uses `/defs/authoring/turn` for interactive AI
editing.

The edit projection removes provider choices, configured execution targets, tool allowlists,
triggers, and the `headers` and `auth` fields of contributed step configuration from each step. The
scoped catalog separately lists the child targets that the model may use on a new step. After the
answer is grounded, the server restores protected values onto each surviving step with the same name
and kind. Deleting, renaming, or changing the kind of a step deliberately breaks that identity and
does not carry its protected configuration onto the replacement.

What the model is told about acorn is assembled at request time, not written down. The step kinds
with the fields each one describes, the policies and the agent profiles all come out of the same
catalog `GET /v1/p/workflows/catalog` answers, so a plugin that contributes a step kind makes it
available to the model with no prompt to edit here. That list is also the list the answer is checked
against: a kind in the catalog but missing from the prompt would be one the model can never use and
nothing would ever strip. The workspace's own definitions ride along as worked examples, ranked so
that one with a step waiting on two others comes first, because a fan-in is the thing a model gets
wrong on its own. The definition being edited is left out of its own examples, and so is any
definition that does not itself pass the checker: a workspace's broken workflow is the wrong thing to
learn house style from.

`plugins/workflows/src/server/authoring/generate.ts` is the prompt API. Its private `generate/`
modules own the fixed teaching text, catalog rendering, example selection, and prompt assembly.
`generationRequest.ts` makes the model calls, and `ground.ts` checks the reply against the same
forbidden-key list used by kind rendering. A prompt digest test pins the complete system, edit, and
repair text because whitespace and section order affect model behavior and provider cache keys.

Generation also receives the selected project's bounded child workflow catalog. It contains the
same references, input signatures, and output schemas that the child workflow picker uses. Grounding
removes a reference outside that catalog, an input binding the target does not declare, and a source
that is not a structured predecessor. If the catalog is empty, the prompt forbids both child
workflow kinds.

The server does not silently restore a changed child target. Both the conversation and compatibility
route keep only references in the scoped child catalog, and the conversation exposes a target change
in the semantic diff for review.

The reply is read back rather than trusted. Anything named in it that this node does not have is
taken out before the draft is touched. An invented step kind becomes a plain agent step keeping its
prompt, rather than a deleted step, because deleting one cascades through every `after` and `branches`
target that names it. An invented policy loses its value and stays a policy gate, because
retargeting it to a human gate would silently turn a hard check into a no-op under an autonomous
posture. A generated gate form that would not load is dropped and the gate is kept, never the other
way round, so a bad answer still stops for a person. An unknown `with` key goes, while the step's stable ID keeps every reference intact when its
display name changes. Each grounding change is reported in a dismissible alert above the node list,
because a list of things that were changed is not something to read in a toast. What the definition
still gets wrong is not repeated there: the footer already draws it.

There is one repair pass and never two. When the first answer passes the checker, which is the common
case, that is the only model call. When it does not, the checker's own messages go back once,
verbatim, along with the definition as it stands after the stripping, and the second answer is taken
if it parses and has at least one step. It is never chosen on having fewer problems, because the
cheapest way for a model to shorten a problem list is to delete the steps carrying the problems. The
answer is applied either way. A definition with problems in the footer is every workflow partway
through being built, and **Run** is what refuses to start one. The alert above the node list
describes the answer that was applied and only that one. When the repair is the one kept, a note
about the first draft would be about a definition nobody ever sees.

The AI authoring button is not drawn when the owner has nothing to generate with, meaning no
model provider connected and no agent CLI installed either
([integrations.md](../integrations.md) § Model providers), on the rule the commit-message wand
follows: a control whose only message is "connect one first" is a control in the way of the ones
beside it, and Settings, under AI models, is where a key is added. Repository file drafts
use the same conversation and keep their separate review-before-publication flow.

One submitted instruction can make at most eight metadata requests and two candidate attempts. The
client uses an 11-minute broker timeout for the bounded sequence and exposes **Cancel** while it runs
([api-reference.md](../api-reference.md) § Transport).

### The draft rules

These are why the editor is safe to type in:

- A new node takes one edge from the selected node, or none when nothing is selected. It is never
  inserted between two nodes, so adding a step changes nothing about what an existing step waits on.
- Deleting a node removes every edge that touched it and never bridges its predecessor to its
  successor. A chain that loses its middle becomes two roots, which is visible.
- Renaming changes only the display name. `${steps.<id>.output}`, every `after` entry, branch target,
  binding, and graph position continue to use the stable ID. The field accepts 1–200 characters.
- The picker offers a step as a predecessor only when the edge would be accepted, so a self edge, a
  duplicate and anything that closes a cycle are never on the list.
- Undo and redo cover the whole draft, with typing folded into one step inside a 600 ms window, 60
  deep.
- Save is grey only while the draft is unchanged or a write is in flight. A draft that does not
  validate still saves, because that is every workflow partway through being built: the footer says
  what is wrong, and **Run** is what refuses. A new definition has no steps, so the node list says so
  under its rows and the footer reports it.

### The graph view

**Graph** in the tab strip draws the same nodes as a picture: cards on a grid, the edges as curves,
the selected card the one the list has selected. The list column stays beside it on a wide layout and
collapses under it on a narrow one, which is the `list-detail` layout's own rule.

Drag from a card's bottom port onto another card to make it wait on the first. The `×` on a wire
removes that edge. Delete or Backspace removes the card the keys are on. Drag a card to put it where
you want it; it lands on a 22 px grid and stays there. Every one of those is the same draft operation
the inspector's own controls call, so the rules are the same: no self edge, no duplicate, nothing that
closes a cycle, and a delete never bridges what it stood between.

A card with no position of its own is placed from the edges: one rank below the deepest step it waits
on, sharing that rank with its siblings. So a new node appears at its rank without anybody placing it,
and moving a card is an override rather than a commitment to place the rest.

The canvas is the kit's `Graph` node, not this plugin's drawing
([ui-design.md](../ui-design.md) § The closed kit). That is what gives the terminal client this view
too: there it is the indented list, with a picker under it to draw an edge out of the selected card.

### The JSON tab

The escape hatch: the definition as the runner's own JSON, formatted. **Apply** is atomic. A document
that parses and is a definition replaces the draft; one that does not leaves the draft exactly as it
was, keeps the text for correction, and says what is wrong. **Format** reprints what is in the box
and **Revert** puts the draft's own projection back. Node positions are not in this document.

The box is a real editor — highlighting, line numbers, bracket matching — through
`mountEmbeddedEditor` on `@acorn/plugin-api/ui/editor`
([editor.md](../editor.md) § A code box that is not a document), so this plugin holds no CodeMirror of
its own. The terminal client draws the same rectangle as a plain textarea, since it has no library to
draw one with.

### Saving

The header carries the editor's actions: AI authoring, Undo, Redo, Save, **Publish…** and **Run…**.
The rarer ones are in its overflow menu: **Schedule…**, **Export to repository…** and **Delete**,
which asks for a second press. A badge beside the name says **Not published** or which revision is
published, because Run and Schedule use the published revision, not the draft. The tab strip under
the header only picks the view.

**Save** flushes the draft at the revision it was read at. Autosave uses the same operation.
A stale revision answers 409 and opens conflict choices without discarding the local draft.
The editor keeps pending edits on their originating Node through navigation and cleanup. A held save
acknowledges only its submitted content. For ownership and recovery rules, see
[draft recovery and publication](../workflows.md#draft-recovery-and-publication).
**Publish…** opens a review dialog that names the dependency set. **Publish** makes the set
executable only after all writes complete. **Resume publishing** continues an interrupted operation.
For a repository or user file, Save persists the visual draft on the Node; **Publish…** checks
external edits and file dependencies, and **Write files** atomically replaces that file while leaving
the working tree uncommitted. A database definition uses **Export to repository…** to review and
write its portable published dependency graph. Dismissing a review dialog keeps the prepared review
on the Node; a strip under the header offers it again until it is published or discarded. The old direct Save to repo operation is
refused because it cannot provide that review or preserve every workspace original.

**Run…** opens the start dialog, one box per declared input with a task picker when no task is
in scope, and starts the run when the required ones are filled. A definition that declares no inputs
and already has a task starts without a dialog.

A committed or user file opens in the same visual editor with a recoverable Node draft and its file
destination visible in publication review. Parse failures preserve the file and direct the user to
repair its raw TOML; they never open an empty visual definition. An address that names no layer at
all says that instead, because unreadable and an empty draft are different states.

### Where positions live

Node positions for the graph view are device preferences under
`plugin:workflows:layout:<defId>`, never in the definition, so a definition stays portable and a
committed file has no x and y in its diff. A rename carries a node's position with it and deleting a
definition drops its layout. A drag writes 400 ms after it stops, and a draft with no row yet keeps
its positions in memory for the session.
