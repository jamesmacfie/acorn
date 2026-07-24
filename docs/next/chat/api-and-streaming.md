# Internal API and streaming protocol

## 1. Transport choice

Follow Acorn's shipped rule: request/response work uses authenticated same-origin HTTP; live streams use
the existing authenticated WebSocket; preload IPC is reserved for true Electron-native capabilities.

Chat does not need native IPC. Browser `File` objects can be uploaded by multipart HTTP, and provider
network calls run in the server/main process.

The chat transport is intentionally not an HTTP response stream:

- a turn continues while the user changes thread/source;
- cancellation and completion have durable resource ids;
- reconnect recovery comes from SQLite rather than an SSE replay buffer;
- Acorn already owns one authenticated, reconnecting, kind-tagged WebSocket.

## 2. Route namespace

Mount one plugin router at `/api/chat` through `registerRoute`. It remains below core CSRF,
`authMiddleware`, and `requireUser`.

All request bodies and public projections use strict Zod schemas. Unknown fields fail with
`chat_bad_request`; server-only columns (encrypted credential, storage key, provider raw data) have no
response schema field.

### Workspace bootstrap and model providers

| Method | Path | Behavior |
| --- | --- | --- |
| `GET` | `/api/chat/workspaces/:workspaceId` | Chat bootstrap: workspace summary, active/archived thread page, connection summaries, selected draft/default projection |
| `GET` | `/api/chat/workspaces/:workspaceId/models` | Normalized selectable models grouped by connected provider; `?refresh=1` bypasses cache |

Connection CRUD is not duplicated under `/api/chat`. Settings and other features use the shared
`/api/integrations` lifecycle. Chat bootstrap may project eligible safe summaries, but credential
values and ciphertext remain outside every chat contract.

### Threads and messages

| Method | Path | Behavior |
| --- | --- | --- |
| `GET` | `/api/chat/workspaces/:workspaceId/threads` | Cursor page; `archived=true` opt-in |
| `POST` | `/api/chat/workspaces/:workspaceId/threads` | Create empty thread with optional title/model selection |
| `GET` | `/api/chat/threads/:threadId` | Thread plus newest message page and active run |
| `PATCH` | `/api/chat/threads/:threadId` | Rename, archive/unarchive, change next connection/model |
| `DELETE` | `/api/chat/threads/:threadId` | Permanent delete after UI confirmation; cancels run and cascades |
| `GET` | `/api/chat/threads/:threadId/messages` | Older message page by ordinal cursor |
| `POST` | `/api/chat/threads/:threadId/turns` | Atomic idempotent turn creation and async run start; returns `202` |
| `POST` | `/api/chat/runs/:runId/cancel` | Idempotent cancellation; returns current terminal/transition state |

Turn request:

```ts
type CreateChatTurnRequest = {
  clientTurnId: string // UUID generated once and retained across HTTP retries
  text: string
  attachmentIds: string[]
  connectionId: string
  modelId: string
}
```

Rules:

- text may be blank only when at least one attachment exists;
- attachment ids are unique, ordered, and belong to the thread workspace;
- connection belongs to the same workspace and is usable;
- model belongs to that connection's normalized catalog and supports all attachments;
- one non-terminal run per thread; otherwise `409 chat_run_conflict`;
- `(threadId, clientTurnId)` replay returns the original `202` projection;
- route returns after commit/schedule, not after provider headers or first token.

Response:

```ts
type CreateChatTurnResponse = {
  thread: ChatThread
  requestMessage: ChatMessage
  responseMessage: ChatMessage
  run: ChatRun
}
```

### Attachments

| Method | Path | Behavior |
| --- | --- | --- |
| `POST` | `/api/chat/workspaces/:workspaceId/attachments` | Multipart upload, validate/sniff/hash/atomic-store, return metadata |
| `GET` | `/api/chat/attachments/:attachmentId` | Metadata after workspace lineage validation |
| `GET` | `/api/chat/attachments/:attachmentId/content` | Authenticated bytes with safe headers/range support where useful |
| `DELETE` | `/api/chat/attachments/:attachmentId` | Delete only when not message-referenced; draft UI removes its pref reference first |

The content endpoint never accepts `storageKey`, a path, or a filename as lookup authority.

## 3. Standard success and errors

Use ordinary JSON resources; no chat-specific top-level envelope is needed. Errors use Acorn's existing:

```ts
type ApiError = { error: string; detail?: string[] }
```

Recommended status mapping:

| Status | Codes |
| --- | --- |
| `400` | `chat_bad_request`, `chat_attachment_unsupported`, `chat_attachment_too_large`, `chat_context_too_large` |
| `401` | core session auth only; provider auth does not become app `401` |
| `403` | workspace/attachment lineage violation; use a generic not-found posture if existence disclosure matters |
| `404` | thread/message/run/attachment/connection not found |
| `409` | `chat_run_conflict`, referenced attachment delete, active-run connection change |
| `413` | request/upload body too large |
| `422` | `chat_model_unavailable`, model/attachment capability mismatch |
| `424` | `chat_provider_not_configured`, `chat_provider_needs_auth` |
| `429` | local concurrency budget or provider `chat_rate_limited` when starting synchronously; async failures finalize run |
| `502` | provider validation/test unavailable; async generation failure finalizes run |

Once `POST /turns` has returned `202`, provider failures are primarily durable run/message state plus a
WebSocket terminal event; they are not retroactive HTTP failures.

## 4. WebSocket contract

Add one union member that wraps chat events:

```ts
type WsServerFrame =
  | ExistingFrames
  | { channel: 'chat:event'; event: ChatStreamFrame }

type ChatStreamFrame =
  | {
      type: 'run-started'
      workspaceId: string
      threadId: string
      runId: string
      messageId: string
      seq: number
      at: number
    }
  | {
      type: 'part-started'
      workspaceId: string
      threadId: string
      runId: string
      messageId: string
      part: ChatMessagePart
      seq: number
      at: number
    }
  | {
      type: 'text-delta'
      workspaceId: string
      threadId: string
      runId: string
      messageId: string
      partId: string
      delta: string
      seq: number
      at: number
    }
  | {
      type: 'run-completed'
      workspaceId: string
      threadId: string
      runId: string
      message: ChatMessage
      run: ChatRun
      seq: number
      at: number
    }
  | {
      type: 'run-failed' | 'run-cancelled' | 'run-interrupted'
      workspaceId: string
      threadId: string
      runId: string
      message: ChatMessage
      run: ChatRun
      seq: number
      at: number
    }
```

`seq` starts at 1 per run and increases for every emitted frame. It detects duplicates/gaps; it is not
a durable replay offset.

Do not put provider request bodies, credentials, raw SDK errors, base64 attachment data, or raw provider
events in frames.

## 5. Broadcast and subscription policy

The current app is single-user and normally single-window. V1 may broadcast chat events to every
authenticated app socket, with renderer filtering by workspace/thread. This avoids adding subscribe
state to the server and ensures background-thread completions are observed.

If multi-window/event volume later requires filtering, add idempotent `chat:subscribe-workspace` frames.
Do not add them speculatively in v1.

`wsClient.ts` adds:

```ts
export function wsOnChatEvent(cb: (event: ChatStreamFrame) => void): () => void
export function wsOnConnectionState(cb: (state: 'open' | 'closed') => void): () => void
```

Connection-state notification lets the chat client invalidate active thread/list data after reconnect.
It is reusable by other push consumers and belongs in core.

## 6. Client merge algorithm

For each run maintain session-only:

```ts
type ClientRunCursor = {
  lastSeq: number
  desynchronized: boolean
  pendingTextByPart: Map<string, string>
  raf: number | null
}
```

On a frame:

1. ignore `seq <= lastSeq`;
2. if `seq !== lastSeq + 1`, mark desynchronized and invalidate/refetch the thread; do not guess at
   missing text;
3. for text deltas, append to a pending buffer and update TanStack Query at most once per animation
   frame;
4. for part start, insert by stable `part.index` only if absent;
5. for terminal frame, cancel pending animation frame, apply final canonical message/run projection,
   invalidate thread list/model usage projections, then run notification policy;
6. after refetch, seed `lastSeq` from continued frames only; DB content is authoritative.

Do not copy the whole message history into a second signal store. Local cursors/buffers are T4 transport
state; query data is the T2 projection.

## 7. Server streaming algorithm

`ChatRunService.start(runId)`:

1. atomically claim `queued` run so two schedulers cannot start it;
2. create/store an `AbortController` in the active-run map;
3. assemble/persist input manifest;
4. transition run/message to `streaming`, emit `run-started`;
5. consume adapter events in order;
6. map provider parts to canonical ids and accumulate text;
7. coalesce WebSocket delta chunks and bounded SQLite checkpoints;
8. on complete, flush/finalize transaction then emit terminal frame;
9. on typed failure or abort, flush/finalize corresponding terminal state then emit;
10. remove controller/accumulators in `finally`.

The service must not emit `run-completed` before the final database transaction commits. A client that
reacts to the event must always be able to refetch the completed row.

## 8. Cancellation

`POST /runs/:id/cancel` is idempotent:

- terminal run → return unchanged projection;
- queued → transition directly to cancelled and emit;
- streaming → call the run's `AbortController.abort()`, wait for the run service's bounded finalization
  path, and return `202` while cancellation is settling or terminal projection if already settled;
- missing in-memory controller but DB says streaming → mark interrupted during reconciliation rather
  than pretending cancellation reached the provider.

Partial assistant text remains visible with a “Stopped” marker. User may copy it. Retry is explicit and
uses a new `clientTurnId`.

## 9. Reconnect and reload

WebSocket delivery is best-effort across disconnect:

- aggregate assistant text checkpoints to SQLite;
- on socket reopen, invalidate active workspace thread list, active thread, and any locally tracked
  active runs;
- fetch active run/message status;
- if still streaming, render DB checkpoint and accept new later deltas;
- if terminal, render final state and run the completion notification only if that terminal event/run
  has not already been acknowledged in this renderer session;
- do not toast old completions merely because the app reloaded.

Keep a bounded session set `notifiedRunIds`. Durable notification history dedupes by run id through the
notice registry's dedupe key.

## 10. Concurrency and idempotency

- one active run per thread;
- recommended local cap: three active runs per workspace and two per connection;
- exceeding local cap returns `429` before turn creation or queues explicitly; v1 should reject rather
  than create an invisible unbounded queue;
- provider SDK retry settings are adapter-owned, but never automatically replay after visible output
  has been emitted;
- the `clientTurnId` handles UI double-submit/network retry, not provider retry;
- cancellation, archive, delete, disconnect, and workspace delete are idempotent at service boundary.

## 11. Query keys and invalidation

Recommended stable keys:

```ts
['chat', 'workspace', workspaceId]
['chat', 'threads', workspaceId, { archived }]
['chat', 'thread', threadId]
['chat', 'messages', threadId]
['chat', 'connections', workspaceId]
['chat', 'models', workspaceId]
['chat', 'attachment', attachmentId]
```

Mutation invalidation:

- turn create: insert returned messages/run, invalidate thread list;
- completion/failure/cancel: replace final message/run, invalidate thread list;
- thread rename/archive/delete: thread list + selected thread;
- connection changes: connections + models + workspace bootstrap;
- attachment upload/delete: draft-local state and attachment query only.

## 12. Route tests

At minimum cover:

- every contributed route is behind core auth and mutating routes obey CSRF;
- unknown fields and malformed ids fail;
- thread/connection/attachment cross-workspace references fail;
- duplicate `clientTurnId` returns identical ids and starts fake provider once;
- active-run conflict;
- attachment/model capability mismatch;
- secret fields never appear in JSON;
- cancel queued/streaming/terminal;
- provider failure occurs after `202` and finalizes state;
- WS terminal event is emitted after durable commit;
- reconnect refetch recovers a dropped delta;
- deleting referenced attachment returns conflict;
- pagination is stable under equal timestamps.
