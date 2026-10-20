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
It's `{ kind: 'panel', title, description, failed }` or `{ kind: 'app', appId, name, revision, note,
failed }`, and each field is present only when that record says it. A call's input and its result can
arrive in different records, and the sidebar merges a call's fields by tool ID, as it merges `title`
and `status`.

`toolCard` in `apps/cli/src/browser/agents.ts` reads a panel's title, and an app's ID and note,
from the call's input. It reads a panel's description, and an app's name and revision, from its
result. It uses the readers the desktop's cards use: `readPanelShowCall` in `@acorn/protocol`, and
`readAppShowCall` in the trellis plugin's contract. `failed` marks a call that finished without a
result, which is how a harness records a refused call. Nothing else from a call's input or output
crosses the bridge.

An older sidebar ignores `card`. A newer sidebar with an older host gets none, and draws the plain
tool line.

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
