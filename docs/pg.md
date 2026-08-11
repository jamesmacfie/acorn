# PostgreSQL tools

The database plugin provides a task-scoped PostgreSQL browser and SQL editor. It does not make
PostgreSQL data part of acorn's SQLite model.

It ships as a **loaded package**, not compiled in — `plugins/database/acorn-plugin.config.mjs` is its
declaration. That matters here for one reason: the SQL editor is not the plugin's. The pane declares a
`document-over-frame` layout, so the host draws the editor and this plugin supplies the document through
two of its own routes (`docs/plugins.md` § Document surfaces). Everything below the drag handle — the
table sidebar, the button bar, the result grid, the row detail and the two modals — is the plugin's
frame.

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

The editor's text is a per-task **scratch document** (`db_scratch`), because a host-owned document
surface is defined by a route that reads it and a route that writes it. The host owns the dirty state,
the autosave debounce, ⌘S and the scroll position; a half-written query therefore survives closing the
pane. What you meant to keep still goes through Save, into the project-scoped saved queries.

`⌘Enter` runs the query. The chord is pressed with focus in the host's editor, so the host resolves it
against the manifest's surface-scoped keybinding, **flushes the document**, and then delivers the
command to the plugin's frame — which means the statement that runs is always the one on screen.

Table and column completions come from the plugin's own node route. The host forwards a position and
renders what comes back; every judgement about SQL — after `FROM` offer tables, after `alias.` offer
that table's columns — is `src/server/completions.ts`. The introspected catalog is cached per task and
dropped on connect, on disconnect, and after any statement whose command was not a plain read or write,
so a migration run in the editor does not leave stale columns in the popup.

The model-provider capability is optional. If no compatible provider is connected, the database pane
keeps manual SQL available and hides Generate. The frame learns which connections exist from a route on
this plugin's node half over `CoreServices.models.available` — ids and labels only. A frame has no way
to read core's connection roster, and it should not get one.

## Boundaries

Task IDs and worktree paths are revalidated by the Node. The database plugin does not expose
credentials through its routes, and task-scoped agent tools cannot use the interactive database UI
without the explicit tool permission and task scope.
