# Drafts, publication, and repository files

Date: 2026-09-13. Status: accepted design, implementation not started.
Context: [decisions](./context.md). User flows are in [authoring UX](./ux-authoring.md).

## Ownership and persistence

Store query drafts and immutable published query revisions in core storage. Store dashboard drafts
and published definitions in core storage. Store workflow drafts, revisions, and publication
coordination records in workflow plugin storage. Preserve existing panel placement/layout ownership.
Drafts are not runnable definitions. Published revisions remain readable for referenced runs.

Each entity needs an ID, workspace, optional project restriction, editable draft, draft revision,
base published revision, published revision pointer, and timestamps. Query content includes its
typed parameter declarations. A revision includes immutable content and a content digest. The
publication flow references dependencies by entity ID and reviewed revision/draft revision.

Use compare-and-swap updates and verify affected-row counts. Autosave coalesces edits after 750 ms
of inactivity and flushes on deliberate navigation where possible. Preserve a device-local recovery
copy keyed by Node/entity/base revision when the Node cannot acknowledge saving. Label it **Saved
on this device** or **Not saved**, never **Draft saved** on an unacknowledged request. Reconnect
reconciles revisions; it does not silently overwrite the Node. Clear the recovery copy only after
acknowledgment or explicit discard. Do not replay publication, execution, or schedule activation
as offline queued actions.

This is feature-owned persistence with shared pure revision/merge helpers where needed. Do not
introduce a general content-management framework or move workflow tables into core for convenience.

## Publication and consumers

Publishing validates the draft and all used source capabilities, inputs, bindings, graph edges,
and dependency references. A source temporarily offline may still permit saving a draft. Publication
that requires unresolved dynamic metadata reports the missing validation and cannot activate work.
Published definitions can subsequently become unavailable and must remain visible with repair links.

Queries are optional shared entities. A consumer stores either inline query content or a saved query
reference with parameter bindings. Ordinary reads resolve the latest published revision. Runs
freeze exact resolved revisions at start. Draft previews use the selected draft and are labeled as
such. Updating a draft does not update published panels or schedule approvals.

Maintain dependency records sufficient to list affected panels, workflows, and schedules. A query
or child publication marks affected schedule graphs for review when execution semantics change.
This notification is advisory; the dispatch-time graph digest check is authoritative. Human labels,
layout, and documentation-only edits do not require schedule approval. Filters, scope, parameters,
bindings, prompts, schemas in use, child targets, models, tools, or limits do.

Deletion refuses a referenced published entity and offers consumer links or explicit local copies.
Do not cascade deletion into consumer definitions. Runs retain their snapshots after the originating
draft or connection disappears. Disabling a plugin retains definitions and renders them unavailable.

## Publish together

Review names the parent, changed dependencies, affected consumers, and proposed revisions. Unchanged
published dependencies are reused. Newly created child drafts can be linked before publication.
Publishing the parent includes required unpublished dependencies after the user reviews the set.
An unrelated dependency draft is not silently adopted just because it exists.

Use a small feature-owned publication operation with an idempotency ID and explicit states:
prepared, publishing, complete, and needs-reconciliation. Prepare validates all base revisions and
freezes intended content before writes. Publish dependencies before consumers. The operation records
each completed write and exact revision; retries verify those revisions instead of publishing new
ones. Mark affected scheduled consumers as requiring review before exposing changed dependencies.

Database-local writes can be transactional. Core/plugin databases and repository files do not share
a transaction. Do not claim otherwise. A partial publication reports exactly which revisions landed,
retains all remaining drafts, and blocks affected executable publication sets until reconciliation.
Unaffected published entities keep working. UI success appears only when the reviewed set is complete.
Start resolution must refuse a referenced entity held by an incomplete publication operation.

## Conflict review

Keep the base, local draft, and external version. Merge object fields changed on only one side.
Use stable IDs to align steps and other identified list entries. Never merge arrays by position.
Concurrent reorder, delete-versus-edit, or conflicting changes to the same field require a choice.
Unidentified arrays are an atomic value. Do not add a CRDT or collaborative-editing engine.

Present the affected step/field with **Your change** and **Changed elsewhere**, plus keep either
side or edit the resolved value. Show unchanged context on demand. Keep undo history for the draft.
After resolution, validate the merged definition and recheck its base revision before publication.
AI proposals are also based on a draft revision and must rebase/revalidate before application.

## Repository editing and export

Repository and user-file workflows retain their file authority. Persist visual drafts on the Node,
keyed by project and confined relative file path, with a base content hash. On opening, show the file
and any recoverable draft. Read/parse failure offers raw file access, not a silently empty workflow.
External code-editor changes enter the same conflict review. A successful visual publication writes
the validated definition atomically per file and leaves it as an ordinary working-tree change.
It does not commit, switch branches, or replace repository trust checks.

Use the existing path confinement and symlink checks. Check expected file content before writing.
Retain the intended content and original hash in publication recovery state. Non-cooperating external
editors are not locked by Acorn; detect conflicts on recheck and refuse to overwrite known changes.
If several files are involved, recover or reconcile the recorded operation instead of claiming an
atomic filesystem-wide publication. Run preflight checks a stable resolved graph and source trust.

**Export to repository** preserves workspace originals. Embed the selected published saved queries
and their parameter declarations into the workflow definition. Repository workflows do not retain
opaque dependencies on the originating Node's query database. Export database-owned child workflows
as sibling workflow files and rewrite references in the exported graph, with a reviewed file list.
Reuse existing repository references only when resolvable within the export scope. Refuse cycles,
unresolved dependencies, and conflicts instead of producing a partly portable graph without warning.

Connection IDs are Node-local. Replace exported connection selections with named typed connection
inputs constrained to the required provider/source, and show them in the export review. Bind them
through the normal manual/schedule input flow on the destination Node. Credentials never enter files.
Keep provider-specific project/state identifiers visible as setup dependencies; validate them against
the selected destination connection and require repair when unavailable. Do not guess matching names.

Files edited directly are executable source definitions, not unpublished app drafts. Parse/validate
them before running, apply repository trust, and compare the graph with schedule approval. Their
content changes cannot bypass the schedule review rule merely because no Publish button was used.

## Verify before building

Recheck workflow definition saves, route authorization, file codec/path guards, preferences storage,
and revision handling. Test multi-database and multi-file failure boundaries explicitly. Follow the
reset and retention limits in [verification](./verification.md).
