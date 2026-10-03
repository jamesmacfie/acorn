# Workflow definitions

A definition is a committed `.acorn/workflows/*.toml` file or a `workflow_defs` row you typed in the
app, and the Node reads both as one list. This page covers the two stores, starting a run by ID, and
how drafts are saved and published. The routes are in `plugins/workflows/src/server/routes/defs.ts`.

## Database definitions

A definition does not have to be a file. `workflow_defs`, in this plugin's own SQLite file, holds one
the owner typed in the app: a workspace id, an optional project id, the definition as JSON, and a
`revision` that a save checks. A row bound to no project can run on any task in its workspace.

**Two stores, one read.** `GET /v1/p/workflows/defs?workspaceId=` folds three layers into one list:
this workspace's rows, every project's committed files, and `~/.acorn/workflows`. A repo id beats a
user id beats a row id, so a definition somebody can review in a pull request always wins. Each entry
says which layer it came from and which project it belongs to. The task-scoped
`GET /v1/p/workflows/tasks/:id/workflows` answers the same three layers for one task, which is what
the palette searches.

**Two trust stories.** A committed file is executable configuration somebody put in the repository,
so starting a run from one hashes the snapshot and asks for an acknowledgement. A row was typed by
the node's owner in this app, behind the device gate, so there are no committed bytes to hash and the
snapshot check does not apply. That is the whole reason every route under `/v1/p/workflows/defs` is
device-only. Task credentials can list file definitions for their own task, but cannot read the
database definitions or create a root run through HTTP.

**Starting by id.** `POST /v1/p/workflows/tasks/:id/workflows` takes `{ defId }` and optional typed
inputs and requires a device principal before reading the body. Task and service credentials are
refused for every definition layer. A root start creates fresh tool authority, budget, deadline,
and cancellation lineage; repository trust alone does not preserve the calling agent's limits.
Trusted schedules and frozen child dispatch use their admission capabilities directly.
Inline definition bodies are refused. A `defId` of `repo:<fileId>` or `user:<fileId>` names a file the task's project loads;
anything else names a row. The node resolves it and applies the layer's own rule, which is stronger
than trusting a `source` field in the request body.

**A row is a draft.** Neither write validates, because a workflow being built is invalid for most of
the time somebody is building it: it has no steps the moment it is created, and a step has no prompt
until one is typed. `POST /v1/p/workflows/defs/validate` reports, the editor draws what it says in
its footer. Run resolves an immutable published revision, never the editable row. A file layer is different: a definition that does not
validate is listed with its problems rather than hidden.

**What a row may name.** A run target, a saved query, or an agent profile is checked when the step
runs, not when the row is saved. The node holding a definition may not have the repository at all, so
`POST /v1/p/workflows/defs/validate` answers the loader's own problem list and leaves the
project-specific names to the step handlers.

## Draft recovery and publication

`workflow_defs` owns editable content, a draft revision, and published/base revision pointers.
`workflow_revisions` retains immutable content and digests. Saves use compare-and-swap and verify
the affected-row count. Editing a draft does not change what Run executes.

The editor coalesces autosaves after 750 ms. Device recovery copies retain the Node ID, entity ID,
base revision, base content, and local content. Only a matching acknowledgment clears a copy.
Unavailable storage displays **Not saved**; an unacknowledged durable copy displays **Saved on this
device**. Reopening compares the local copy with the Node version. Stable IDs align step lists;
conflicting fields, concurrent structural edits, and delete-versus-edit require an explicit choice.

The editor captures its QueryClient's Node for definition, file, catalog, provider, validation, and
publication requests. Contributed field choices and AI authoring use that owner too. AI conversation
recovery keys retain the captured Node, and navigation retires the dialog and its pending reply. Cleanup flushes pending edits through that captured API. A save acknowledges
its submitted definition and base revision. Later edits remain dirty and recoverable. Writes to the
same entity run serially; pending saves coalesce to the last submitted edit. Late responses cannot
change a replacement definition's revision, history, conflicts, or save status. Publication and export
wait for their captured save before preparing a review. Navigation retires validation and review
results from the departed definition.


`POST /defs/publications/prepare` freezes a reviewed dependency-first write set. The request selects
the root draft revision and optional changed child/query draft revisions. Required unpublished
dependencies are included; unrelated edits to published dependencies are not adopted. Metadata-dependent
queries accept explicit validation inputs and step values through the `validation` field. Preparation
uses source descriptions and options, not record queries. A missing validation value blocks publication.

`POST /defs/publications/:operationId/publish` writes that set idempotently. The workflow-owned journal
records `prepared`, `publishing`, `complete`, or `needs-reconciliation`, intended revisions, landed
revisions, and the remaining writes. Core query holds prevent partially published query revisions
from resolving. Workflow admission refuses affected definitions until the operation completes;
unaffected definitions remain usable. Core and plugin writes are not one transaction.

`GET /defs/publications?workspaceId=` exposes recovery state. Resume retries the exact frozen writes;
it does not create replacement revisions after a lost response. A review with no landed writes can
be discarded through `POST /defs/publications/:operationId/discard`. A partial publication must resume.
Ordinary references resolve published revisions; run admission pins saved-query revisions and freezes
the child graph. Dependency records support consumer review and refuse referenced workflow deletion.

Draft saved-query references use a separate `draft:<workflowId>` consumer identity. The workflow
store tracks reference claims before writing core consumers, then acknowledges the draft save.
Stale claims are removed after successful saves or deletion. Startup reconciles interrupted claims,
including deletion that reached the workflow store before core cleanup. Draft changes cannot remove
the consumer protection of the published revision. Query deletion also refuses active publication
holds, even when the query has no consumers.
