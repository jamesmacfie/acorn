# Database plugin

The database plugin is a task-scoped PostgreSQL browser and SQL editor. It doesn't make PostgreSQL data
part of acorn's SQLite model. Read this page for how the Node finds and holds a connection, the SQL
safety rules, and the topic pages. The plugin is in `plugins/database/`.

It ships as a loaded package, declared in `plugins/database/acorn-plugin.config.mjs`. The SQL editor
isn't the plugin's: the pane declares a `document-over-frame` layout, so the host draws the editor and
the plugin supplies the document through two of its own routes
([document surfaces](./plugins.md#document-surfaces)). Everything below the drag handle is the plugin's
host-drawn tree: the table sidebar, the button bar, the result grid, the row detail, and two modals.

## Connection resolution

The Node resolves a task's connection URL from trusted repository configuration, the task worktree
`.env`, and the Node environment according to the configured precedence. A URL-producing script is
executable repository configuration and requires the exact config-trust acknowledgement. The
connection URL is never sent to the renderer or stored in plugin rows.

The pane is offered only on a task that has one of those sources. `CoreServices.data.configured`
checks whether a connection script is set, the worktree `.env` names `DATABASE_URL`, or the Node's
environment does. It runs no script and opens no socket, so it says there is a database to try, not
that it is up. The plugin's `/available` route answers it for every active task, and the manifest
names that route as the pane's `availability` ([pane contributions](./panes/contributions.md)). A task-scoped caller
gets `403`, because the answer lists every task.

Pools are task-scoped and owned by `CoreServices.data`. Core resolves the URL, opens the `pg` socket,
normalizes cells, and enforces timeouts and row caps. Concurrent implicit readers share one pending
connection. Explicit **Connect** requests resolve the source in sequence, so each refresh reads the
script or `.env` again. A successful refresh replaces the task pool. A failed refresh leaves a
previously established pool available.

Each granted data service holds its own claim on the shared task pool. The Database plugin records
pending connections before awaiting them. **Disconnect** and plugin disposal revoke that plugin's
claim and explicit connection state, including pending operations. Another granted consumer or a
headless core caller can retain the pool independently of whether a pane is drawn. Releasing the last
claim retires the pool; the unscoped core service's disconnect retires every claim for the task.
Retirement refuses readers waiting for admission, and lets already admitted queries finish their
transaction and release their client before closing the pool. Late connection completions cannot
restore a retired plugin's state. The loaded plugin receives no URL, driver, socket, project-config grant,
`DATABASE_URL` environment grant, or process broker.

HTTP routes compare task IDs in CLI bodies, palette queries, and context requests with the verified
principal carried by the host. A task credential can address only its signed task. Missing or foreign
query scope returns `404 not_found` before task lookup, saved-query reads, SQL, or auto-connect.
Device and service credentials retain access to any task; an absent task returns the same `404`.

The plugin declares `secrets: false`, and that is not an oversight: because the URL is resolved per
connect and never persisted, there is no credential at rest for the host secret service to hold.
Instead it declares `data:query` and `data:write`. The first grants host-mediated reads and schema
introspection. The second is a separate high-risk line because the existing pane deliberately
supports primary-key edits and arbitrary SQL.

## SQL safety

Every value that reaches Postgres is parameterized. Identifiers (schema, table and column names)
cannot be parameterized, so every identifier a route builds SQL from is checked against the live
introspected schema (`assertTable`, `assertColumns` in `server/database.ts`) and double-quoted before
use. Arbitrary SQL typed into the editor runs verbatim: it is the reader's own database, and writes
are the point of the pane.

## Boundaries

Task IDs and worktree paths are revalidated by the Node. The database plugin does not expose
credentials through its routes, and task-scoped agent tools cannot use the interactive database UI
without the explicit tool permission and task scope.

## CLI query

The loaded plugin also declares `acorn plugin database query`. Its `/cli/query` route calls the
same `database.query` capability the workflow steps use ([workflow steps](./database/palette-and-workflows.md#workflow-steps)), so the CLI receives a bounded read-only result
instead of reaching the pane's arbitrary SQL editor route. Input is a JSON object with `nodeId`,
`taskId`, `sql`, and optional `maxRows` up to 200. The Node checks task scope before dispatch.
See [CLI commands](./cli.md) for an invocation and [command authoring](./plugin-authoring/cli-commands.md)
for the descriptor contract.

## Pages

<a id="database-pane"></a>
<a id="scratch-limits-and-recovery"></a>

- [The database pane](./database/pane.md): the editor, completions, generation, and scratch recovery.

<a id="from-the-command-palette"></a>
<a id="workflow-steps"></a>

- [Commands and workflow steps](./database/palette-and-workflows.md): palette rows, `database:query`,
  and `database:generate`.
