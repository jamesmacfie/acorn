# Events and streaming

## 1. Transport

The public listener exposes one authenticated WebSocket:

```text
ws://127.0.0.1:<apiPort>/api/v1/ws
```

The upgrade requires the same `Authorization: Bearer ...` header and exact Host guard as HTTP.
Cookie and `x-acorn-internal` credentials are rejected. Invalid/revoked tokens receive an HTTP
`401` before upgrade. A read token may subscribe; frames that cause input or mutation require the
connection principal to include `write`.

This public socket is distinct from the existing app-renderer socket on port `4317`, but both adapt
the same in-process event and terminal stream services. Do not bridge socket-to-socket over network.

## 2. Frame envelope

Every frame is strict JSON with a protocol version and client/server-generated frame id.

```ts
const ClientFrameSchema = z.discriminatedUnion('type', [
  SubscribeFrameSchema,
  UnsubscribeFrameSchema,
  TerminalAttachFrameSchema,
  TerminalDetachFrameSchema,
  TerminalInputFrameSchema,
  PingFrameSchema,
])

const ServerFrameSchema = z.discriminatedUnion('type', [
  ReadyFrameSchema,
  AckFrameSchema,
  ErrorFrameSchema,
  EventFrameSchema,
  TerminalOutputFrameSchema,
  TerminalReadyFrameSchema,
  TerminalExitFrameSchema,
  PongFrameSchema,
])

const ClientBaseSchema = z.strictObject({
  version: z.literal(1),
  id: z.string().min(1).max(128),
})

const ServerBaseSchema = z.strictObject({
  version: z.literal(1),
  id: z.string().min(1).max(128),
  at: UnixMillisSchema,
})
```

Unknown frame types, fields, channels, and invalid values produce a correlated error frame. Repeated
protocol violations (default 10 within 60 seconds) close the connection with `4400`.

## 3. Connection readiness

Immediately after upgrade the server sends:

```json
{
  "version": 1,
  "id": "server-frame-id",
  "at": 1783700000000,
  "type": "ready",
  "connectionId": "uuid",
  "apiVersion": "v1",
  "scopes": ["read", "write"],
  "heartbeatMs": 30000,
  "maxFrameBytes": 1048576
}
```

No subscriptions are active until requested. The server sends protocol ping frames after idle;
clients respond with pong or use WebSocket ping/pong. Close dead connections after two missed
heartbeats.

## 4. Domain event subscription

```ts
const EventFilterSchema = z.strictObject({
  channels: z.array(z.string().min(1).max(200)).min(1).max(100),
  taskIds: z.array(IdSchema).max(100).optional(),
  workspaceIds: z.array(IdSchema).max(100).optional(),
})

const SubscribeFrameSchema = ClientBaseSchema.extend({
  type: z.literal('subscribe'),
  subscriptionId: z.string().min(1).max(128),
  filter: EventFilterSchema,
  after: z.number().int().nonnegative().optional(),
})

const UnsubscribeFrameSchema = ClientBaseSchema.extend({
  type: z.literal('unsubscribe'),
  subscriptionId: z.string().min(1).max(128),
})
```

Server acknowledges subscribe/unsubscribe with the same client frame id. Events use:

```ts
const EventFrameSchema = ServerBaseSchema.extend({
  type: z.literal('event'),
  subscriptionId: z.string(),
  sequence: z.number().int().nonnegative(),
  channel: z.string(),
  actor: z.strictObject({
    kind: z.enum(['browser', 'internal', 'api-token', 'system']),
    id: z.string().optional(),
  }),
  resource: z.strictObject({
    type: z.string(),
    id: z.string(),
  }).optional(),
  data: z.unknown(), // validated against the channel contribution schema
})
```

`sequence` is monotonic within one app run. Maintain a bounded in-memory replay ring (at least
10,000 events or 15 minutes, whichever is reached first). `after` replays retained matching events;
if it predates the ring, return `409 replay_unavailable` in a correlated error frame and include
the oldest sequence. Durable historical auditing is not promised by `v1`.

## 5. Event contribution contract

```ts
type PluginEventContribution<T> = {
  pluginId: string
  channel: `${string}.${string}`
  description: string
  schema: z.ZodType<T>
  scope: 'read'
}
```

Publish only after the authoritative mutation commits or the runtime transition occurs. Event
payloads contain identifiers and bounded summaries, not secrets or whole file/terminal/provider
bodies. Core validates payloads in test/development and drops/logs a contract violation in production
rather than sending malformed data.

Required core channels:

| Channel | Payload |
| --- | --- |
| `core.workspace.created`, `.updated`, `.deleted` | workspace or `{ workspaceId }` |
| `core.repository-assignment.updated` | repository assignment |
| `core.task.created`, `.updated`, `.archived`, `.restored` | task or `{ taskId }` |
| `core.ui.connected`, `.disconnected`, `.state` | bounded window summary/snapshot metadata |
| `core.command.completed`, `.failed` | command id, request id, target window, result/error code |
| `core.api.settings.updated` | enabled/port only |

Required plugin channels:

| Plugin | Channels |
| --- | --- |
| terminal | `terminal.session.created`, `.updated`, `.exited`, `.removed`; `terminal.execution.*`; `terminal.task-status.updated` |
| changes | `changes.git.updated`, `changes.review-note.*` |
| editor | `editor.file.written` (path/hash only) |
| github | `github.pull.updated`, `github.checks.updated`, `github.rate-limit` |
| notes | `notes.note.created`, `.updated`, `.deleted` |
| memory | `memory.entry.*`, `memory.proposal.*` |
| workflows | `workflows.run.*`, `workflows.step.*`, `workflows.gate.waiting` |
| integrations | `integrations.connection.*` (no credentials) |
| preview | `preview.navigation.updated` |

Plugins may add channels through their contribution contract; discovery includes channel schemas.

## 6. Terminal streaming frames

Terminal output is not a general event because it is high volume and subscription/session-specific.

```ts
const TerminalAttachFrameSchema = ClientBaseSchema.extend({
  type: z.literal('terminal.attach'),
  sessionId: IdSchema,
})
const TerminalDetachFrameSchema = ClientBaseSchema.extend({
  type: z.literal('terminal.detach'),
  sessionId: IdSchema,
})
const TerminalInputFrameSchema = ClientBaseSchema.extend({
  type: z.literal('terminal.input'),
  sessionId: IdSchema,
  data: z.string().max(262_144),
})

const TerminalReadyFrameSchema = ServerBaseSchema.extend({
  type: z.literal('terminal.ready'),
  sessionId: IdSchema,
  session: TerminalSessionSchema,
  replayedBytes: z.number().int().nonnegative(),
  truncated: z.boolean(),
})
const TerminalOutputFrameSchema = ServerBaseSchema.extend({
  type: z.literal('terminal.output'),
  sessionId: IdSchema,
  sequence: z.number().int().nonnegative(),
  data: z.string(),
})
const TerminalExitFrameSchema = ServerBaseSchema.extend({
  type: z.literal('terminal.exit'),
  sessionId: IdSchema,
  exitCode: z.number().int().nullable(),
  signal: z.string().nullable(),
})
```

Attach requires `read`; input requires `write`. A read-only connection attempting input receives
`403 insufficient_scope` as an error frame and remains connected. Attach preserves the existing
ready → ring replay → live ordering. Detach never stops the session.

Apply backpressure per connection. If a client cannot consume terminal output, drop only that
session's old output after a bound, set `truncated: true` on the next control frame, or close with
`4408 slow_consumer`; never let one socket block PTY reads for the UI or other clients.

## 7. Captured execution output

Captured commands publish normal events:

```ts
const ExecutionOutputEventSchema = z.strictObject({
  executionId: IdSchema,
  taskId: IdSchema,
  stream: z.enum(['stdout', 'stderr']),
  sequence: z.number().int().nonnegative(),
  data: z.string().max(262_144),
})
```

Clients subscribe to `terminal.execution.output` filtered by task, then fetch final bounded output
from the execution resource. Event output is transient; the resource is authoritative for final
status.

## 8. Acknowledgements and errors

```ts
const AckFrameSchema = ServerBaseSchema.extend({
  type: z.literal('ack'),
  requestId: z.string(),
  result: z.unknown().optional(),
})
const ErrorFrameSchema = ServerBaseSchema.extend({
  type: z.literal('error'),
  requestId: z.string().optional(),
  error: z.strictObject({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
})
```

Terminal input acknowledgement means the bytes were accepted by the terminal service, not that the
shell executed them. Subscribe acknowledgement means the filter is active and replay (if any) has
been queued before live events.

## 9. Close codes

| Code | Meaning |
| ---: | --- |
| `1000` | normal shutdown/client close |
| `1001` | Acorn shutting down/rebinding API port |
| `4400` | invalid protocol/repeated invalid frames |
| `4401` | token expired or revoked |
| `4403` | operation forbidden/connection lacks required base scope |
| `4408` | slow consumer or heartbeat timeout |
| `4413` | frame too large |
| `4500` | unexpected server failure |

WebSocket revocation must not wait for the next incoming frame. The token service actively closes
all connections indexed under the revoked token id.

## 10. Tests

- HTTP upgrade rejects missing/invalid/revoked token with `401` and wrong Host with `403`;
- cookies/internal tokens are rejected on the public socket;
- read-only attach succeeds and input fails with `insufficient_scope`;
- every frame rejects unknown keys and invalid discriminants;
- replay ordering is replay-before-live and reports an expired cursor;
- terminal attach preserves ready/replay/live ordering from the current hub;
- slow-consumer isolation does not delay other sockets or the app renderer;
- token revocation closes all of that token's sockets with `4401` immediately;
- port rebind closes with `1001` after the settings response is flushed;
- plugin event payload schemas appear in discovery/OpenAPI extension data;
- event payload redaction tests cover credentials, command strings, file bodies, SQL, and terminal
  input/output outside their explicit stream frames.
