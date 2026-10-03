# Plugin routes

This page lists the route families each first-party plugin mounts under `/v1/p/<plugin>`, except the
workflows plugin, which has [its own page](./workflow-routes.md). It's part of the
[API reference](../api-reference.md).

A plugin's routes mount under its registry namespace. A router that names its own top-level segment
repeats it, so a literal path can carry the plugin name twice, as in `/v1/p/memory/memory`. The route
builders in `@acorn/protocol/api.ts` and each plugin's `shared/api.ts` are authoritative.
`apps/node/test/integration/routeRegistry.snapshot.json` is the golden list of every compiled plugin
route. A loaded plugin's routes reach the server through the fetch dispatcher and aren't in it.

The task-scope gate covers `/v1/p/<plugin>/tasks/:id` and everything under it. A route addressed by
another id, such as a session or a run, checks scope in its own handler
([transport and authentication](../security/transport-and-auth.md#task-scope)).

## GitHub

| Path family | Purpose |
| --- | --- |
| `/v1/p/github/auth/device/start`, `/poll` | OAuth device flow. Device-only |
| `/v1/p/github/import` | Import a GitHub repository as a project. Device-only |
| `/v1/p/github/pins` | Pinned repositories |
| `/v1/p/github/repos`, `/repos/refresh` | The repository mirror and its refresh |
| `/v1/p/github/repos/:owner/:repo/pulls` | Pull request lists, and create a pull request |
| `/v1/p/github/repos/:owner/:repo/pulls/batch` | Prefetch several pulls at once |
| `/v1/p/github/repos/:owner/:repo/pulls/:number` | Detail, `files`, `diff`, `conflicts`, and the write actions |
| `/v1/p/github/repos/:owner/:repo/compare` | A compare preview between two refs |
| `/v1/p/github/repos/:owner/:repo/diff/segments`, `/diff/search` | Diff segments and search for a pull or compare |
| `/v1/p/github/repos/:owner/:repo/blobs/:sha`, `/branches` | New-side file bodies, and branch names |
| `/v1/p/github/repos/:owner/:repo/actions/*` | Actions jobs, logs, and rerun |
| `/v1/p/github/repos/:owner/:repo/labels`, `/mentions` | Label choices and mention candidates |
| `/v1/p/github/tasks/:taskId/pulls` | Pull request relations acorn created for a task |

The write actions on a pull are `close`, `reopen`, `merge`, `draft`, `auto-merge`, `labels`,
`requested-reviewers`, `comments`, `review-comments` and their replies, `reviews`, thread `resolve`,
and `viewed`. Reads use the plugin's SQLite mirror with TTL and ETag revalidation, and patch and file
bodies use the shared blob cache ([caching](../caching.md)). A write updates or invalidates the
mirror it touched.

The pull request reads, with types in `plugins/github/src/shared/api.ts`:

| Route | Answer |
| --- | --- |
| `GET …/pulls/:number` | `PullDetail`, with every GraphQL connection exhausted and child lists in GitHub's order |
| `GET …/pulls/:number/files` | `PullFilesResponse`: `{ files, completeness }`, files in `position` order with patch bodies |
| `GET …/pulls/:number/files?summary=1` | The same, with `patch: null` on every file and no blob reads |
| `GET …/pulls/:number/files?path=P` | The same, holding that one file when the pull has it |
| `GET …/pulls/:number/diff` | `PullDiffResponse`: `{ document, completeness }`, a diff document with no patch text |
| `POST …/pulls/batch` | `PullBatchItem[]`: `{ number, detail, files? }`. `files` is absent for mode `none` or a failed files refresh |
| `GET …/compare?base=&head=` | `Compare`: `{ aheadBy, document, completeness, commits }` |
| `POST …/diff/segments` | `DiffSegmentPayload[]` for one to 32 `{ path, patchKey, ordinal }` requests, in request order |
| `POST …/diff/search` | `DiffSearchPage`: up to 500 matches over the named `files`, reading at most 1,000 segments, with a `nextCursor` |

`completeness` is `PullTopologyCompleteness`. `{ kind: 'complete' }` means the list is everything
GitHub has. `{ kind: 'incomplete', cause: 'upstream-cap', resource, received, reportedTotal, limit }`
means GitHub's ceiling cut it short: `files` at 3,000 or `compare-files` at 300. A failed refresh
isn't incomplete. The route serves the previous mirror stale, or fails cold.

`PullFile` has `position`, its zero-based place in GitHub's list, and `patchState`. With
`patchState: 'available'`, `patchKey` is the `sha256:<hex>` digest of the patch, and `patch` is the
body unless the read was a summary. With `'unavailable'`, both are null. `sha` stays the new-side
blob, for `blobs/:sha`. `?force=true` on the detail, files, and diff reads blocks on a full refresh.
A batch refresh that fails with `401`, `403`, or `429` fails the batch. Any other failure keeps that
pull's previous mirror.

A diff document is `DiffDocumentTopology` from `@acorn/diff-document`
([diff-rendering.md](../diff-rendering/document.md#the-document)). A segment request's `patchKey` must be a
digest this Node holds, or it answers `404 segment_not_found`. An ordinal past the file's last segment
answers `400 bad_ordinal`, and more than 32 requests, none, or a malformed body answers
`400 bad_request`. A search body is `{ query, caseSensitive, cursor, files }`, with a query of at most
256 characters and at most 5,000 files. A cursor this Node didn't write answers `400 bad_cursor`. The
query is never logged. A path in either body is at most 4,096 characters.

## Agents

| Path family | Purpose |
| --- | --- |
| `/v1/p/agents/providers`, `/session-defaults` | Harness and profile roster, and new-session defaults |
| `/v1/p/agents/custom-agents[/:id]` | Custom agent definitions |
| `/v1/p/agents/mcp-servers[/:name][/test]` | The owner's MCP servers. Device-only ([MCP](../mcp.md#your-own-servers)) |
| `/v1/p/agents/sessions`, `/sessions/search` | Session list and transcript search |
| `/v1/p/agents/sessions/:id` | One session, its `events`, `artifacts`, `mcp`, `export`, and `wait` |
| `/v1/p/agents/sessions/:id/turns[/:turnId]` | Queue, edit, or remove a turn |
| `/v1/p/agents/sessions/:id/requests/:requestId/resolve` | Answer a permission or question request |
| `/v1/p/agents/sessions/:id/{cancel,fork,compact}` | Session controls |
| `/v1/p/agents/sessions/:id/{handoff-terminal,implement-plan,regenerate-title}` | Session actions |
| `/v1/p/agents/sessions/:id/{resume-managed,verify-imported-resume}`, `/transcript-imports` | Resume and transcript import |
| `/v1/p/agents/attachments[/:id][/content]`, `/artifacts/:id[/content]` | Attachments and artifacts |
| `/v1/p/agents/usage[/refresh[/:providerId]]`, `/pricing`, `/concurrency` | Plan usage, pricing, and the runtime ceiling |
| `/v1/p/agents/footprint`, `/stop-idle`, `/runs` | Process footprint, the idle stop, and the run source |

Sessions persist normalized event history and expose paged reads plus live WebSocket updates.
`GET /v1/p/agents/sessions` also returns a bounded `delegations` projection for the sessions in that
page: the child session, depth, isolation, and either its managed parent or a display-safe terminal
owner label. The spawn authority row isn't returned. Session creation, turn enqueue, and request
resolution need an `Idempotency-Key`.

Orchestration uses the ordinary task tool routes. `GET /v1/core/tasks/:id/tools` lists
`agent_spawn`, `agent_prompt`, `agent_wait`, `agent_read`, and `agent_cancel` only for a task
principal with a signed session claim and the execute permission. A direct-child authorization
failure looks like an unknown session and returns 404.

## Terminal, changes, editor, and Docker

| Path family | Purpose |
| --- | --- |
| `/v1/p/terminal/sessions`, `/profiles` | Session roster, creation, and shell profiles |
| `/v1/p/terminal/sessions/:sid/{send,resize,interrupt,kill,remove}` | Session control. The handler checks the owning task |
| `/v1/p/terminal/tasks/:taskId/run-targets` | Run target options for a workflow step field |
| `/v1/p/changes/tasks/:id/local/*` | Status, stage, unstage, discard, commit, fetch, pull, push, abort, the diff document, and a model-written commit message |
| `/v1/p/changes/tasks/:id/review-notes[/:noteId][/sent]` | Review notes |
| `/v1/p/editor/tasks/:id/editor/*` | File reads, writes, listings, images, and line markers |
| `/v1/p/editor/tasks/:id/search` | Search a task's files |
| `/v1/p/docker/*` | Node inventory: containers, images, volumes, networks, compose, prune, and `info` |
| `/v1/p/docker/tasks/:id/containers`, `/teardown` | Task containers and their cleanup |

The terminal plugin owns session control and stream attachment. Core owns worktrees and run-target
execution. Global Docker actions require a device ([Docker](../docker.md)).

The Changes pane reads its diff as a document, one staging area at a time, with types in
`plugins/changes/src/shared/api.ts` ([diff-rendering.md](../diff-rendering/document.md#data-flow)):

| Route | Body | Answer |
| --- | --- | --- |
| `POST …/local/document` | `{ scope, files: { path, key }[] }`, at most 5,000 files | `{ files: { path, patchKey, segments }[] }`, in request order |
| `POST …/local/document/segments` | `{ scope, requests }`, one to 32 | `DiffSegmentPayload[]` |
| `POST …/local/document/search` | `{ scope, query, caseSensitive, cursor, files }` | `DiffSearchPage` |

`scope` is `staged` or `unstaged`. `key` is the pane's status key for the file, and the Node diffs
again only the files whose key moved. A null `patchKey` means the file has no diff in that scope, or
Git can't read it. A segment or search request naming a digest that isn't the one the last document
gave that file answers `409 revision_conflict`, and the pane reads the document again. A task with no
worktree answers `404 not_found`.

## Notes, memory, preview, and browser

| Path family | Purpose |
| --- | --- |
| `/v1/p/notes/tasks/:id/notes[/:slug]` | Task notes, with `title` and `included` actions |
| `/v1/p/notes/workspaces/:wsId/notes[/:slug]` | Workspace and global notes. Device-only |
| `/v1/p/memory/memory`, `/memory/search` | List and search memories |
| `/v1/p/memory/tasks/:id/memory`, `/projects/:id/memory` | Add a memory by hand. Device-only |
| `/v1/p/memory/memory/changes/:id/undo` | Undo a memory change. Device-only |
| `/v1/p/memory/library/:action?projectId=ID` | The memory page's operations. Device-only |
| `/v1/p/preview/tasks/:taskId/url`, `/recipe-url`, `/configured` | The resolved preview home, recipe selection, and which tasks have one |
| `/v1/p/browser/captures/:id` | A browser tool screenshot |

Memory lists and searches enforce the signed task's project scope. Undo restores the prior version or
removes a created memory, and a later write or an outside edit returns a conflict. The library takes
`get`, `edit`, `delete`, `history`, `restore`, `changes`, `preview`, `caps`, `sources`,
`import-preview`, and `import`. Edits, deletes, and restores carry the current file hash. Import binds
each previewed file to its source and destination hashes. Caps are integers from 200 to 32,000
characters. Conflicts return 409. See
[notes and memory](../notes-and-memory.md#the-memory-page-and-transcript).

`/configured` lists every task with a preview, so it refuses a task token. A browser capture answers
only its own task to a task token, and an unknown or foreign id gets the same empty 404.

## Loaded plugins

These ship as loaded packages, so their routes run in the plugin's worker:

| Plugin | Route surface |
| --- | --- |
| `database` | Task-scoped PostgreSQL connect, schema, query, row edits, generation, saved queries, and the scratch document |
| `http` | Project-scoped requests and variables, and send |
| `linear` | Issues, comments, uploads, and rail rows |
| `rollbar` | Items, occurrences, details, and rail rows |

`GET /v1/p/database/projects/:projectId/saved-queries` answers a workflow step field and refuses a
task token, because no task in the path means no scope gate.

### Command palette routes

A loaded plugin's `search`, `input`, and `setting` commands name a route in its own namespace, and the
host calls it with the query and the identifiers the declared scope owns
([plugins.md](../plugins.md#command-kinds)). The answer is untrusted display data with no field that
can choose a route, a URL, or a verb.

```text
GET  /v1/p/rollbar/palette/issues        ?q&projectId
GET  /v1/p/linear/palette/issues         ?q&projectId
GET  /v1/p/database/palette/queries      ?q&taskId
POST /v1/p/database/palette/generate     { input, taskId }
GET  /v1/p/http/palette/requests         ?q&projectId
POST /v1/p/http/palette/import-curl      { input, taskId }
```

Each search checks the project or task owner on the Node again and answers at most 50 rows. The two
POSTs need an interactive owner and commit their write before answering, so the reader is never sent
to something that isn't there yet.

### Agent tools and context sections

`contributions.agentTools` and `contributions.contextSections` each name a route in the package's
own `/v1/p/<pluginId>/` namespace. The host calls it with a verified task principal, adapts the
bounded answer into the agent-tool registry or the context assembler, and removes the registration on
reload or unload. They project through the core task tool and context routes. See
[agent tools](../agent-tools/loaded-tools.md#loaded-manifest-carriers).
