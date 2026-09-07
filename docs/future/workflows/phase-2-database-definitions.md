# Phase 2: definitions in the database

Status: not started. Waits on phase 0. Can run beside phase 1.

## Goal

A workflow can be stored as a row in the workflows plugin's database, scoped to a workspace and
optionally a project, listed beside the repo files, started by id, and written back into the repo
as TOML.

## Why this phase, and why now

The editor needs somewhere to write, and the orchestration analysis already decided the shape:
database truth merged under the repo layer, repo wins on id, TOML never moves. This phase is that
decision built.

## Scope

In: everything in [06-storage-and-trust.md](./06-storage-and-trust.md). The palette's "Run a
workflow" reads the merged list and opens the start dialog when inputs are required.

Out: the editor (phase 3); triggers or schedules for rows (refused for this programme).

## Design detail

**Table and migration.** `workflowDefs` in `plugins/workflows/src/node/schema.ts`; a generated
migration `0001` beside `0000_funny_prism.sql`, produced by `scripts/db.mjs` and committed with its
snapshot.

**The store.** `plugins/workflows/src/server/workflowDefs.ts` (new): `list(workspaceId)`, `get(id)`,
`create`, `update(id, def, revision)` with the 409 on a stale revision, `remove`, and
`mergedList(workspaceId, projects)` that folds the rows with `loadWorkflowFiles` per project and the
user layer, applying the id precedence.

**Routes.** `plugins/workflows/src/server/routes/defs.ts` (new), mounted on the same namespace root
as `workflow.ts`, every handler behind `requireDevice`. The start route in `workflow.ts` accepts
`defId` and resolves it through the store or the file loader.

**Save to repo.** `plugins/workflows/src/server/workflowToml.ts` (new) with `writeWorkflowToml(def)`
over `smol-toml`'s `stringify`, and the round-trip test. The route resolves the checkout with
`core.tasks.resolveCwd` for the given task or `project.path` otherwise, refuses a path outside
`.acorn/workflows/`, and writes atomically.

**Client.** `plugins/workflows/src/client/workflowsClient.ts` gains the route builders and calls.
`commands.ts` reads the merged list and, when the picked definition declares a required input,
opens the start dialog from phase 3; until phase 3 lands it refuses with "this workflow needs inputs;
run it from the editor".

**Events.** `plugin:workflows:defs-changed` on every write, declared in the plugin's `emits`.

## Code touched

- `plugins/workflows/src/node/schema.ts`, `plugins/workflows/migrations` (a new `0001` migration).
- `plugins/workflows/src/server/workflowDefs.ts` (new), `plugins/workflows/src/server/routes/defs.ts` (new),
  `plugins/workflows/src/server/workflowToml.ts` (new).
- `plugins/workflows/src/server/routes/workflow.ts`: `defId` on start.
- `plugins/workflows/src/node/index.ts`: the store, the routes, the event.
- `plugins/workflows/src/client/workflowsClient.ts`, `plugins/workflows/src/client/commands.ts`.
- `packages/protocol/src/workflow.ts`: `WorkflowDefRow`, `source: 'database'` on the summary.
- `apps/node/test/integration/routeRegistry.snapshot.json`: regenerated.

## Tests

- `plugins/workflows/src/server/workflowDefs.test.ts` (new): create, get, update with a stale
  revision refused, delete; merged list precedence (repo over user over database on one id);
  a row bound to a project appears only for that project's tasks.
- `plugins/workflows/src/server/workflowToml.test.ts` (new): round trip over every parser fixture
  and over a definition using every field the model declares; a multi-line prompt with `${…}`
  survives.
- `plugins/workflows/src/server/routes/workflow.test.ts`: a device caller may write, a task-confined
  caller may not; start by `defId` resolves a row and a `repo:` id; save-to-repo refuses a path
  outside the folder.

## Docs owed

`docs/workflows.md` § Execution model (two stores, one read) and a new § Database definitions;
`docs/data-layer.md` § Plugin databases; `docs/security.md` § Process, path, and configuration
controls (owner-typed rows, save to repo re-enters the snapshot); `docs/api-reference.md`;
`docs/future/orchestration.md` step 9 marked done.

## Doors left open

- Rows shared across workspaces, if a node with several workspaces wants one library.
- A trigger on a row. The `trigger` column is on the run, not the definition, so nothing has to
  move; the sweep would need to read rows as well as files.

## Done when

- A row created through the route appears in the palette beside the repo files, starts a run, and
  the run's `defJson` equals the row's `defJson`.
- Save to repo writes a file the loader reads back to the same definition, and the next start from
  that file asks for the trust acknowledgement.

## Verify before building

- `plugins/workflows/src/node/schema.ts` still has two tables.
- The start route still accepts only `{ def }`.
- `loadWorkflowFiles(repoDir, userDir, catalog)` still returns `{ workflows, errors }` with
  `source: 'repo' | 'user'`.
- `smol-toml` at the version in `plugins/workflows/package.json` exports `stringify`.
- `scripts/db.mjs` still finds a plugin's `drizzle.config.ts` by scanning.
