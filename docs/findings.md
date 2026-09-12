# Findings

The findings plugin records evidence discovered during a task without creating a notification or a
review obligation, then prepares explicit review bundles on request. The task pane shows retained
evidence; memory owns the preview and approval experience for proposed knowledge changes.

## Consolidated review

**Review learnings** freezes a task's active observations into a project-scoped preparation job.
Each boundary key is idempotent and leased. Only one unexpired job can run for a scope. The job
freezes ordered input membership and publishes each completed bounded chunk into the same bundle.
Cancellation and failure retain those candidates and outcomes. A bundle-ID retry resumes only inputs
without an outcome; the preparation job durably retains its source task, boundary, backend, and model,
so manual, terminal, workflow, and archive preparations resume without reconstructing a boundary key.
Publication stores stable bundle order, candidate membership, and an outcome for each observation. Exact normalized payloads
are checked against accepted memory, every outstanding candidate state, and active suppressions.
Repeated source occurrences remain linked to one candidate; contradictions are never discarded by
similarity grouping. A preparation that yields no candidate is a valid, inspectable bundle.

The deterministic path needs no model. When a caller explicitly selects an existing model and backend,
findings makes bounded generation requests and rejects unknown source IDs, duplicate or unaccounted
inputs, invalid target payloads, and oversized output. The job and bundle projection record the exact
selected backend and model, supplied token usage, and each omission reason. Findings does not select
or fall back to another paid backend or model.

Candidate content is immutable per revision. Editing creates a new revision, while dismiss, undo,
snooze, applying, applied, and conflict are append-only review actions projected into current state.
An exact dismissal creates a scope-local suppression so regeneration does not resurrect unchanged
text. A reviewer can restore an omitted observation to an open candidate or separate some of a
candidate's sources into a new candidate without changing the observations. Bundles publish one
`plugin:findings:review-changed` invalidation. They remain passive unless the owner enables
**Notify me when a prepared review bundle is ready**. That option emits one informational notice
per published bundle.

`findings:review-target` binds validation and a revocable completion callback to the plugin that owns
the destination. The public `findings.review.v1` capability is read-only: it lists bundles, reads
exact candidate revisions, and resolves source observations. It cannot approve or write a memory.

Findings is an app-bundled loaded plugin with Node and remote-tree client halves. The Node imports it
from `<data-root>/plugins/findings`, and both desktop and terminal clients render the same portable
tree. Disabling it removes its routes, descriptors, capabilities, database handle, and client
surfaces. Its SQLite file remains under the Node data root, so re-enabling the package restores the
records.

## Completion boundaries

The agents plugin publishes `agents.reviewInput.v1`. Its lifecycle event still carries only task,
session, turn, source, status, and attempt. Findings uses the capability to read the persisted
completion sequence, purpose, bounded assistant text, authorized user corrections, and an explicit
availability state. A mismatched task receives unavailable input instead of another task's text.

Findings stores a checkpoint before it considers preparation. Restart reconciliation reads completed
turns from agents and recreates missed checkpoints. Ordinary managed turns record eligible evidence
but do not prepare a bundle. Workflow-managed turns record an unavailable checkpoint because the
top-level workflow completion is the review boundary. Review-purpose turns are excluded.

The other supported boundaries are an agent terminal exit, top-level workflow completion, and a task
archive request. Terminal and archive bodies are capped at 16 KiB. Archive capture runs before the
teardown script, session removal, and worktree removal. If output or a worktree diff cannot be read,
the checkpoint records why the input is unavailable. Model preparation does not control terminal,
workflow, or archive success.

**Automatically prepare memory suggestions** is off by default. Enabling it applies only to terminal,
workflow, and archive boundaries. The settings page uses the shared model/backend picker and retains
both parts of the owner's selection. A missing backend does not stop evidence capture, and
deterministic preparation remains available.

## Legacy proposal migration

At startup, memory reads its legacy proposal files and contributes their names and contents through
`findings:legacy-source`. Findings never receives Memory's directory or raw filesystem access. It
keeps an import manifest in its own database. Each row records the migration version, source filename, SHA-256 hash, legacy ID,
destination IDs, source status, mapping shape, and any error. An unchanged retry creates no duplicate.
A changed source or malformed file blocks cutover and remains on disk.

Pending proposals become ready candidates. Accepted and rejected proposals become historical applied
or dismissed outcomes without writing memory again. A missing project falls back to private reach,
so a deleted project does not discard its history. Memory keeps the compatibility routes. An
unchanged one-to-one mapping can still accept or reject through its legacy ID, while an edited or
grouped successor requires the Findings preview.

For a mapped legacy decision, the Findings outcome is completed first and the retained proposal JSON
is then atomically marked accepted or rejected. A retry uses the findings promotion receipt or
idempotent dismissal to repair only an interrupted JSON status link; it never repeats the memory-file
write. Disabling findings after a mapped decision therefore cannot expose that proposal as pending
again.

After every source is accounted for, memory hides mapped legacy rows from its page and attention
provider. If findings is disabled or the report is not safe for cutover, the legacy generator and
queue remain authoritative. Re-enabling findings imports those fallback files by ID and hash. The
first release does not delete legacy files.

## Records

An observation is immutable after insertion. It contains:

- A task, project, workspace, or private scope, plus display-label snapshots.
- A host-derived origin for an agent session, workflow run, schedule run, device, plugin producer,
  or imported legacy proposal.
- A qualified, versioned kind and the kind label captured at write time.
- A title, Markdown body, claim status, source key, and structured evidence references.
- An optional link to the observation that this record corrects.

The initial `findings:observation` kind uses version 1. If a contributed kind disappears, history
keeps its stored label and marks the kind unavailable.

A withdrawal is a separate row that records the actor, time, and optional reason. It hides the
observation from active reads but does not erase the record or its evidence. An agent session can
withdraw only observations that the same session recorded. A paired device can withdraw any
observation on a task that it can address.

## Identity and retries

The caller does not supply trusted scope or origin fields. Agent tools take the task and session from
the signed internal principal. Device routes take the device ID from the paired principal. Producer
writers receive their plugin and producer IDs from the host registration.

Each producer supplies a bounded source key. Findings combines it with the scope and a host-derived origin
namespace for retry deduplication. Repeating the same key and payload returns the original ID with
`created: false`. Reusing the key with different content returns a conflict. A successful batch writes
all records in one transaction and increments the scope revision once.

The plugin stores one monotonic revision per scope. A write or withdrawal publishes one
`plugin:findings:observations-changed` frame with the scope and revision. The pane re-reads task
history after a matching frame. Observation capture does not register attention or send notices;
only an explicitly enabled ready-bundle notification can do so.

## Evidence and limits

Evidence references are structured values. They can refer to repository paths, managed-agent turns,
workflow steps, other observations, memory versions, and HTTPS URLs. Repository paths must remain
inside the task worktree or project checkout. Findings stores references, not copied transcripts,
secrets, or file bodies.

The plugin applies one bounds table to every ingress:

| Field | Limit |
| --- | --- |
| Title | 200 characters |
| Markdown body | 16 KiB in UTF-8 |
| Evidence references | 20 per observation |
| Evidence URL | 2,048 characters |
| Batch | 100 observations |
| Page | 100 observations |
| Source key | 200 characters |
| Withdrawal reason | 1,000 characters |

Task history uses an opaque cursor ordered by creation time and observation ID. The default pane read
includes withdrawn records. Agent list calls default to active records. Device history remains
readable from retained provenance after the core task row is removed; task credentials do not.

## Workflow decisions are deliberately deferred

Findings does not currently contribute a workflow policy, store required-fix obligations, or ship a
reviewer profile. No product workflow has been identified that needs findings-backed gating, so the
separate decisions phase did not meet its entry condition. A request to record or consolidate a
finding remains advisory: withdrawal, acknowledgement, dismissal, and snooze have no effect on a
workflow run. Installing, disabling, or removing findings therefore leaves ordinary workflows and
their existing human and checks policies unchanged.

A future gate starts with a concrete, explicitly configured workflow use case. It must introduce a
versioned decision record separate from observations and memory candidates, bound to one workflow
run and step, its scope, and the exact evidence revision reviewed. The decision must record the
device actor, rationale, and follow-up obligations. Only addressed evidence, an explicit risk waiver,
or a verified not-applicable disposition may satisfy it; acknowledgement, snooze, observation
withdrawal, and candidate dismissal cannot. The policy must re-evaluate at the execution point and
fail explicitly when its implementation, evidence revision, or required obligations are unavailable
or stale.

Such a policy would be named explicitly by a `gate-policy` step—never inferred from severity or
attached to every finding—and use the workflow owner's existing gate attention and UI. Reviewer
profiles also require provider conformance for both Acorn's tool ceiling and provider-native file,
shell, and edit restrictions; a prompt that says “read only” is not enforcement. Unsupported
providers remain unavailable for that preset. This contract describes an Acorn workflow gate only,
not CI status, GitHub merge protection, repository-wide enforcement, fitness scoring, or cost
estimation.

## Agent tools

The plugin contributes four task-scoped tools:

| Tool | Risk | Behavior |
| --- | --- | --- |
| `findings_record` | write | Records one observation for the signed task and managed session. |
| `findings_list` | read | Lists active observations or retained history with cursor pagination. |
| `findings_get` | read | Reads one observation only when it belongs to the signed task. |
| `findings_withdraw` | write | Withdraws an observation recorded by the calling managed session. |

The installed manifest declares these tools, and the host projects the descriptors to the task
renderer route and the Model Context Protocol (MCP) server. The handlers run through Findings' own
portable fetch route. The write tools set `requiresSession`, so an unsigned internal caller cannot
invoke them. List pages shrink below the requested row count when necessary to remain under the
carrier's byte ceiling and return a cursor for the rest; every legal single record remains readable.
The same manifest declares the bounded `findings:task_findings` context section, whose record bodies
and evidence sources are trimmed before serialization so a legal observation cannot make the whole
section unavailable.

## Device routes

The owner-facing routes are device-only:

| Method | Path | Behavior |
| --- | --- | --- |
| `GET` | `/v2/p/findings/tasks/:id/observations` | Lists task history. Accepts `cursor`, `limit`, and `state`. |
| `GET` | `/v2/p/findings/tasks/:id/observations/:observationId` | Reads one task observation. |
| `POST` | `/v2/p/findings/tasks/:id/observations` | Records one explicit device-authored observation. |
| `POST` | `/v2/p/findings/tasks/:id/observations/batch` | Records one atomic device-authored batch. |
| `POST` | `/v2/p/findings/tasks/:id/observations/:observationId/withdraw` | Withdraws one observation. |
| `POST` | `/v2/p/findings/observations` | Records a device-authored observation at any validated scope. |
| `POST` | `/v2/p/findings/observations/batch` | Records one atomic device-authored batch at any validated scope. |
| `POST` | `/v2/p/findings/tasks/:id/review/prepare` | Prepares an idempotent manual review boundary, optionally with a selected model and backend. |
| `GET` | `/v2/p/findings/review/bundles` | Lists active or historical bundles for a discriminated scope. |
| `GET` | `/v2/p/findings/review/candidates/:id` | Reads a full candidate and its source observations. |
| `POST` | `/v2/p/findings/review/bundles/:id/cancel` | Cancels an in-flight preparation and ignores later synthesis output. |
| `POST` | `/v2/p/findings/review/bundles/:id/retry` | Resumes the bundle from its durable source task, boundary, backend, model, and frozen inputs. |
| `POST` | `/v2/p/findings/review/bundles/:id/outcomes/:observationId/restore` | Restores an omitted observation to a selected candidate. |
| `POST` | `/v2/p/findings/review/candidates/:id/edit` | Creates a validated candidate revision. |
| `POST` | `/v2/p/findings/review/candidates/:id/decision` | Dismisses, undoes dismissal, or snoozes an exact revision. |
| `POST` | `/v2/p/findings/review/candidates/:id/split` | Separates some source observations into a new candidate. |
| `GET` | `/v2/p/findings/review/candidates/:id/history` | Reads append-only review history. |
| `GET` | `/v2/p/findings/settings` | Reads completion preparation and notification settings. |
| `PUT` | `/v2/p/findings/settings` | Replaces the validated settings object. |
| `GET` | `/v2/p/findings/migration/report` | Reports source counts, mappings, hash conflicts, and cutover readiness. |
| `GET` | `/v2/p/findings/export` | Exports observations, checkpoints, candidates, revisions, links, and review history. |

All routes use `ctx.routes.fetch` and the host-supplied request context. Route bodies contain record data only. They cannot override the URL task or paired-device origin.
Task-confined internal credentials use the agent tools and receive `403` from these routes.

## Plugin collaboration

Findings publishes the read-only `findings.records.v1` capability for task list and get operations.
External writes use the `findings:producer` extension point instead of the capability. The host gives
each producer a bound writer, qualifies its local kinds with the contributor's plugin ID, and rejects
undeclared kinds. A cached writer stops accepting calls as soon as the producer registration or the
findings plugin disappears.

The `findings:kind` extension point accepts versioned kind descriptors. Version and label are data;
an optional validator remains with the contributing plugin. The findings package exports contracts
and test fixtures but keeps storage and runtime implementations private.

An installed producer uses the same contribution API. Declare each local kind through
`findings:kind`, then contribute a `findings:producer` whose `connect` method retains the bound writer.
The host qualifies `architecture` from plugin `architecture-review` as
`architecture-review:architecture`. The writer stamps that plugin identity, rejects every other kind,
and stops accepting calls after the contribution or Findings unloads. The working standalone fixture
is `apps/node/test/__fixtures__/findings-producer`.

Findings does not receive `memory.knowledge`, a Memory route grant, or a Memory approval tool. The
pane opens review through its manifest-declared `memory-review` destination. The frame broker maps
that local ID to the `findings-candidate` target kind and accepts only a bounded candidate ID. Memory
still owns the target handler, preview, device gate, durable receipt, and write.

Workspace recording validates the workspace through the public project service. A workspace with no
projects cannot receive a producer-authored observation because core exposes no generic workspace
lookup to plugins. This restriction avoids adding a core API for an unsupported empty-workspace case.

## Storage

`plugins/findings.sqlite` contains observation tables plus review-owned tables:

- `observations` stores immutable records and label snapshots.
- `observation_withdrawals` stores the optional withdrawal history.
- `finding_scope_revisions` stores the monotonic invalidation revision per scope.
- Candidate/revision/source-link tables store immutable proposals and provenance.
- Bundle, membership, grouping-outcome, preparation-input, and preparation-job tables store durable publication state and the exact source task/backend/model needed to resume.
- Review-action and suppression tables retain decisions without rewriting observations.
- Lifecycle checkpoint and bundle-notice tables retain completion and delivery idempotency.
- The legacy import manifest retains source hashes, destination mappings, and migration failures.

The database has its own migration chain. It has no cross-database foreign keys and resolves task,
project, and workspace IDs through `CoreServices` before writing.

The loaded package retains plugin ID `findings`, so the host opens the same
`plugins/findings.sqlite` file that the compiled build used. Installed-package tests populate the
compiled database, preserve observation IDs, candidate revisions, dismissal actions, and legacy
mappings across cutover, then cover update, disable and re-enable, uninstall and reinstall without
purge, and a contained failed migration.
