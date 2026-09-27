# Workspace and project command set

Status: proposed Phase 3 subtask, 2026-09-27. Read after [Phase 1 discovery](./phase-1-host.md)
and before task creation in [Phase 3](./phase-3-tasks-and-agents.md).

## Why this is its own handoff

Workspaces and projects are not merely lookup flags for `task create`. They are the top of Acorn's
local work hierarchy and are useful to inventory, filter, register, reorganize, and inspect from
monitoring tools. A project belongs to one workspace and names a folder on the Node host. Its name
and path can change; its ID is the durable reference for tasks and scripts. The workspace route
embeds project membership, and the project route owns the full local project record. External
provider projects linked to a workspace are separate mappings, not local project rows.

## Required commands and route mapping

| CLI command | Current Node route | Result and rule |
| --- | --- | --- |
| `workspace list` | `GET /v1/core/workspaces` | All workspace resources with project refs; stable IDs. |
| `workspace show ID` | Same list, ID selection | One resource or `not_found`; no dedicated GET exists. |
| `workspace create --name NAME` | `POST /v1/core/workspaces` | New non-default workspace. |
| `workspace rename ID --name NAME` | `PATCH /v1/core/workspaces/:id` | Read back the updated resource because PATCH returns `{ok:true}`. |
| `workspace remove ID` | `DELETE /v1/core/workspaces/:id` | Explicitly state that projects move to Default and provider mappings are removed; Default cannot be removed. |
| `project list [--workspace ID] [--include-hidden]` | `GET /v1/core/projects` | Local projects, optionally filtered by exact membership and visibility. Do not silently exclude hidden projects in JSON. |
| `project show ID` | `GET /v1/core/projects/:id` | Includes Node-host path, workspace ID, VCS facet, and visibility. |
| `project add --workspace ID --path ABSOLUTE [--name NAME]` | `POST /v1/core/projects` | Registers/imports a local folder; response contains `{project}`. |
| `project rename ID --name NAME` | `PATCH /v1/core/projects/:id` | Identity change. |
| `project move ID --workspace ID` | Same PATCH | Changes membership, not filesystem location. |
| `project hide ID` / `project show-in-list ID` | Same PATCH (`hidden`) | Changes visibility only; `project show` always reads by ID. |
| `project detect ID` | `POST /v1/core/projects/:id/detect` | Refreshes detected facets; it is a write despite its read-like name. |
| `project remove ID` | `DELETE /v1/core/projects/:id` | Deletes the project row, not its folder or worktrees. Explain effects on related task references after inspecting core's current behavior. |
| `project config show ID` | `GET /v1/core/projects/:id/config` | Show effective project configuration with sensitive values redacted as required by the route. |
| `project config set ID --patch-file FILE|-` | `PUT /v1/core/projects/:id/config` | Typed patch for setup, teardown, dev, preview, browser rules, and database schema settings. Validate exact route schema. |

The proposed verbs are deliberately explicit. `project show-in-list` is ungainly; an implementer
may choose `project unhide` if it is clearer, but should keep `show ID` as the read verb. The final
grammar belongs in [interface](./interface.md) and shipped help. Provide `--output json` resources
for every success; do not return bare `{ok:true}` to a pipeline when a current resource can be read.

## Further workspace relationships

`GET` and `PUT /v1/core/workspaces/:id/external-projects` list and replace provider mappings.
Expose these as a separate `workspace external-projects list|replace` command only after the input
format and full-replacement effect are documented. The `replace` command must require a complete
JSON file, show an explicit replacement summary in text mode, and be tested with a connected and a
disconnected provider. It must not infer the mapping from local `project list` or overwrite it from
an incomplete shell pipe. Provider-specific importers remain plugin commands, not part of `project
add`. This is a bounded follow-up within Phase 3, before declaring workspace administration
complete.

## Input and safety contract

- Use a workspace or project ID as the canonical argument. A name lookup is permitted only when
  exactly one result matches on the selected Node. Typed `--workspace -` and `--project -` read a
  single resource with matching `kind` and `nodeId`.
- The `--path` for project registration is on the selected Node. Require an absolute path for a
  remote Node; do not pass the caller's current working directory as a hidden default. If local
  `--path .` is supported, resolve it before dispatch and print the resolved path in the result.
- `remove`, `external-projects replace`, and configuration scripts can have surprising effects.
  Give them direct help text and explicit arguments. In non-interactive mode, no prompt is possible;
  do not let a general `--yes` bypass Node authorization or trust checks. A `--force` flag should
  only exist for a specific documented refusal, never as a universal override.
- Send a UUID `Idempotency-Key` for every mutation and preserve it across retries. Read-after-write
  for PATCH and DELETE must handle a concurrent change or an absent result without inventing
  success. If a write took effect but the follow-up read failed, report the write outcome and ID.

## Acceptance

- Two workspaces with projects of the same name are listed and selected by ID. A project move
  changes the embedded workspace membership and the project row; no folder move occurs.
- Rename and hide/unhide preserve project IDs and tasks. Removing a non-default workspace
  reassigns its projects to Default and removes its external mappings. Removing Default is refused.
- Project registration detects an already registered path consistently. Project removal leaves the
  folder on disk. Tests inspect related tasks and document the actual core behavior before final
  help wording is committed.
- Project config JSON preserves booleans, strings, and arrays. A setup script change follows the
  Node's configuration trust rules. A malformed patch and wrong-Node piped ID fail before a write.
- External mapping replacement, when implemented, rejects incomplete or invalid provider links
  and never changes local project membership.

## Verify before building

- Read `packages/node-core/src/server/routes/projects/workspaces.ts`, `projects.ts`, and
  `packages/node-core/src/server/projects.ts`, plus [workspaces and tasks](../../workspaces-and-tasks.md).
- Read [integrations](../../integrations.md) and the external-project mapping route before
  implementing replacement or describing provider import behavior.
- Run `pnpm lint`, focused workspace/project route tests, and the cross-phase cases in
  [verification](./verification.md).
