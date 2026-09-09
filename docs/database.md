# Database plugin

The database plugin provides a task-scoped PostgreSQL browser and SQL editor. It does not make
PostgreSQL data part of acorn's SQLite model.

It ships as a loaded package, not compiled in, and `plugins/database/acorn-plugin.config.mjs` is its
declaration. That matters here for one reason: the SQL editor is not the plugin's. The pane declares a
`document-over-frame` layout, so the host draws the editor and this plugin supplies the document through
two of its own routes (`docs/plugins.md` § Document surfaces). Everything below the drag handle is the
plugin's frame: the table sidebar, the button bar, the result grid, the row detail, and the two
modals.

## Connection resolution

The Node resolves a task's connection URL from trusted repository configuration, the task worktree
`.env`, and the Node environment according to the configured precedence. A URL-producing script is
executable repository configuration and requires the exact config-trust acknowledgement. The
connection URL is never sent to the renderer or stored in plugin rows.

Pools are task-scoped, opened by the plugin's own node half, and closed when the plugin is disposed.
The plugin declares `secrets: false`, and that is not an oversight: because the URL is resolved per
connect and never persisted, there is no credential at rest for the host secret service to hold.

## Database pane

The pane supports schema introspection, paged tables/rows, primary-key edits, SQL execution, saved
project-scoped queries, and model-assisted SQL generation from a live or configured schema
description. SQL execution is always treated as a mutation for retry purposes; an ambiguous network
failure is surfaced rather than replayed.

The editor's text is a per-task scratch document (`db_scratch`), because a host-owned document
surface is a route that reads it plus a route that writes it. The host owns the dirty state, the
autosave debounce, ⌘S, and the scroll position, so a half-written query survives closing the pane.
What you meant to keep still goes through **Save**, into the project-scoped saved queries.

`⌘Enter` runs the query. The chord is pressed with focus in the host's editor, so the host resolves it
against the manifest's surface-scoped keybinding, flushes the document, and then delivers the command
to the plugin's frame. The statement that runs is always the one on screen.

Table and column completions come from the plugin's own node route. The host forwards a position and
renders what comes back. Every judgement about SQL lives in `src/server/completions.ts`: after `FROM`
offer tables, after `alias.` offer that table's columns. The introspected catalog is cached per task
and dropped on connect, on disconnect, and after any statement whose command was not a plain read or
write, so a migration run in the editor does not leave stale columns in the popup.

The model-provider capability is optional. If no compatible provider is connected, the database pane
keeps manual SQL available and hides **Generate**. The frame learns which connections exist from a
route on this plugin's node half over `CoreServices.models.available`, ids and labels only. A frame
has no way to read core's connection roster, and it should not get one.

## From the command palette

Four commands in the manifest, three of them visible and hanging under a **Database** group. The two
rows that need a route are served by this plugin's own node half.
[command-palette-and-shortcuts.md](./command-palette-and-shortcuts.md) covers how the palette runs a
search, and [plugins.md](./plugins.md) § Command kinds holds the vocabulary.

| Row | Kind | What it does |
| --- | --- | --- |
| Run query | action, no scope | Delivers `execute` to the `database` pane, the same command ⌘Enter delivers |
| Find a saved query | search, task-scoped | `/v2/p/database/palette/queries` answers the saved rows of the task's project; picking one opens the pane and loads the SQL into the editor, and does not run it |
| Generate SQL | input, task-scoped | `/v2/p/database/palette/generate` writes the generated SQL to the task's scratch document, then opens the pane on it |

Both routes are task-scoped although a saved query belongs to a project, and that is the boundary
rather than a convenience: every saved-query route in this plugin is addressed through a task, because
the task is what core resolves a project from. The host sends the task the palette session captured; a
manifest names the scope and never the value. Ranking is a pure function in
`plugins/database/src/server/paletteSearch.ts` — a name beats a note, a note beats the SQL, and equal
matches keep the order the pane's own picker lists them in. The SQL tier is there because the query
somebody wants is often the one that touches a table, and the table name is nowhere but in the
statement. No row can carry a credential: a saved query is a name, a note and SQL somebody wrote down,
and the connection URL is resolved per connect and never persisted.

**Run query** is a `surfaceAction`, and it keeps the id `execute` and the ⌘Enter chord it had before
the palette existed — the id is what a stored override is keyed on, the chord is what muscle memory is
keyed on. What it lost is the `Database: ` prefix, which the group above it now says. It names no
scope of its own; the device offers it when this plugin draws the `database` pane's own region,
because that region is what receives the event.

`Database: open pane` stays out of the group and keeps its long title. It declares `palette: false`,
so the only place that title is ever read is the shortcut editor, where it stands on its own next to
⌘⇧J with no group above it to say the word "Database".

**Generate SQL** is the modal with all three of its choices already made: the first available model
connection, that provider's own default model, and no worked examples. The order the route works in is
deliberate. It validates the prompt against the same bound the modal's textarea enforces, requires an
interactive owner because generation spends that owner's provider key, resolves the task, and then
asks for the connection list *before* it introspects the schema — "nothing is connected" is the
cheaper of the two answers and the more actionable one. The scratch write commits before the route
answers success, because the success action opens the pane and the pane's editor reads the scratch
route on mount; answering first would race the reader to their own result. Every failure returns
before the write, so the prompt survives with the reason under it and the reader can retry. The full
**Generate** modal is unchanged, and remains the way to choose a connection, a model or examples.

Success answers with the row id `#scratch` rather than a saved query's id, and the panel reads that
one id as "re-read the scratch document". A pane that was closed loads the new SQL from the read route
anyway; a pane already open would otherwise keep the text its editor had loaded, and the fast path
would appear to do nothing for the reader most likely to use it. Loading generated SQL is not running
it, exactly as picking a saved query is not.

Row insert, update and delete are deliberately not commands, and neither is arbitrary destructive SQL:
they need the grid, the row in front of you and a visible connection, which a palette row does not
have. The fast path exposes no provider, model or example selection either. One text field cannot
carry three choices, and giving it a way to would be a second, worse copy of the modal.

The group's id is `db` and not `database` because contribution ids are unique across a whole manifest
and `database` is already the pane's id — a group cannot be named after the surface it is about.

## SQL safety

Every value that reaches Postgres is parameterized. Identifiers (schema, table and column names)
cannot be parameterized, so every identifier a route builds SQL from is checked against the live
introspected schema (`assertTable`, `assertColumns` in `server/database.ts`) and double-quoted before
use. Arbitrary SQL typed into the editor runs verbatim: it is the reader's own database, and writes
are the point of the pane.

## Workflow steps

This plugin contributes two step kinds to `workflows:step-kind`
([workflows.md](./workflows.md) § Contributed step kinds), and one capability behind them.

`database.query` (`plugins/database/src/contract/query.ts`) is the bridge's own query with a row cap
and a read-only refusal applied. One path, so a caller cannot forget either. Its result is
`{ columns, rows, rowCount, truncated }`, capped at 200 rows. It connects the task's pool itself when
nothing has, because a step has no pane to have pressed **Connect** in.

**`database:query`** takes either a `savedQueryId` or inline `sql`, and refuses a step that sets both
or neither. A saved query id is resolved inside the task's own project, so an id from another
repository does not run here. **`database:generate`** takes a `prompt` and a `connectionId`, asks the
model for SQL through the same prompt builder the pane uses, and runs it. That field holds a backend
id, which may name an installed agent CLI as readily as a connected key
([integrations.md](./integrations.md) § Model providers); it keeps the name `connectionId` because
every step already saved holds its pick under that key, and its label reads "Generate with". Its output carries the SQL
as well as the rows, and a generated write fails the step with the SQL in the message, because what
the reader needs to see is what the model thought it was asked for.

Both refuse a result over 256 KB of JSON. A step's output is interpolated into the next step's
prompt, so a result too big to read is a failure rather than something quietly cut in half.

The read-only rule reads the leading keyword of each statement and, for a `WITH`, refuses a write
anywhere in the body, which is how PostgreSQL lets a statement that starts like a read change data. It
is a guard over authored SQL, not a sandbox: a function called from a `SELECT` can still write, and
catching that needs a read-only transaction. That transaction is the seam `database:write` would
open, and `database:write` is deferred.

`database:generate` spends a model connection, so the plugin declares the `identity` core facet: a
step has no request to read an owner from, and a connection is spent as somebody.
`GET /v2/p/database/projects/:projectId/saved-queries` answers the saved-query picker's options and
refuses a task-confined caller, because a project id is guessable and no task in the path means no
scope gate.

## Boundaries

Task IDs and worktree paths are revalidated by the Node. The database plugin does not expose
credentials through its routes, and task-scoped agent tools cannot use the interactive database UI
without the explicit tool permission and task scope.
