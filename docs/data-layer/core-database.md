# The core database

This page covers `core.sqlite`: the tables core owns, the shared read models plugins write into, the
merged run list, and task script history. Read it before you add a core table or reach for one from a
plugin. It's part of the [data layer](../data-layer.md).

## Tables

Core owns data that more than one feature shares. The table definitions are in
`packages/node-core/src/server/db/schema.ts`, which also exports the feature-owned query and dashboard
schemas.

| Area | Tables |
| --- | --- |
| Identity and transport | `devices`, `idempotency`, `audit` |
| Workspaces and tasks | `workspaces`, `projects`, `workspace_external_projects`, `tasks`, `task_links`, `task_pulls`, `task_script_attempts` |
| Project configuration and trust | `projects`, `config_acks` |
| Provider registry | `integrations` |
| External item projection | `issues`, `issue_resources`, provider `sync_state` markers |
| Node preferences | `prefs` |
| Schedules | `schedule_state`, `user_schedules`, `schedule_runs` |
| Dashboard measure history | `dashboard_measure_samples` |
| Dashboard authoring | `dashboard_drafts`, `dashboard_revisions` |
| Saved queries | `query_drafts`, `query_revisions`, `query_consumers`, `query_publication_holds` |

- `devices` stores only token hashes.
- `integrations` stores encrypted provider credentials and non-secret provider metadata.
- `task_pulls` stores the pull request relations acorn created for a task, including managed-agent
  provenance. The GitHub mirror stays plugin-owned and disposable.
- `config_acks` stores the exact hash and snapshot of trusted executable repository configuration.
- The schedule tables split state from definition by owner. A schedule core or a plugin declares keeps
  its definition in the registry and only its overrides and run state in `schedule_state`. A
  user-created one is a full row in `user_schedules` ([schedules](../schedules.md)).

Query tables are defined in `packages/node-core/src/server/queries/schema.ts`, and dashboard draft and
revision tables in `packages/node-core/src/server/dashboards/schema.ts`. Draft saves are
compare-and-swap on affected-row counts. Published content and digests are immutable, and revision rows
outlive deleted drafts. A consumer reference blocks deletion, and a saved query a panel uses registers a
consumer record ([the query library](../data-sources.md#workspace-query-library)).

`dashboard_measure_samples` holds one sample per hour bucket per history panel, written by the
`core:sample-measures` schedule ([trends](../dashboards.md)). It's a table, not part of the
`core.dashboards` preference slice, because the slice has a 64 KB cap and this is a growing time
series. Every sample would rewrite and sync the whole slice, and an old client that writes back what it
parsed would erase history. History is data with a retention policy, not a preference.

## External-item read model

`issues`, `issue_resources`, `task_links`, and provider `sync_state` rows are a core-owned shared read
model, not a Linear or Rollbar database. Provider plugins own their remote adapters and write through
`ExternalItemStore`. Task context, linked-item resolution, storage reporting, and several providers read
the same normalized cache. Moving the tables into one provider would either duplicate the cache or make
core join a plugin database, and both break the one-database-per-plugin rule.

The disconnect cascade in `packages/node-core/src/server/db/cascade.ts` removes the core rows keyed to a
disconnected integration. It touches only core tables, because no plugin database has a foreign key
into `integrations`. Each plugin keeps or prunes its own rows.

## Runs

Three parts of the system model "a thing that started, took time, cost money, and ended": workflow runs
and steps in `plugins/workflows.sqlite`, agent sessions and turns in `plugins/agents.sqlite`, and
`schedule_runs` in core. They're merged by a registry, not a table. A plugin declares a `GET` route that
lists its own runs with `ctx.runs.register({ runs })`. Core calls each one with no client attached,
parses the answer, stamps who answered, and merges (`server/runs/registry.ts`,
`@acorn/protocol/runs.ts`). `GET /v1/core/runs` is the merged read, and Settings → Run history draws it.
A task token gets only its task's rows, and a plugin's source route refuses a direct task-confined read.

The row is display-shaped: an id, a title, one of five statuses, start and end, the task, an optional
cost, and one line of detail. Agent sessions report no cost, because it lives per turn inside
`usage_json`. A source that can't answer costs only its own rows, and the answer names it, so a short
list reads as short rather than complete.

Build a core table instead when something outside the owning plugin must cancel a run, or charge it to
a budget shared with another plugin's runs. Both need a row a stranger can write and a lock a stranger
can take. A cross-plugin resource governor would sit beside that table, modeled on
`ProviderRequestScheduler`.

## Task script history

The `tasks` row carries `script_generation` and `script_history_known`. A migrated task has unknown
history, and a new task starts with known, unrequested history. `task_script_attempts` holds attempt
identity, task, phase, generation, lifecycle state and reason, a nullable terminal link and exit code,
timestamps, and a bounded UTF-8 output tail with availability and truncation flags. It stores no script
bodies. The service commits process evidence before task invalidations, and fences updates by identity
and generation.

Attempts survive archive and terminal deletion. Deleting a project deletes its tasks and their attempts.
Status shows at most 50 summaries, and an explicit attempt can read older rows
([durable results](../workspaces-and-tasks.md#durable-task-script-results)).
