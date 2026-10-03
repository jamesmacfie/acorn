# Database commands and workflow steps

This page covers the database plugin's palette rows and its two workflow step kinds, with the
read-only `database.query` capability behind them.

## From the command palette

Four commands in the manifest, three of them visible and hanging under a **Database** group. The two
rows that need a route are served by this plugin's own node half.
[Command palette and shortcuts](../command-palette-and-shortcuts.md) covers how the palette runs a
search, and [command kinds](../plugins.md#command-kinds) holds the vocabulary.

| Row | Kind | What it does |
| --- | --- | --- |
| Run query | action, no scope | Delivers `execute` to the `database` pane, the same command ⌘Enter delivers |
| Find a saved query | search, task-scoped | `/v1/p/database/palette/queries` answers the saved rows of the task's project; picking one opens the pane and loads the SQL into the editor, and does not run it |
| Generate SQL | input, task-scoped | `/v1/p/database/palette/generate` writes the generated SQL to the task's scratch document, then opens the pane on it |

Both routes are task-scoped although a saved query belongs to a project, and that is the boundary
rather than a convenience: every saved-query route in this plugin is addressed through a task, because
the task is what core resolves a project from. The host sends the task the palette session captured; a
manifest names the scope and never the value. Ranking is a pure function in
`plugins/database/src/server/paletteSearch.ts`. A name beats a note, a note beats the SQL, and equal
matches keep the order the pane's own picker lists them in. The SQL tier is there because the query
somebody wants is often the one that touches a table, and the table name is nowhere but in the
statement. No row can carry a credential: a saved query is a name, a note and SQL somebody wrote down,
and the connection URL is resolved per connect and never persisted.

**Run query** is a `surfaceAction`, and it keeps the id `execute` and the ⌘Enter chord it had before
the palette existed. The id is what a stored override is keyed on, the chord is what muscle memory is
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
asks for the connection list *before* it introspects the schema, because "nothing is connected" is the
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
and `database` is already the pane's id, and a group cannot be named after the surface it is about.

## Workflow steps

This plugin contributes two step kinds to `workflows:step-kind`
([contributed step kinds](../workflows/step-kinds.md)), and one capability behind them.

`database.query` (`plugins/database/src/contract/query.ts`) is the plugin's cooperative capability
over `CoreServices.data.query`, with a 200-row cap and an early read-only refusal applied. Core also
runs it in a read-only Postgres transaction, so the text check is an actionable error and the host
transaction is the enforcement boundary. Its result is
`{ columns, rows, rowCount, truncated }`, capped at 200 rows. It connects the task's pool itself when
nothing has, because a step has no pane to have pressed **Connect** in.

**`database:query`** takes either a `savedQueryId` or inline `sql`, and refuses a step that sets both
or neither. A saved query id is resolved inside the task's own project, so an id from another
repository does not run here. **`database:generate`** takes a `prompt` and a `connectionId`, asks the
model for SQL through the same prompt builder the pane uses, and runs it. That field holds a backend
id, which may name an installed agent CLI as readily as a connected key
([model providers](../integrations/model-providers.md)); it keeps the name `connectionId` because
every step already saved holds its pick under that key, and its label reads "Generate with". Its output carries the SQL
as well as the rows, and a generated write fails the step with the SQL in the message, because what
the reader needs to see is what the model thought it was asked for.

Both refuse a result over 256 KB of JSON. A step's output is interpolated into the next step's
prompt, so a result too big to read is a failure rather than something quietly cut in half.

The read-only rule reads the leading keyword of each statement and, for a `WITH`, refuses a write
anywhere in the body, which is how PostgreSQL lets a statement that starts like a read change data. It
is a guard over authored SQL, not a sandbox: a function called from a `SELECT` can still write, and
catching that needs the host's read-only transaction. The plugin also holds `data:write` for the
interactive pane, but the workflow bridge explicitly requests read-only execution, so that grant
cannot silently make a workflow statement writable.

`database:generate` spends a model connection, so the plugin declares the `identity` core facet: a
step has no request to read an owner from, and a connection is spent as somebody.
`GET /v1/p/database/projects/:projectId/saved-queries` answers the saved-query picker's options and
refuses a task-confined caller, because a project id is guessable and no task in the path means no
scope gate.
