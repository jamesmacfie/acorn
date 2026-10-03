# WebSocket

This page covers `/v1/events`, the one authenticated socket a client holds to each Node, and the
preview tunnel beside it. It's part of the [API reference](../api-reference.md). The hub is
`packages/node-core/src/server/transport/wsHub.ts`, and the wire shapes are in
`@acorn/protocol/ws.ts` and `@acorn/protocol/nodeEvents.ts`.

## Events

`/v1/events` carries sequence-numbered events and feature frames. It's a live invalidation channel,
not a durable replication log. After a reconnect or a sequence gap, the client marks the Node stale
and fetches again. Durable agent and workflow history is read from plugin tables over HTTP.

PTY output, Docker logs, stats, and exec, workflow notices, agent streams, and preview tunnels use the
same socket, with feature-specific frames and bounded backpressure and replay.

The upgrade checks the exact Node `Host` and a device bearer or internal token before it completes.
A browser can't set that header, which is why the desktop's socket belongs to the helper. The Node
and custody each refuse an incoming message over 8 MiB before parsing or dispatch, and close with
code 1009. The channel envelope is plugin-owned, and the transport keeps a handler's synchronous or
asynchronous failure inside its connection.

## Logical event viewers

Legacy upgrades keep raw JSON channel frames and the terminal binary layout: 36 ASCII session UUID
bytes, then the payload. `NodeBroker` uses this transport by default, the terminal client included.
The desktop helper opts in to viewers when the Node advertises viewer version 1
([versioning](./transport.md#versioning)).

On an opted-in socket the transport adds these frames:

| Direction | Shape | Meaning |
| --- | --- | --- |
| Client to Node | `{ channel: 'ws:viewer', viewerId, frame }` | Deliver the channel-owned `frame` to this viewer |
| Client to Node | `{ channel: 'ws:viewer-close', viewerId }` | Retire this viewer's subscriptions and resources |
| Node to client | `{ channel: 'ws:viewer', viewerId, frame, seq }` | A JSON answer for this viewer |
| Node to client | `{ channel: 'ws:viewer-error', viewerId, code, message, seq }` | An admission refusal, including under shedding |
| Node to client | 36 ASCII viewer UUID bytes, then the terminal binary frame | Terminal bytes for this viewer |

Generic invalidations stay raw JSON broadcasts. JSON sequence numbers belong to the physical socket,
targeted answers and errors included. The broker checks every sequence before it filters by viewer,
and binary output uses no sequence number. A default send on an opted-in broker uses a stable
broker-owned viewer UUID.

A viewer ID is an opaque transport identity and carries no authority. Device authorization and task
scope stay on the physical connection. At most 128 viewers, the default one included, can own
resources on one connection (`WS_MAX_VIEWERS`). Overflow gets a targeted `viewer_limit` error.
Removing a viewer, removing a Node, or disposing the connection clears their ownership maps.

The helper declares the selected Node with a nested `ws:viewer-open` lease. Selecting another Node
closes the old lease, and returning from cached UI state opens a fresh one. Fleet HTTP reads never
open leases. On a legacy Node only one viewer can hold the events lease. Another gets
`viewers_unsupported` through the client's transport-error seam, and the first keeps working. Closing
that lease reconnects the physical socket to retire resources the old Node can't close one by one.

A channel owner may supply typed subscription hints, a `key` and `attached` or `detached`, beside its
opaque frames. Custody compacts each viewer and key between command barriers, keeps live attached
state for reconnect, and sends the most recent intent before it asks for a fresh restore. Input, actions,
and unknown channel frames keep their order and aren't compacted. Disposing a viewer ends its queued
commands and removes its desired state.

## Preview tunnel

The preview tunnel is a separate upgrade on the same listener, at `/v1/tunnel`
(`packages/node-core/src/server/transport/tunnel.ts`). It resolves `?task=<uuid>&port=<n>` and uses
the same device and task-token authorization as `/v1/events`. It forwards raw bytes to `127.0.0.1` on
the named port only, never to a resolved hostname. Only declared ports are tunnellable, and there's no
general proxy to whatever else listens on the Node's loopback.

Both ends refuse a message over 64 KiB. Both senders split TCP reads into ordered slices, wait for each
write before sending the next, and resume reading after the whole chunk, so an HTTP stream larger than
the ceiling arrives complete and in order. An oversized message closes with code 1009 and closes its
TCP pipe.

A port counts as declared when the task's run bridge names it as a run target's URL, or when the
project's `previewMode` is `'port'` or `'url'`. `'script'` isn't a source, because its value is a shell
command that would have to run on every tunnel attempt. `'url'` counts because without it a remote
task configured with `http://localhost:8025` would fall back to loading the URL as given, which draws
whatever sits on the owner's own port 8025. A URL that names a host other than loopback adds nothing,
because the client can reach it directly.

## Channels

A frame's channel is `<owner>:<verb>`, and the token before the first `:` is the registered prefix on
both ends. Core sends `term:`, `workflow:`, and `ws:` frames and the eleven events in
`NODE_EVENT_CHANNELS`. Every other prefix belongs to the plugin that registered it.

`term:` is terminal transport. `workflow:` carries the bell's notices, per-step stream events, and
`workflow:step-changed`, which names one step whose status moved. The workflows plugin's own
invalidations are `plugin:workflows:run-changed`, `plugin:workflows:gate-changed`, and
`plugin:workflows:child-changed`. The child frame uses `ownerTaskId` to reach the parent's surface.
`ws:shed` is the hub saying it dropped frames because a socket fell too far behind
([backpressure](../terminal.md#backpressure)).

The eleven Node events each say that something the Node owns has moved:

| Channel | Fires when | Payload |
| --- | --- | --- |
| `plugins:changed` | A plugin is installed, updated, removed, reloaded, or toggled | None |
| `tasks:changed` | Any task write, including worktree changes and a project delete | `taskId`, or `null` for a batch |
| `workspace:changed` | A workspace is created, renamed, or deleted | `workspaceId` |
| `workspace-projects:changed` | A provider's project mapping is replaced or removed | `providerId` and every affected `workspaceIds` |
| `connection:changed` | A connection's status changes, including a demotion to `needs-auth`, or it's deleted | `integrationId`, `providerId`, and `status` or `deleted: true` |
| `head:changed` | A task worktree's tip moves | The project, task, branch, `head`, and `dirty` |
| `run:changed` | A declared run target starts, stops, or exits | `taskId`, `targetId`, and `running` |
| `agent-session:changed` | A managed session finishes a turn or asks for attention | `taskId`, `sessionId`, and `event`: `completion` or `attention` |
| `project:changed` | Any project write, including config and run targets | `projectId` |
| `terminal:sessions-changed` | A terminal session is created, exits, or flips between working and idle | None |
| `worktree:status-changed` | Something under a task's worktree changes | `taskId`, or `null` when the writer didn't know |

The task-status poll detects `head:changed`, so it fires within one status round trip of an in-app
commit and within ten seconds of one made elsewhere, while a client is attached.
`worktree:status-changed` is separate from it because a stage or a discard moves the dirty markers
without moving HEAD. `terminal:sessions-changed` is the one channel that fires at machine speed, which
is why only the session roster hears it.

`term:status` rides the `term:` prefix and means "read this plugin's chrome descriptors again". It
carries the `pluginId` whose rows moved, and only the plugin-chrome sweep hears it. A ping with no
`pluginId` is core's and means every plugin's.

## Why

A content-free event has a fetchable list behind it, and a payload would be a second projection to
keep in step. The rest carry only what lets a listener drop a frame without a round trip:
`connection:changed` names its provider because every integration plugin hears it. The client still
reads the route again. All of them are invalidation, not replay. A client that missed a frame isn't
owed a delta, so each field says what the thing is, not what changed about it.
