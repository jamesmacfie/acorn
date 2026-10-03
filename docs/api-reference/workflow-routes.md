# Workflow routes

This page lists the workflows plugin's routes under `/v1/p/workflows`: definitions, runs, processing
history, and schedule bindings. It's part of the [API reference](../api-reference.md). The workflows
plugin owns durable definitions, runs, steps, gates, and reconciliation, and
[workflows.md](../workflows.md) owns the model. Paths below are relative to `/v1/p/workflows`.

## Runs

| Method | Path | Purpose |
| --- | --- | --- |
| `GET`, `POST` | `/tasks/:id/workflows` | The task's definitions, or start a run |
| `GET` | `/tasks/:id/workflows/runs` | The task's run projections |
| `GET` | `/workflows/runs/:runId` | One run projection |
| `GET` | `/workflows/runs/:runId/steps` | Steps, with a `children` list on each dispatch step |
| `GET` | `/workflows/runs/:runId/step-statuses` | Up to 200 `{ id, status }` rows with a `truncated` marker |
| `POST` | `/workflows/runs/:runId/gate` | Answer a human gate. Device-only |
| `POST` | `/workflows/runs/:runId/retry` | Put a failed step back to pending. Device-only |
| `POST` | `/workflows/runs/:runId/cancel`, `/kill` | Stop a run |
| `GET` | `/workflows/task-navigation` | Running and attention counts for root tasks. Device-only |
| `GET` | `/sessions/:sessionId/run` | Which run a managed agent session belongs to. Device-only |
| `GET` | `/runs` | The plugin's run source for `GET /v1/core/runs`. Refuses a task token |
| `GET` | `/catalog` | Every step kind this Node can run, with its form, the policies, and the agent profiles |

`POST /tasks/:id/workflows` takes `{ defId, inputs? }` and needs a device principal. Inline
definitions are refused, and drafts must be published first. A `defId` of `repo:<fileId>` or
`user:<fileId>` names a file the task's project loads. Anything else names a `workflow_defs` row.
`inputs` is a table of named, bounded JSON values the definition's schemas allow. The runner refuses a
required input with no value and a name the definition doesn't declare. `GET` on the same path
answers the task's file layers, plus the workspace's rows for a device caller.

`POST …/retry` takes `{ stepId, prompt? }`. `POST …/gate` takes `{ stepId, approved, values? }` and
answers `{ ok: true }`. `values` answers a gate's form and comes only with an approval
([execution](../workflows/execution.md#human-gates)). Both answer 403 to a task token, even on its own
run, because an agent could otherwise loop a step past the rail that stopped it, or answer the gate
that exists to stop it. The gate answers 404 `not_found` for an unknown step, 409 `gate-resolved` when
another answer landed first, and 400 `gate-invalid` with one line per refused field, leaving the gate
waiting. Every run-scoped path treats a foreign or unknown run as a 404.

Each run projection has explicit root and parent run IDs, the matching task IDs and names, depth, and
usage. A root reports usage for its whole tree, and a child reports only its own turns. Each child
summary on a dispatch step carries its task and run IDs, item key, dispatch and run status, a bounded
result or error, and usage. These are durable reads, not rebuilt from event payloads.

`GET /catalog` takes an optional `projectId` and ignores it. The answer is Node-wide, and the
parameter is there so a per-project answer needs no second route. Two other routes answer the option
lists a step kind's `select` fields point at, both shaped `{ options: [{ value, label, description? }] }`:
`GET /v1/p/terminal/tasks/:taskId/run-targets` and
`GET /v1/p/database/projects/:projectId/saved-queries`.

Node-owned callers use the `workflows.runner` capability instead of HTTP. Its start request supplies
a task ID, optional inputs, a stable caller key and payload fingerprint, a reserved run ID, and a
trigger, with an inline definition or a saved definition ID. The plugin resolves saved references in
the task's scope, freezes the graph, and checks a replay against the same invocation identity.
Scheduled workflows use this handoff.

## Processing history

These routes are device-only.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/workflows/runs/:runId/records` | Ordered record summaries and status counts |
| `GET` | `/workflows/runs/:runId/records/:recordId` | The retained snapshot, bounded named outputs, and query provenance |
| `GET` | `/workflows/runs/:runId/records/:recordId/attempts` | The record's attempts, paged by the opaque `after` cursor |
| `POST` | `/workflows/runs/:runId/records/:recordId/prepare-reprocess` | The retained attempt's digest and title, for review |
| `POST` | `/workflows/runs/:runId/records/:recordId/reprocess` | Reprocess one record |

The record list takes optional `stepId`, `selectionId`, a numeric position `after`, `filter`, and
`limit` up to 100. It reports zero-match and all-skipped states apart, and carries bounded query
provenance without record bodies or named outputs. `prepare-reprocess` takes an empty object.
`reprocess` takes that `digest` and a `requestId`, and creates or replays the related attempt and an
independent root child run without running the source query again.

## Definitions

Definitions stored as rows live under `/defs`, and the whole family is device-only
([workflows.md](../workflows/definitions.md#database-definitions)):

| Route | Body or query | Answer |
| --- | --- | --- |
| `GET /defs?workspaceId=` | | The merged list: the workspace's rows, every project's committed files, and the user layer, each with its `source`, `projectId`, and `problems`. A repo id wins a collision. |
| `POST /defs` | `{ workspaceId, projectId?, def }` | The row. A definition the loader rejects is a 400 carrying its problems. |
| `GET /defs/:id` | `?projectId=` | The row with its definition, or a 404. A `repo:` or `user:` id reads the committed file from the named project's checkout and answers `revision: 0`. |
| `PUT /defs/:id` | `{ def, revision }` | The row with `revision + 1`. A stale `revision` is a 409 whose `details` carry the winning row. |
| `DELETE /defs/:id` | | `{ ok }`. Runs that froze this definition are untouched. |
| `POST /defs/validate` | `{ def, projectId? }` | `{ problems }`, the loader's own list. `projectId` is ignored. |
| `POST /defs/files` | An `open`, `save`, `review`, `export`, `publish`, `discard`, or `list` request | A recoverable file draft, semantic conflicts, or a resumable per-file operation. Targets are confined `.acorn/workflows/<id>.toml` paths. |
| `POST /defs/publications/prepare` | A reviewed revision and its selected dependency revisions | The frozen, dependency-first publication plan |
| `GET /defs/publications?workspaceId=` | | Incomplete and completed publication operations, for recovery |
| `POST /defs/publications/:operationId/publish` | `{}` | The publication state and the exact revisions that landed |
| `POST /defs/publications/:operationId/discard` | `{}` | `{ ok }`, only while no write has landed |
| `POST /defs/:id/save-to-repo` | `{ taskId?, keepRow? }` | Refused, with guidance to use **Export to repository**. Kept for older clients. |
| `POST /defs/authoring/turn` | An authoring turn for a workflow | One AI authoring turn. No execution or publication. |
| `POST /defs/generate` | `{ backendId, modelId?, description, workspaceId, defId?, name?, inputs? }` | `{ def, notes, problems, repaired, providerId, modelId }` |
| `GET /defs/model-connections` | | The backends this owner can generate with, ids and labels only. An empty list is why the editor draws no **Generate** button. |

`POST /defs/generate` writes a definition from a sentence
([authoring](../workflows/authoring.md#generating-and-editing-with-ai)). `description` is capped at 8,000
characters by `GENERATE_MAX_DESCRIPTION_CHARS`, the constant the editor's text area reads.
`workspaceId` says whose definitions ride along as worked examples, and `defId` names one to leave out.
`notes` is a list of `{ code, message, step? }`, one per thing the reply named that this Node doesn't
have. `problems` is the checker's list.

It answers 422 `model_answer_unusable` when nothing in the reply reads as a definition. A provider
failure keeps the status the provider seam gave it, so `provider_not_connected` is a 404 and
`provider_needs_auth` a 401, and anything else is 502 `provider_unavailable`. The route makes up to two
model calls, so the client passes a 240-second `timeoutMs` ([transport](./transport.md#transport)).
Generation spends the owner's provider key, and the device-only gate on `/defs` covers it.

## Schedule bindings

These routes are device-only.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET`, `POST` | `/workflows/schedules` | List bindings with activation state, or save a draft binding |
| `GET` | `/workflows/schedules/defaults` | Defaults for a new binding |
| `POST` | `/workflows/schedules/prepare` | Check a draft binding and preview it before saving |
| `GET`, `DELETE` | `/workflows/schedules/:id` | Read or delete one binding |
| `POST` | `/workflows/schedules/:id/approve` | Freeze approval and choose `process-current` or `track-now`. `freshEpoch` resets processing scope |
| `POST` | `/workflows/schedules/:id/pause`, `/run` | Pause or resume with `{ paused }`, or run it now |

A draft binding names a project, a published workflow, typed input, a timezone, and limits. Create the
core cadence row separately, with target `{ "scheduleId": "…" }` and kind `workflow`. The workflows
plugin owns approval and occurrences. Core owns cadence, pause, deletion, **Run now**, and the
recent-run ring ([schedules](../schedules.md)).
