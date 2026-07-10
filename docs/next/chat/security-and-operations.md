# Security, privacy, and operations

## Trust boundaries

Chat crosses four trust boundaries:

1. the renderer is authenticated but remains an untrusted caller of server APIs;
2. attachment bytes and filenames are user-controlled input;
3. model output is untrusted remote content;
4. OpenAI and Anthropic are external processors receiving selected conversation data.

Every server operation must re-derive workspace ownership. A thread ID, run ID, message ID, or attachment ID is never authorization by itself.

The first release has no tool execution, shell access, repository access, URL retrieval, or implicit Acorn context. This sharply limits prompt-injection consequences. Future context/tool work requires a new threat model; it must not be smuggled into the provider adapter.

## Authentication and authorization

The plugin router mounts beneath the existing authenticated and CSRF-protected `/api` stack. Each route then applies resource authorization:

```text
current user
  -> workspace membership/access
    -> connection/thread ownership by workspace
      -> message/run/attachment ownership by parent relation
```

Required checks:

- list/create operations require access to the route workspace;
- thread operations resolve the thread and verify its workspace;
- run cancellation resolves run -> thread -> workspace;
- attachment download resolves attachment -> workspace before opening bytes;
- message-part attachment references must belong to the same workspace;
- WebSocket events are emitted only on the authenticated app connection and contain workspace IDs so the client can route them safely.

Do not accept a workspace path from the renderer as authority. Resolve the persisted workspace identity using existing core workspace services.

## Provider credentials

API keys are workspace-scoped secrets. The renderer may read only summaries such as connection ID, provider, label, status, and key suffix. It must never receive the full secret after submission.

Credential requirements:

- encrypt at rest with the existing server credential facility or a platform-backed key-encryption key;
- bind authenticated encryption additional data to credential purpose, workspace ID, connection ID, and provider ID;
- decrypt only immediately before constructing a provider client;
- never place keys in URLs, logs, notifications, query caches, error details, telemetry, or persisted renderer slices;
- overwrite a key by creating a new encrypted version and then retiring the old ciphertext;
- removing a connection destroys its secret but preserves local chat history and model provenance;
- provider tests use a minimal metadata/model request and a bounded timeout.

If Acorn does not yet have a production-grade credential service, that service is a prerequisite rather than an excuse to store plaintext in SQLite. Development-only fallback behavior must fail loudly and must not migrate into packaged builds.

## External data disclosure

Before first use, setup must state that message text and selected attachments are sent to the chosen provider under that provider’s policies. The UI should identify the active provider/model at send time.

Only the canonical request manifest is disclosed:

- selected conversation messages admitted by history budgeting;
- attachments explicitly referenced by those messages;
- future context items explicitly selected and snapshotted;
- adapter-required metadata.

Do not send workspace paths, repository names, usernames, unrelated thread data, internal database IDs, notification state, or hidden application metadata unless a later documented feature requires it.

Provider request IDs may be retained for support correlation. Do not retain provider request/response HTTP bodies outside canonical local message storage.

## Provider retention and deletion

Local deletion does not automatically prove deletion from provider logs or abuse-monitoring systems. The product copy and documentation must avoid promising remote erasure.

Version one sends request-local content and does not rely on provider-hosted conversation threads or persistent file objects. This minimizes remote lifecycle, but provider processing and retention policies still apply.

If a later adapter uses remote file or conversation objects, it must implement:

- explicit provider object metadata separate from canonical message data;
- best-effort remote deletion with durable outcome tracking;
- a user-visible distinction between local and remote deletion;
- retry/backoff for remote cleanup;
- documented provider-specific retention limitations.

## Untrusted model output

Model output is data, never application instructions.

- Render through the controlled Markdown component tree in [attachments-and-rendering.md](attachments-and-rendering.md).
- Disable raw HTML and remote image loading.
- Allowlist link schemes and route external navigation through the existing safe boundary.
- Do not interpret code blocks as commands or provide one-click execution in version one.
- Never use provider text as a filename, route, SQL fragment, notification target, CSS class, or log format.
- Keep provider metadata out of the visible assistant content unless mapped to a typed safe field.

The same policy applies to user-supplied Markdown because copied/imported content may be hostile.

## Attachment safety

The attachment subsystem must enforce byte limits while streaming, not after buffering. It validates type by content, generates server-side storage keys, and serves downloads with safe response headers.

Additional controls:

- no archive extraction, SVG, HTML preview, office macro execution, or arbitrary media decoding;
- bounded image/PDF metadata inspection;
- temporary files have restrictive permissions and unpredictable names;
- storage paths are never included in API responses;
- orphan cleanup never follows symlinks and operates only inside the configured object root;
- downloads require authentication and workspace authorization on every request;
- attachment names shown in OS notifications are prohibited by default.

See [attachments-and-rendering.md](attachments-and-rendering.md) for lifecycle and reconciliation.

## Abuse and resource controls

Apply layered limits:

| Boundary | Control |
| --- | --- |
| Connection create/test | Per-user and per-workspace rate limit; bounded upstream timeout |
| Attachment upload | Count, per-file, aggregate-turn, workspace quota, streaming byte cap |
| Turn creation | Idempotency key; one active run per thread; workspace/user concurrency caps |
| Provider call | Connect, first-byte, idle, and total duration timeouts; cancellation signal |
| Stream | Bounded delta size; sequence validation; animation-frame client batching |
| Message rendering | Text length, Markdown nesting/table caps, lazy history pagination |
| History assembly | Deterministic token/byte budget; bounded attachment materialization |
| Search/list | Cursor pagination and maximum page size |

Recommended initial concurrency is one run per thread, three active runs per workspace, and two active upstream runs per provider connection. Make these server-owned constants with tests, then expose configuration only if real usage justifies it.

The server must reject over-capacity before creating a run where possible. If capacity changes after acceptance, the durable run transitions to a retryable failure rather than remaining `queued` forever.

## Timeouts, retry, and backoff

Provider adapters classify errors into canonical codes. Retry automatically only when all are true:

- the failure occurred before any content delta was durably accepted;
- the provider error is explicitly transient;
- the request body can be reconstructed safely;
- the retry count and total deadline remain within a small bound;
- cancellation has not been requested.

After partial output, do not automatically retry because the provider may produce divergent duplicate content. Preserve partial output and let the user invoke Retry, which creates a new run.

Honor provider retry hints when bounded. Use jittered exponential backoff and abortable timers. Provider SDK default retries must be explicitly configured so they do not conflict with Acorn’s durable run state or cancellation semantics.

## Logging and diagnostic data

Use structured events with a correlation ID and safe identifiers:

```ts
type ChatOperationLog = {
  operation: "chat.run" | "chat.upload" | "chat.connection_test";
  correlationId: string;
  workspaceIdHash: string;
  providerId?: string;
  modelId?: string;
  runId?: string;
  phase: string;
  durationMs?: number;
  inputBytes?: number;
  outputBytes?: number;
  outcome?: "ok" | "cancelled" | "error";
  errorCode?: ChatErrorCode;
};
```

Never log:

- message or context text;
- attachment content or filename;
- API keys or authorization headers;
- raw provider request/response bodies;
- full workspace paths;
- signed/local attachment URLs;
- stack traces returned to the renderer.

Server logs may keep stack traces behind an internal error ID after applying secret redaction. User-visible errors receive a safe message and correlation ID.

## Metrics and health signals

Useful aggregate metrics:

- run count and terminal outcome by provider/model/error code;
- queue and end-to-end latency;
- time to first delta and inter-delta stalls;
- bytes/tokens in and out when providers report them;
- cancellation latency;
- reconnect recovery count and sequence-gap count;
- upload outcome, bytes, and validation code;
- orphan/temp object count and reconciliation failures;
- notification delivery/read outcome without message content.

Avoid high-cardinality labels for user IDs, workspace IDs, thread IDs, run IDs, or arbitrary model strings. Model/provider identifiers should be normalized to a bounded catalog or excluded.

Version one can begin with privacy-safe structured logs and diagnostic counters if Acorn lacks a metrics backend, but the operation boundaries must make later telemetry possible.

## Notification privacy

The default notification title is “Chat response ready” and may include the local thread title only when the existing notification privacy preference permits previews. It must not include generated response text, attachment names, API errors containing provider text, or workspace paths.

A notification click routes through typed local target data. It must never execute or navigate to a model-generated URL.

Completion is notification-worthy only when the exact chat surface was unattended. Notification persistence and read state reuse the generalized core notification service described in [ui-and-interactions.md](ui-and-interactions.md).

## Crash and restart recovery

On server startup:

1. find runs left in `queued` or `streaming`;
2. transition them to `interrupted`/failed with a retryable canonical error because upstream stream ownership was lost;
3. preserve the last durable assistant checkpoint;
4. broadcast/query-visible terminal state after the client reconnects;
5. sweep stale upload temporaries;
6. run bounded attachment metadata/object reconciliation.

Do not silently restart provider calls after a process crash; the upstream may have completed and automatic replay can duplicate cost or output.

SQLite migrations must be transactional where supported. Attachment filesystem reconciliation remains compensating and idempotent.

## Failure-mode table

| Failure | Durable result | User recovery |
| --- | --- | --- |
| Invalid/revoked key before stream | Failed run with `authentication_failed` | Update connection, retry |
| Provider rate limit | Failed run with retry hint | Wait or select another connection/model |
| Network loss before content | Retry within bounded policy, then failed | Retry |
| Network loss after content | Partial assistant message, failed | Copy partial or retry as new run |
| User cancellation | Partial assistant message, cancelled | Retry if desired |
| Renderer reload/navigation | Server run continues | Requery checkpoint and rejoin events |
| App/server crash | Run marked interrupted on startup | Retry explicitly |
| Upload interrupted | No attachment row; temp swept | Retry upload |
| Object missing for attachment metadata | Derived unavailable state; reconciliation alert | Reattach; investigate storage |
| Database commit fails after provider completion | Retain prior checkpoint, log high-severity failure | Reconcile; never report false completion |
| WebSocket event gap | Client detects sequence gap | Refetch run/message checkpoint |

## Security review gates

Before enabling the feature by default, verify:

- credential encryption and renderer non-disclosure;
- cross-workspace authorization tests for every resource route;
- Markdown/link/output injection tests;
- attachment spoofing, limits, traversal, symlink, and orphan tests;
- cancellation and timeout behavior with both provider adapters;
- log capture proving prompts, filenames, and keys are absent;
- packaged Electron CSP/navigation behavior;
- notification preview privacy;
- dependency audit and SDK version compatibility with Acorn’s supported Node runtime;
- provider terms/privacy links in setup copy.

## Operational rollout

Ship behind a local feature flag through these stages:

1. fake adapter and internal development only;
2. OpenAI canary with no attachments;
3. Anthropic canary with provider conformance suite;
4. portable attachments enabled after storage/security tests;
5. notifications and default-on release after restart/reconnect soak testing.

The flag gates source visibility and turn creation, not database readability. Disabling the flag must preserve history and permit safe cleanup/migration. Rollback must not require deleting chat tables or attachment objects.
