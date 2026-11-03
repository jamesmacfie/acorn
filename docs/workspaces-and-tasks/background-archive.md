# Archive in the background

Archiving a task runs the project's teardown script first, and that script can run for a minute or
more ([archive steps](./archive.md#archive-a-task)). The broker gives a request 30 seconds, so
clients start the archive and read its outcome in separate requests.

A client archives through `POST /v1/core/tasks/:id/archive-run`, which takes the same options as
`/archive`. The Node answers 202 with `{ state: 'running' }` as soon as it starts, and runs the archive
steps afterwards. The client then calls `GET /v1/core/tasks/:id/archive-run?waitMs=20000` until the
answer is `{ state: 'finished', result }`, where `result` is what `/archive` would have answered. Each
call holds for up to 20 seconds, so no one request runs into the broker's 30-second deadline, however
long the teardown script takes. Before this route, a slow teardown made the browser sidebar report
that the Node might not have archived the task, when it had.

A second start for a task whose archive is still running joins that archive. The Node keeps a
finished outcome for 10 minutes, so every waiting client can read it. The record lives in memory only,
so after a restart the wait answers `{ state: 'none' }`, and the client says the Node lost track of the
archive. `archiveInBackground` in `packages/protocol/src/projects/task.ts` is the client side, shared
by the desktop and the browser bridge. Against a Node without these routes it falls back to the single
`POST /archive`.

`POST /archive` still archives in one request, for older clients and for plugins that call it.
