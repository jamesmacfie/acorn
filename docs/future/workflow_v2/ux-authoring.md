# Authoring UX

Date: 2026-09-13. Status: accepted design, implementation not started.
Context: [decisions](./context.md). Mechanics live in [data](./data-contract.md),
[publication](./publication.md), and [AI authoring](./ai-authoring.md).

## Interaction rules

The normal flow asks what to find, what to do with each result, and when to run. Use one visible next
action for an unfinished section. Technical completeness is not a reason to expose every field at
once. **Needs setup** is an ordinary draft state. Show validation errors after interaction or a
publish attempt, and put a repair action beside each issue.

The source supplies vocabulary, not layout. Use **Issue**, **State**, or **Error** when known and
**Record** otherwise. Keep field paths, internal step IDs, schema revisions, cursors, and hashes in
expandable technical details. Do not show an empty required-input error wall as the initial screen.

Use the existing closed kit, appearance tokens, broker, and cache. Shared controls must support
keyboard and terminal use. Do not give each plugin its own form renderer. Essential information
must remain visible without hover and distinguishable without color.

## Workspace entry and navigation

Keep Workflows and Dashboards as recognizable entry points. The workflow library separates
definitions, schedules, and recent runs with labeled sections/tabs. A definition row shows its name,
project scope, published/draft state, and attention only when relevant. Avoid leading with database
or repository IDs; source location is a secondary label.

Access **Saved queries** from the source picker and a library management action in both editors.
It opens the same workspace query library; do not create separate dashboard and workflow libraries.
Creating a query inline does not require naming or saving it to the library. Offer **Save as shared
query** after it is useful. Show consumers when opening a shared query for editing.

## Workflow editor layout

Use a header with name, contextual save/publication state, Publish, and Run. Run uses the published
version only. When a draft differs, explain **Publish changes to run this version** and keep the
published-run action clearly labeled. Run is unavailable before first publication, with a visible
reason. Do not imply that autosave made a draft executable.

The main region contains an ordered outline and the selected step's configuration/preview. The
optional AI conversation opens beside the authoring region. At narrow widths, switch between
outline, configuration, preview, and conversation while retaining selection and drafts. Do not
squeeze four unusably narrow columns into the window. The terminal uses the same region sequence.

Show branches under labeled If and Otherwise paths. Show For each as one parent step with a child
workflow summary and an Open action, not hundreds of generated nodes. The secondary graph is an
alternate view of the same stable step IDs and edges. General dependency graphs that are not a
simple tree show **After [step names]** and shared steps once, rather than inventing nesting.

Each collapsed step states its behavior, for example:

- Find open pull requests by `dependabot[bot]` in the selected repository.
- For each pull request, run Review dependency update.
- If Requires work is Yes, run Analyze issue.

Add-step choices lead with actions rather than engine names. Group source queries, agent work,
conditions, child workflows, and existing contributed actions. Keep advanced kinds searchable.
The AI-list shortcut inserts a structured agent step and For each, both editable as ordinary steps.

## Find records

1. Choose a source or saved query. Group results by plugin and show record labels and availability.
2. Choose a connection when required. If only one is valid, preselect it visibly. Never hide account
   scope or choose one of several accounts arbitrarily.
3. Choose declared scope parameters such as repository/project. Fetch dependent choices through
   the source metadata API. Display a loading state in that control, not a whole-editor spinner.
4. Add filters using field → operator → typed value. Default groups to **All conditions**; expose
   **Any condition** and nested groups through an Add group action. Show only source-supported
   operators. Other fields can appear as unavailable with a specific reason.
5. Select **Refresh preview**. Show record titles and useful source-declared columns. Expand a row
   to inspect nested data. Label the query time, scope, and preview limit.

Changing query settings leaves previous rows visible under **Preview is out of date** and offers
Refresh preview. A late response for an older query cannot replace the new preview. Cancel the
obsolete request where supported. Display-only changes redraw immediately from loaded records.
Do not fetch records on every keystroke or to populate an unrelated metadata picker.

Zero rows says **No matching issues** and offers Edit filters. Query failure says what failed and
offers Retry or Reconnect. Partial/incomplete results are not labeled zero or complete. A cold
source still provides the fields it can describe. Unknown fields offer Preview to inspect data,
not guessed controls.

## For each and child setup

The first action is **Choose records**. Offer upstream arrays using readable source/step labels.
When adding after Find records, preselect that output visibly. Then choose the child workflow.
Filter/sort candidates by input compatibility, retaining unavailable choices with explanations.

Offer **New workflow** in context. Open a child draft with a typed record input and a breadcrumb
back to the parent. Returning retains the parent's selection and draft. Show the child as a linked
draft until published. Publishing the parent reviews required child/query drafts together.

Prefill a unique compatible record input and show the binding. Do not guess between several
compatible inputs. Additional required inputs appear below, with suggestions. The default task title
uses record metadata and appears as an example. Title templates, identity overrides for ordinary
arrays, and execution limits live under Advanced and appear automatically if repair is required.

Changing the child target retains bindings only where compatible. Show unmapped/invalid bindings
without erasing the user's previous choices. An AI target change is permitted as a reviewed proposal;
the old blanket target-restoration rule is replaced by explicit change review, not silent retargeting.

## Typed field picker

Group origins as Workflow inputs, Current record, and Available step results. Search labels and
paths. Expand nested objects. An option shows origin, label, type, and a labeled example when preview
data exists. Whole records and arrays remain selectable. Display **No preview value** rather than
inventing a sample or treating absence as empty text.

Compatible fields rank first. Incompatible fields explain why they cannot be selected. Offer only
explicit supported conversions; do not parse arbitrary strings as numbers. Optional fields show
**May be missing**. Offer a typed fallback where needed. When the destination accepts an optional
value, omission requires no extra user configuration.

Do not auto-open every advanced binding field. A configured binding collapses to a readable chip,
such as **Current issue → Identifier**. Selecting the chip reopens its source. Keep technical JSON
Pointer editing in the code view, not the normal inspector.

## Conditions and structured agent output

The condition editor asks for a field, comparison, and value. A boolean offers Yes/No. Show a
sentence preview and named branch destinations. A missing field offers a presence test or fallback.
AI decision steps remain clearly named **Ask AI to decide** so their cost and semantics differ from
a direct comparison.

Let users describe structured agent output using an editable field list of names, types, and
requiredness, including nested objects/lists. The advanced schema/code view edits the same schema.
AI can propose that schema, but manual authoring must not require writing JSON Schema for the
three example workflows. Preview cannot execute an agent to fabricate its output. Show declared
fields without sample values until a recorded result or explicitly supplied sample is selected.

## Dashboard editor

Open a persistent editor with Data and Display sections beside the panel preview. Placement is a
compact section, not a separate mandatory wizard. Reuse Find records controls and saved-query
selection. Choose view/columns/grouping from described fields before fetching where possible.

For several sources, add separate queries. Keep source badges visible. Suggest display-field
mappings from semantic hints, and require explicit mapping for unmatched fields. Map exact provider
state IDs into user-defined board columns without rewriting query filters or record data. A status
category may suggest a mapping, but cannot discard distinct provider states.

Display controls redraw from the same preview records. Unavailable view choices explain the needed
field, for example a number for a sum. Publishing updates the panel and its existing placements.
Creating a new panel publishes its first version with the chosen placement. Draft layout edits do
not alter another visible placement prematurely.

Editing a shared query from a consumer offers **Edit saved query** and **Customize for this use**.
The former opens the shared draft and lists consumers. The latter detaches an inline copy only
after selection and keeps the original untouched. Name the scope beside Publish.

## AI, publication, and recovery

The conversation can edit the same workflow, query, or dashboard draft. Show progress as meaningful
actions such as **Checking available Linear states**. Present clarification choices inline and
retain the partially built proposal. A proposal has a readable change list and highlighted affected
steps/fields. Apply is one undoable edit. Reject leaves the draft unchanged.

Use **Draft saved**, **Saving**, **Saved on this device**, and **Could not save** accurately. Publish
review shows only changed entities, required unpublished dependencies, and affected consumers.
Link each blocking problem to its exact control. Schedule approval remains a separate state and
action; unpublished editing does not pause existing schedules.

Conflict review starts at the affected field/step. Show Your change and Changed elsewhere; resolve
non-overlapping fields automatically. Preserve the base/draft/external values until the user resolves
conflicts. Repository publication labels its file destination and leaves changes uncommitted.

## Affordance acceptance

- Tab/Shift+Tab, arrows, Enter, and Escape work without mouse-only controls or focus traps.
- Closing a picker restores focus to its trigger; returning from a child restores the parent step.
- Undo/redo covers typing bursts, bindings, AI application, step changes, and local query detachment.
- Empty, loading, unavailable, invalid, stale, conflict, and permission states have different copy.
- Changing a project invalidates stale state selections visibly, without choosing a replacement.
- Removing a referenced step shows affected bindings before the edit is applied.
- Narrow windows and terminal layouts retain one readable editing region and the current context.
- Color and hover are not the only carriers of state or explanation.
- Normal setup shows no cursors, hashes, internal IDs, or mandatory title/key templates.

## Verify before building

Read the kit support table and current editor/draft modules in [context](./context.md). Exercise the
three [example journeys](./verification.md#example-journeys) in the real Tauri window, including an
empty workspace and unavailable provider. Do not accept component snapshots as the only UX evidence.
