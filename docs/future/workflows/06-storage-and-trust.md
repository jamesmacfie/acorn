# Storage and trust

Part of [docs/future/workflows/](./README.md). Status: design, 2026-09-08. Phase 2 builds it.

## The table

In the workflows plugin's own SQLite file, beside `workflow_runs` and `workflow_steps`, migration
`0001` in `plugins/workflows/migrations`:

```ts
export const workflowDefs = sqliteTable('workflow_defs', {
  id: text('id').primaryKey(),                 // uuid
  workspaceId: text('workspace_id').notNull(), // → core workspaces.id, plain id
  projectId: text('project_id'),               // → core projects.id, plain id; null = any project in the workspace
  name: text('name').notNull(),
  defJson: text('def_json').notNull(),         // the WorkflowDef, without positions
  revision: integer('revision').notNull().default(1),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (table) => [index('workflow_defs_workspace_idx').on(table.workspaceId, table.updatedAt)])
```

Cross-database ids are plain ids, as the runs table already does with `task_id`. A deleted project
leaves rows with a dangling `projectId`; the list marks them "project removed" and the editor offers
to rebind or delete. A deleted workspace's rows are purged by a `workspace:changed` listener, or on
the next list read when the workspace is gone.

The definition id a person sees in the rail and in `after` references is the row's `id`. The TOML
file id, when a row is saved to the repo, is a slug of the name, deduplicated against the folder.

## Routes

All device-gated (`requireDevice`), because writing a definition is authoring executable
configuration:

| Route | Body or query | Answer |
| --- | --- | --- |
| `GET /v2/p/workflows/defs?workspaceId=` | | The merged list: database rows for the workspace, plus every file definition of every project in it, plus the user layer, each `{ id, source: 'repo' \| 'user' \| 'database', name, projectId?, steps: {name, kind}[], inputs, problems }`. Repo wins on id. |
| `POST /v2/p/workflows/defs` | `{ workspaceId, projectId?, def }` | The row. Validates first with the catalog; a problem list is a 400. |
| `GET /v2/p/workflows/defs/:id` | | The row with its `def`. |
| `PUT /v2/p/workflows/defs/:id` | `{ def, revision }` | The row with `revision + 1`. A stale `revision` is a 409 carrying the current row. |
| `DELETE /v2/p/workflows/defs/:id` | | `{ ok }`. Runs that froze this definition are untouched. |
| `POST /v2/p/workflows/defs/validate` | `{ def, projectId? }` | `{ problems: string[] }`, the same list the loader produces, with the project's run targets and saved queries in the catalog when a project is named. |
| `POST /v2/p/workflows/defs/:id/save-to-repo` | `{ taskId?, keepRow }` | Writes `.acorn/workflows/<slug>.toml` into the task's checkout (or the project folder when no task is given), answers `{ path }`, deletes the row unless `keepRow`. |
| `POST /v2/p/workflows/tasks/:id/workflows` (exists) | `{ def, inputs? }` or `{ defId, inputs? }` | Starts a run. `defId` may be a row id or `repo:<fileId>` / `user:<fileId>` for a file the task's project loads. |

The task-scoped `GET /v2/p/workflows/tasks/:id/workflows` keeps answering file definitions for the
palette, and gains the workspace's rows in the same list, so the palette's search sees both.

`plugin:workflows:defs-changed { workspaceId }` goes out on every write, and the rail list and the
editor re-read on it.

## The TOML writer

`plugins/workflows/src/server/workflowToml.ts` (new) turns a `WorkflowDef` into the file the loader
reads: the definition keys, `[[inputs]]`, `[[steps]]` with `after`, `isolation`, `inputs`,
`config_options`, `[steps.with]`, `[steps.tools]`, `[steps.budget]`, `[steps.child_step]`. The
property that holds it honest is a round trip: for every fixture the parser's tests already hold and
for every definition the editor can produce, `parseWorkflowToml(write(def))` deep-equals `def` after
both pass `normalizePersistedWorkflow`. Prompts are written as multi-line literal strings so `${…}`
survives without escaping. `smol-toml` has a `stringify`; use it and test the round trip rather than
writing a serialiser by hand.

## Trust

Three stories, kept apart on purpose:

- **A repo file** is executable configuration somebody committed. Starting a run from one calls
  `core.projects.assertConfigTrusted(taskId)`, which hashes every `.acorn/workflows/*.toml` in the
  checkout with `config.toml` and the executable project columns, and fails closed on a change.
  Unchanged.
- **A database row** was typed by the node's owner in this app, behind the device gate. It has no
  bytes to hash and needs none. Starting a run from one skips the snapshot check and records
  `trigger: 'manual'` and `source: 'database'` on the run row.
- **Save to repo** turns the second into the first. The write goes through the task's checkout, the
  snapshot changes, and the next start from the file asks for the acknowledgement it always would.

What a row may name is still checked. A `terminal:run-target` step that names a run target, a
`database:query` step that names a saved query, and an agent step that names a profile are validated
against the project at save time and re-checked at start, because the project can change in between.
A row bound to no project skips the project-specific checks at save and does them at start, when the
task tells it which project.

The `with` table of a contributed kind is rendered (`${inputs.x}` substituted) before the kind sees
it, so a kind never reads a template.

## Frozen at start

`workflow_runs.defJson` keeps being the definition the run executes, frozen at start. A row edited
while a run is live changes nothing about that run. The run pane shows the frozen definition, and a
"Definition has changed since this run" line when the row's `revision` moved. Retry with an edited
prompt patches the frozen copy for that one step, as [04-runs-and-live-state.md](./04-runs-and-live-state.md)
§ Retry says.

## Device preferences

`plugin:workflows:layout:<defId>`: node positions for the canvas, `Record<string, { x: number; y:
number }>`, keyed by node name and rewritten on rename. Device-scoped, never synced, dropped when the
row is deleted. Nothing else about a definition lives on the device; a draft in progress is
component state and is lost on navigation after a confirm.
