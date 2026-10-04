# The database pane

This page covers the SQL editor and the plugin's frame below it, completions, generation, and how the
scratch document is kept and recovered when it's too large.

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

Generation sends the introspected schema, capped at 80,000 characters (`SCHEMA_CHAR_CAP` in
`packages/node-core/src/server/core/data.ts`), and the schema notes and example queries, capped at
16,000 (`GENERATE_MAX_CONTEXT_CHARS` in `plugins/database/src/server/generateSql.ts`). Together they
stay under the model runtime's 100,000-character system prompt limit.

The model-provider capability is optional. If no compatible provider is connected, the database pane
keeps manual SQL available and hides **Generate**. The frame learns which connections exist from a
route on this plugin's node half over `CoreServices.models.available`, ids and labels only. A frame
has no way to read core's connection roster, and it should not get one.

Once the reader starts SQL generation, the modal stays open until the request settles. Dismissing it
while the model is working would let the response replace the host-owned editor after the reader had
returned to it. A failed request leaves the prompt and error visible for another attempt.

## Returning to the pane

The database workspace is saved through the host plugin-state bridge, keyed by Node and task. Returning
renders the table list, filter, result rows, table selection, selected record, unsaved record edits,
and saved-query selection before the connection check finishes. Saved queries start from their cached
list and refresh in the background. Model backends refresh from the Node. The host restores the SQL scratch document.

Results stay as the last explicit read. Returning does not fetch table rows, write SQL into the editor,
or execute a query. Choose a table or press **Run** to read fresh rows. Connection failures keep the
cached content visible. Record writes stay disabled until the connection succeeds. A connection to a
different database clears the previous results and record edits.

The worker also holds the eight most recently visited Node/task workspaces for immediate restoration.
Worker retirement falls back to the host snapshot. Results above the bridge's single-value limit are
split into versioned chunks without truncating cells. A partial or incompatible snapshot is ignored.
The restoration limit is 32 MiB of serialized workspace text. SQL scratch and saved queries keep their
own durable storage.

The selected record fills the result area with a scrolling, padded form. Closing it returns to the
result grid. Field spacing and the form width use the shared kit's layout tokens.

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
