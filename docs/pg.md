# PostgreSQL tools

The database plugin provides a task-scoped PostgreSQL browser and SQL editor. It does not make
PostgreSQL data part of acorn's SQLite model.

## Connection resolution

The Node resolves a task's connection URL from trusted repository configuration, the task worktree
`.env`, and the Node environment according to the configured precedence. A URL-producing script is
executable repository configuration and requires the exact config-trust acknowledgement. The
connection URL is never sent to the renderer or stored in plugin rows.

Connections are leased through the core PostgreSQL broker. Pools are task-scoped and closed when the
task/runtime is disposed.

## Database pane

The pane supports schema introspection, paged tables/rows, primary-key edits, SQL execution, saved
repository-scoped queries, and model-assisted SQL generation from a live or configured schema
description. SQL execution is always treated as a mutation for retry purposes; an ambiguous network
failure is surfaced rather than replayed.

The model-provider capability is optional. If no compatible provider is connected, the database pane
keeps manual SQL available and reports generation as unavailable.

## Boundaries

Task IDs and worktree paths are revalidated by the Node. The database plugin does not expose
credentials through its routes, and task-scoped agent tools cannot use the interactive database UI
without the explicit tool permission and task scope.
