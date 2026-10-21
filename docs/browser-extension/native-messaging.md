# Native messaging in the browser extension

This page covers the messages between the [browser extension](../browser-extension.md)'s background and
its native host: the frame format, every operation, the events, and the limits the host enforces. The
contract is `packages/protocol/src/transport/extensionBridge.ts`, which both apps import.

## Frames and operations

Each message is a 32-bit little-endian length followed by that many bytes of UTF-8 JSON. Every
request carries `v: 1` and a request `id`, and the host answers with the same `id`:

| Operation | Fields | Result |
| --- | --- | --- |
| `nodes.list` | none | `{ nodes, activeNodeId, status }` |
| `node.probe` | `endpoint` | The probe result: endpoint, fingerprint, protocol, baseline, `compatible` |
| `node.local` | none | The Node on this computer as a probe result with its `nodeId`, or `null` when none is running |
| `node.pair` | `code`, `label` | The paired Node's record |
| `node.ask` | none | `{ phrase }`: the words the owner's dialog shows. Only after `node.local` |
| `node.collect` | `label` | The paired Node's record once the owner allows the ask, or `null` while they haven't. A denial or an expiry fails with `pairing_failed` |
| `node.select` | `nodeId` or `null` | `{ nodes, activeNodeId, status }` |
| `node.forget` | `nodeId` | `{ nodes, activeNodeId, status }` |
| `node.rename` | `nodeId`, `label` (1 to 120 characters) | `{ nodes, activeNodeId, status }`. The name is this browser's own, so nothing on the Node or in other clients changes |
| `projects.list` | `nodeId` | `{ nodeId, projects, workspaces }`, each project `{ id, name, path, hidden, workspaceId }` and each workspace `{ id, name }`, in the rail's order |
| `tasks.pages` | `nodeId` | `{ nodeId, tasks }`: every active task with a page address, each `{ id, title, branch, projectId, pages }`, including the app origins plugins publish; see [pages that belong to a task](./task-pages.md#pages-that-belong-to-a-task) |
| `agents.choices` | `nodeId`, `refresh` (optional) | `{ nodeId, choices }`: the desktop's New picker rows; see [agent conversations](./conversations.md) |
| `sessions.list` | `nodeId`, and `taskId` or `workspaceId` | `{ nodeId, taskId, sessions }` or `{ nodeId, workspaceId, sessions }`: the newest 100 unarchived sessions of the task, or of every task in the workspace |
| `session.read` | `nodeId`, `sessionId`, `afterSeq`, `limit` (at most 500) | `{ nodeId, sessionId, session, records, reach, queued }` |
| `session.create` | `nodeId`, `taskId`, `providerId`, `profileId`, `customAgentId` and `account` (optional), `key` | `{ nodeId, session }` |
| `turn.submit` | `nodeId`, `sessionId`, `input`, `key` | `{ nodeId, sessionId, turnId }` |
| `session.archive` | `nodeId`, `sessionId`, `key` | `{ nodeId, sessionId }`: the host sends `PATCH` with `{ archived: true }` to the session's route |
| `task.archive` | `nodeId`, `taskId`, `key` | `{ nodeId, taskIds }`: the host sends `POST` with `{ deleteWorktree: true }` to the task's `archive` route. `taskIds` lists every task archived, subtasks included. A refusal, such as uncommitted changes, is a `node_error` |
| `task.delete` | `nodeId`, `taskId`, `key` | `{ nodeId, taskIds }`: the host sends `POST` with an empty body to the task's `delete` route, which archives an active task first |
| `session.cancel` | `nodeId`, `sessionId`, `key` | `{ nodeId, sessionId }`: the host sends `POST` with an empty body to the session's `cancel` route, which stops its running turn; see [stopping the agent](./transcript.md#the-state-line) |
| `request.resolve` | `nodeId`, `sessionId`, `requestId`, `resolution`, `key` | `{ nodeId, sessionId, request }`; see [answering the agent](./conversations.md#answering-the-agent) |
| `attachment.upload`, `attachment.read`, `attachment.delete` | `nodeId`, `taskId`, and the attachment | See [page capture](./page-capture.md#attachment-operations) |
| `handoffs.list`, `handoff.resolve`, `handoff.create` | `nodeId`, and the handoff and page | See [handoffs](./handoffs.md#native-operations) |
| `sites.list`, `site.add`, `site.remove` | `nodeId`, and the project and association | See [project sites](./project-sites.md#native-operations) |
| `workflows.list`, `workflow.start`, `workflow.runs`, `workflow.steps` | `nodeId`, and the project, task, or run | See [workflows](./workflows.md#native-operations) |
| `plugin.panel` | `nodeId`, `pluginId`, `taskId`, `source` (optional) | `{ nodeId, pluginId, taskId, view }`, where `view` is null when the task has no panel; see [plugin panels](./plugin-panels.md#native-operation) |
| `requests.pending` | `nodeId` | `{ nodeId, requests }`; see [request notifications](./notifications.md#native-operation) |
| `panel.run` | `nodeId`, `sessionId`, `toolId`, `viewerZone` | `{ nodeId, sessionId, toolId, plan, run }`; see [panel cards](#panel-cards) |
| `app.view` | `nodeId`, `taskId`, `appId`, `revision` | `{ nodeId, appId, revision, summary, program, plans, task }`; see [app cards](#app-cards) |
| `app.run` | `nodeId`, `taskId`, `appId`, `revision`, `plan`, `inputs`, `viewerZone` | `{ nodeId, appId, revision, plan, run }` |
| `app.state` | `nodeId`, `taskId`, `appId`, and `state` with `key` to save | `{ nodeId, appId, state }`, where `state` is null after a save |
| `app.restore` | `nodeId`, `taskId`, `appId`, `revision`, `key` | `{ nodeId, appId, revision }`, the new head |
| `row.act` | `nodeId`, `target`, `rowId`, `actionId`, `confirmedRisk`, `viewerZone`, `key` | `{ nodeId, outcome, action }`, the act route's answer; see [row actions](#row-actions) |

A reply is `{ v, id, ok: true, result }` or `{ v, id, ok: false, error: { code, message } }`. The host
also sends `{ v, event: 'status', status }` when the selected Node's connection changes, and
`{ v, event: 'agent', nodeId, sessions, tasks, missed, requests }` as a change hint, and
`{ v, event: 'handoffs', nodeId }` when the selected Node's plugins change, and
`{ v, event: 'projects', nodeId }` when one of its projects or workspaces changes, and `{ v, event: 'tasks', nodeId }`
when one of its tasks is created, changed, or archived, its links change, or a plugin that publishes
task addresses reports a change. [Agent conversations](./conversations.md) covers the agent
operations, hints, and what the sidebar keeps in browser storage. `turn.submit`'s `input` is the
agents plugin's turn input, limited to the parts [page capture](./page-capture.md)
sends: at most one `text` part of 60,000 characters, eight `context` parts, and eight `image` parts. A request
that doesn't match the schema gets a `bad_request` reply when it has a usable `id`, and nothing
otherwise. Add an operation together with the phase that first calls it.

## Panel and app calls

A `session.read` tool record carries `card` when the call's MCP name is `panel_show` or `app_show`,
so the sidebar can name what the agent made ([the conversation view](./transcript.md#panel-and-app-lines)).
It's `{ kind: 'panel', title, description, panelId, shownAt, failed }` or `{ kind: 'app', appId, name,
revision, note, failed }`, and each field is present only when that record says it. A call's input and its result can
arrive in different records, and the sidebar merges a call's fields by tool ID, as it merges `title`
and `status`.

`toolCard` in `apps/cli/src/browser/agents.ts` reads a panel's title, and an app's ID and note,
from the call's input. It reads a panel's description, and an app's name and revision, from its
result, with its `panelId` and `shownAt`, which tell the sidebar when a newer card replaces an older
one. It uses the readers the desktop's cards use: `readPanelShowCall` in `@acorn/protocol`, and
`readAppShowCall` in the trellis plugin's contract. `failed` marks a call that finished without a
result, which is how a harness records a refused call. Nothing else from a call's input or output
crosses the bridge.

An older sidebar ignores `card`. A newer sidebar with an older host gets none, and draws the plain
tool line.

## Panel cards

`panel.run` runs an agent's `panel_show` call, so the sidebar can draw it
([panel cards](./transcript.md#panel-cards)). The browser names the call, never a plan. The host:

1. Reads the call from the agents plugin's `GET /sessions/:sessionId/tools/:toolId`, which folds the
   call across the whole session.
2. Refuses with `not_found` unless the call is `panel_show`, completed, and its output reads as a
   `panel_show` result. A plan that no longer passes `panelPlanSchema` is `not_found` too.
3. Finds the workspace of the session's task, through the active task list and the project list.
4. Runs the plan, titled with the call's title, through `POST /v1/core/dashboards/run` as a draft, in
   `execution` mode, in that workspace, with the sidebar's `viewerZone`. The desktop's card sends the
   same request.

The run is a read: an answer that arrives after the selection moved is refused with `not_selected`.
`plan` is the parsed plan, so the sidebar can lay out the view. `run` is the run route's answer,
unchanged, capped so the whole reply fits the extension's 16 Mi character limit. A host from before
`panel.run` answers `bad_request`, and the sidebar draws the call's line instead.

## App cards

Four operations draw an agent's app in the sidebar ([app cards](./transcript.md#app-cards)). The
browser names an app, a revision, and a plan, never a program or a plan's content. Each names the
conversation's task, and the host first reads the app's summary from the trellis plugin's
`GET /v1/p/trellis/apps/<appId>` and refuses with `not_found` unless it names that task. The trellis
routes don't confine a device to a task, so the host makes this check itself, as it does for an
attachment.

- `app.view` answers the summary, the revision's program, its plan names, and the task's ID, title,
  and branch. `task` is null once the task isn't active, and the sidebar draws no app then.
- `app.run` reads the revision's files, takes the named plan from them, and runs it as `panel.run`
  runs a panel: a draft in the task's workspace, in `execution` mode, with the sidebar's `viewerZone`
  and the program's `inputs`. A plan name the revision has no file for is `not_found`, and so is a
  plan that no longer passes `panelPlanSchema`. `inputs` are at most 64 KiB of JSON.
- `app.state` without `state` reads the app's saved state. With `state` and `key`, it saves it with
  `PUT`. The schema refuses a state over 256 KiB, the trellis route's own limit, and a save without a
  key.
- `app.restore` posts the revision to the restore route with its key, so the Node makes one revision
  for a retried restore.

A revision never changes, so the host keeps the files of the last eight revisions it read, by Node,
app, and revision, and a program's runs skip that read. It keeps nothing else between calls. A host
from before `app.view` answers `bad_request`, and the sidebar draws the call's line instead.

## Row actions

`row.act` runs a data source's action on one row of a panel card or an app card
([row actions](./transcript.md#row-actions)). It's the bridge's only operation that changes a data
source's records. The browser names the card's plan, the row, and the action, never a record. The
`target` is one of:

- `{ kind: 'panel', sessionId, toolId }`, the call `panel.run` runs.
- `{ kind: 'app', taskId, appId, revision, plan, inputs }`, the plan and inputs `app.run` ran.

The host:

1. Reads the target's plan as `panel.run` or `app.run` does, with the same refusals. An app target
   must name the app's head, because an older revision is read only. Any other revision is
   `not_found`.
2. Runs the plan again, with the sidebar's `viewerZone` and the target's `inputs`.
3. Finds the row by `rowId` in that run, and the action by `actionId` among the row's own actions. A
   row that's gone, or that no longer offers the action, is `not_found`: "That row changed. Refresh
   and try again." The host never acts on another row.
4. Posts the row's first record, `actionId`, and `confirmedRisk` to `POST /v1/core/data-sources/act`,
   with `key` as its `Idempotency-Key`. The act route takes only a UUID, so the schema does too. The
   Node checks `confirmedRisk` against the action's own risk.
5. Answers the route's `outcome`, and with `ready`, the `action` to take next, unchanged.

The act route answers `done`, `no-longer-available`, or `ready` with a next action of any verb but
`runNodeAction`, which it runs itself. The sidebar opens an `openUrl` in a new tab after the link
confirm, and offers **Open in Acorn** for the rest. The route takes no task, so no action depends on
the viewer's task. Only a next action's destination does, and the desktop finds that when it opens.

The rerun costs one run of the plan for each action. The host keeps nothing between calls, so it can't
trust what the sidebar last drew. An answer that never arrives is `ambiguous_mutation`. The sidebar
keeps that press's key, and sends it again only when the person presses again. The Node answers a key
it has seen with its first answer. If the action took effect and the row has gone from the rerun, the
retry is `not_found`, and nothing acts twice.

## Limits

The host enforces these limits:

- A request frame over 14 MiB closes the host. A length header can't be trusted to resynchronize, so
  the host doesn't buffer it. Every request the schema accepts fits, including an attachment upload
  at the 10 MiB limit. Chrome sends up to 64 MiB to a host and Firefox up to 4 GiB, so a request is
  never split.
- A malformed JSON frame is logged to stderr and skipped.
- Bytes of an unfinished frame at end of input are discarded and logged.
- A panel or app call's `card` carries a title, name, or note of at most 200 characters, and a
  description of at most eight lines of 300 characters each.
- Both browsers refuse a host message over 1 MiB, so a reply longer than 262,144 UTF-16 units goes out
  as chunk frames, `{ v, id, chunk: { index, count, data } }`.

The background rebuilds a chunked reply in any order. It refuses one that passes 16 Mi characters,
repeats an index, or changes its count. When the port closes, it fails every waiting request with
`host_unavailable`, and any reply it was rebuilding goes with it.
