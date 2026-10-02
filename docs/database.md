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

The pane is offered only on a task that has one of those sources. `CoreServices.data.configured`
checks whether a connection script is set, the worktree `.env` names `DATABASE_URL`, or the Node's
environment does. It runs no script and opens no socket, so it says there is a database to try, not
that it is up. The plugin's `/available` route answers it for every active task, and the manifest
names that route as the pane's `availability` (docs/panes.md § Contributions). A task-scoped caller
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

## Database pane

The pane supports schema introspection, paged tables/rows, primary-key edits, SQL execution, saved
project-scoped queries, and model-assisted SQL generation from a live or configured schema
description. SQL execution is always treated as a mutation for retry purposes; an ambiguous network
failure is surfaced rather than replayed.

The editor's text is a per-task scratch document (`db_scratch`), because a host-owned document
surface is a route that reads it plus a route that writes it. The host owns the dirty state, the
autosave debounce, ⌘S, and the scroll position, so a half-written query survives closing the pane.
What you meant to keep still goes through **Save**, into the project-scoped saved queries.
In the terminal client the document region is an editable cell field above the plugin's frame.
It autosaves and accepts Ctrl+S, uses the same scratch route, and gives the frame the same document handle; SQL syntax colours
and completion popups are absent there.

`⌘Enter` runs the query. The chord is pressed with focus in the host's editor, so the host resolves it
against the manifest's surface-scoped keybinding, flushes the document, and then delivers the command
to the plugin's frame. The **Execute** button also flushes before reading the live document. Either path reports a failed save or read and does not run SQL. Execute uses the complete trimmed document, with no selection-based execution or automatic retry.

Table and column completions come from the plugin's own node route. The host forwards a position and
renders what comes back. Every judgement about SQL lives in `src/server/completions.ts`: after `FROM`
offer tables, after `alias.` offer that table's columns. The introspected catalog is cached per task pool
inside the core data service. A cold catalog wave shares one SQL statement among concurrent readers.
Its table and column visibility comes from `information_schema`; primary-key membership comes from
`pg_index`. A successful connection refresh, pool retirement, or statement whose final command was
not a plain read or write invalidates the catalog. A held wave fails after invalidation and cannot
publish into the replacement cache. Failed waves can be retried. There is no timed cache expiry, so
DDL performed outside this service requires **Connect** to refresh the catalog.

Core applies the returned row cap before converting cells. Columns, total row count, the final
statement's command, truncation status, and elapsed time retain their driver semantics. The cap
reduces conversion work, but the driver still buffers the full result.

The model-provider capability is optional. If no compatible provider is connected, the database pane
keeps manual SQL available and hides **Generate**. The frame learns which connections exist from a
route on this plugin's node half over `CoreServices.models.available`, ids and labels only. A frame
has no way to read core's connection roster, and it should not get one.

Once the reader starts SQL generation, the modal stays open until the request settles. Dismissing it
while the model is working would let the response replace the host-owned editor after the reader had
returned to it. A failed request leaves the prompt and error visible for another attempt.

## From the command palette

Four commands in the manifest, three of them visible and hanging under a **Database** group. The two
rows that need a route are served by this plugin's own node half.
[command-palette-and-shortcuts.md](./command-palette-and-shortcuts.md) covers how the palette runs a
search, and [plugins.md](./plugins.md) § Command kinds holds the vocabulary.

| Row | Kind | What it does |
| --- | --- | --- |
| Run query | action, no scope | Delivers `execute` to the `database` pane, the same command ⌘Enter delivers |
| Find a saved query | search, task-scoped | `/v1/p/database/palette/queries` answers the saved rows of the task's project; picking one opens the pane and loads the SQL into the editor, and does not run it |
| Generate SQL | input, task-scoped | `/v1/p/database/palette/generate` writes the generated SQL to the task's scratch document, then opens the pane on it |

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

## CLI query

The loaded plugin also declares `acorn plugin database query`. Its `/cli/query` route calls the
same `database.query` capability described below, so the CLI receives a bounded read-only result
instead of reaching the pane's arbitrary SQL editor route. Input is a JSON object with `nodeId`,
`taskId`, `sql`, and optional `maxRows` up to 200. The Node checks task scope before dispatch.
See [CLI commands](./cli.md) for an invocation and [command authoring](./plugin-authoring/cli-commands.md)
for the descriptor contract.

## Workflow steps

This plugin contributes two step kinds to `workflows:step-kind`
([workflows.md](./workflows.md) § Contributed step kinds), and one capability behind them.

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
([integrations.md](./integrations.md) § Model providers); it keeps the name `connectionId` because
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

## Boundaries

Task IDs and worktree paths are revalidated by the Node. The database plugin does not expose
credentials through its routes, and task-scoped agent tools cannot use the interactive database UI
without the explicit tool permission and task scope.

## Scratch limits and recovery

Scratch writes, completion requests, and generated SQL use the shared 2 MiB UTF-8 document limit.
ASCII, multibyte characters, emoji, and combining marks count by encoded bytes. Empty scratch text
is valid. The Node refuses oversized text before replacing `db_scratch`; it does not truncate SQL.
Saved-query, prompt, and model-token limits remain separate contracts. Palette generation commits
before returning its success selection; oversized output returns an error and preserves the row.
The generation modal waits for the host to accept its replacement before dismissing.

The host retains failed dirty text, including oversized edits. Closing and reopening the same
Node/task document restores that draft; equal task IDs on another Node have independent custody.
The desktop retains CodeMirror undo in memory. Device recovery storage can fail or run out of quota;
keep acorn open until the draft saves or export its full text. A retired pane's handle cannot read,
write, or flush the recovered draft through a replacement pane.

A stored scratch row above the limit opens in a recovery state with no editable empty buffer or
execution handle. In the desktop, choose **Export full text** to save every UTF-8 byte through the
host file dialog. The same action exports a live unsent draft. Export reads only the document
fetched through the pane's declared route on its captured Node; the plugin receives no file path or
filesystem grant.

For the terminal client or headless recovery, use the authenticated storage route on the original
Node: `GET /v1/p/database/tasks/<taskId>/scratch` returns `{ text }`, including complete oversized SQL.
Decode the JSON and save the `text` value as UTF-8. Use the Node's pinned transport and a device,
service, or signed credential for that task. A task credential cannot read or replace another task's
scratch row. This route needs no PostgreSQL connection or provider call.

After preserving the export, submit an explicit valid replacement to the same route with `PUT` and
a JSON body of `{ text }`, then reopen the pane. A refused replacement preserves the entire row.
Export and pane retirement make no durable replacement. No migration rewrites oversized rows.

Picking a saved query intentionally replaces the host text and joins desktop undo. A palette scratch
reload, table browse, or modal generation captures the prior host text and replaces it only if that
text still matches when the host admits the write. Later selections and retirement discard held
loads. A conflict retains intervening edits and asks you to select or generate again.
