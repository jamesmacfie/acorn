# Agents Node and data model

**Status:** Normative current-plugin migration<br>
**Requirement prefix:** `CUR-AGENT`

## Node components

The Agents Node service contains a provider-driver registry, provider-process supervisor, scheduler,
pure session state machine, session repository, queue store, provider-event materializer,
attachment/artifact stores, search projection, usage collectors, pricing settings adapter, webhook
dispatcher, and broker adapters. The historical `main/` path does not imply Electron ownership.

`CUR-AGENT-020` Provider drivers MUST implement discovery/health, a versioned descriptor, start,
resume, submit, cancel, request response, event stream, process exit classification, and any
advertised fork/compact/archive/delete operations. Each live session receives an isolated protocol
process and task-scoped broker handles.

`CUR-AGENT-021` Claude ACP and Codex app-server v2 remain first-class structured drivers. A driver
MUST pass the common fake-driver suite for readiness, streaming, requests, cancellation, malformed
input, process loss, recovery, resume, and authority confinement before release.

`CUR-AGENT-022` Child processes receive a minimal locale/tool environment plus opaque, short-lived
broker handles. They MUST NOT inherit Node secrets, marketplace credentials, master keys, provider
tokens, unrelated environment variables, open descriptors, or another task's MCP/tool authority.

## Canonical resources

| Resource kind | Immutable identity and parent | Mutable specification | Observed status |
| --- | --- | --- | --- |
| `acorn.agents.session` | UUIDv7; task URI | provider/profile, kind, title, config, lineage | controller, runtime, attention, authority, model, sequence/read cursor |
| `acorn.agents.turn` | UUIDv7; session URI; ordinal | source, bounded input, effective policy | queue/execution state, attempt, provider ref, usage, error |
| `acorn.agents.request` | UUIDv7; session/turn | kind, safe prompt/options, expiry | pending/resolving/resolved/expired |
| `acorn.agents.event` | UUIDv7; session sequence | normalized event payload | immutable |
| `acorn.agents.attachment` | UUIDv7; task | media metadata/content digest | reference count/deletion state |
| `acorn.agents.artifact` | UUIDv7; session/turn | kind, title, media metadata, specialist link | content availability |
| `acorn.agents.webhook` | UUIDv7; optional task | HTTPS target, subscribed facts, secret ref | enabled/health |

`CUR-AGENT-023` Session runtime states are `creating`, `connecting`, `replaying`, `ready`, `working`,
`waiting`, `cancelling`, `reconnecting`, `stopped`, `failed`, and `archived`. Attention reasons are
`permission`, `question`, `workflow-gate`, `completed`, `error`, `unread`, and `none`. Authorities
are `protocol`, `lifecycle-hook`, `process`, and `terminal-screen`.

`CUR-AGENT-024` Turn states are `queued`, `dispatching`, `active`, `completed`, `cancelled`,
`failed`, and `interrupted`. Request states are `pending`, `resolving`, `resolved`, and `expired`.
Unknown state values fail contract validation rather than mapping to a more permissive state.

`CUR-AGENT-025` Normalized event variants are session-state, session-metadata, owner-message,
assistant-message, displayable-reasoning, tool, plan, usage, request, request-resolved, artifact,
file-change, terminal, turn-completed, error, diagnostic, and compaction. Each variant has a
digest-pinned schema and bounded fields.

## Isolated database

The plugin database owns these V2 tables:

| Table | Purpose and invariants |
| --- | --- |
| `p_sessions` | one row per session; task URI, driver identity/version, opaque resume ref, controller, state/attention/authority, lineage, revisions |
| `p_turns` | durable ordered queue; unique `(session_id, ordinal)` and `(session_id, idempotency_key)` |
| `p_events` | append-only normalized ledger; unique `(session_id, session_sequence)` |
| `p_requests` | provider request and single-resolution claim; unique provider request per session |
| `p_attachments` | task-scoped metadata and content-addressed object reference |
| `p_attachment_refs` | unique turn/attachment references with input position |
| `p_artifacts` | bounded artifact metadata and content/specialist resource reference |
| `p_operations` | command identity/input hash/terminal outcome |
| `p_webhooks` | target policy and encrypted secret reference, never plaintext |
| `p_webhook_deliveries` | idempotent content-free delivery attempts |
| `p_event_search` | FTS projection of allowlisted transcript text and metadata |
| `p_provider_health` | non-secret cached discovery/diagnostic state |

`CUR-AGENT-026` Agents MUST use its isolated `data.sqlite` through the storage broker. Core stores
only the plugin resource URI and lifecycle metadata; it MUST NOT copy agent rows into core tables.

`CUR-AGENT-027` A session-state mutation, turn/request projection update, append to `p_events`, and
plugin outbox append MUST commit in one plugin-database transaction. Publication occurs only after
that commit and tolerates duplicate relay.

`CUR-AGENT-028` The per-session sequence is monotonically increasing and authoritative for
transcript reconstruction. The global Node event sequence is transport order, not a replacement
for per-session ordering.

`CUR-AGENT-029` FTS may index titles, owner/assistant display text, safe tool summaries, file paths,
and artifact metadata. It MUST exclude private reasoning not marked displayable, credentials,
authorization data, provider raw bodies, terminal output, request resolutions marked secret, and
attachment bodies.

## Scheduling and recovery

`CUR-AGENT-030` A turn is dispatched only after its session has controller `acorn`, the driver
reports `ready`, no active turn exists, task/config trust is valid, and effective grants remain
current.

`CUR-AGENT-031` Interactive turns receive priority over workflow/automation turns, with bounded
aging so background work cannot starve. Queue order changes are revision-checked commands and apply
only before dispatch commits.

`CUR-AGENT-032` On process loss, undispatched turns remain queued, the active turn becomes
`interrupted`, unresolved provider requests become `expired`, and no approval is inferred. Automatic
retry is limited to driver-classified transient failures before any response event was committed,
using delays of 1, 2, and 5 seconds and at most three attempts.

`CUR-AGENT-033` Once any assistant, reasoning, tool, plan, artifact, file-change, terminal, or
provider request event for a turn commits, Acorn MUST NOT automatically resubmit that turn.

`CUR-AGENT-034` Request resolution first claims `pending → resolving` with the command ID. A provider
ack commits `resolved`; ambiguous transport outcome expires the claim and requires explicit owner
recovery. Concurrent resolution never answers twice.

`CUR-AGENT-035` Startup reconciliation MUST recover outboxes, classify interrupted active turns,
expire stale request claims, garbage-collect uploads older than the grace period, verify object
references, and resume only sessions with a valid provider reference, controller, grant, task, and
driver.

## Attachments, artifacts, and exports

`CUR-AGENT-036` A turn accepts at most 32 input parts and eight referenced files, with a 512 KiB
combined Acorn context-snapshot ceiling, 10 MiB per attachment, 25 MiB attachment aggregate, and
1 MiB decoded text per text/source attachment.

`CUR-AGENT-037` Accepted attachment formats are validated JPEG, PNG, GIF, WebP, PDF, and UTF-8
text/source. Filename is metadata only. Content sniffing, path traversal, symlink, quota,
decompression, interrupted-upload, and MIME mismatch checks occur before durable registration.

`CUR-AGENT-038` Attachments use a dedicated content-addressed store, not the GitHub blob cache.
Unreferenced uploads have a 24-hour grace period; permanent session/turn deletion releases
references and garbage collection removes unreferenced bytes.

`CUR-AGENT-039` Provider output that would exceed normal event limits becomes an artifact. Artifact
kinds are file, patch, command-output, screenshot, plan, export, HTTP exchange, database result, or
other. Specialist content carries a typed resource/navigation intent rather than embedding another
plugin's private data model.

`CUR-AGENT-040` Markdown export is human-readable; versioned JSON export is lossless over authorized
local history. Export authorization and redaction are evaluated at request time, and exports do not
contain provider secrets, internal handles, hidden reasoning, or raw request bodies.

## Usage, pricing, webhooks, and retention

`CUR-AGENT-041` Provider usage probes execute through fixed-tool process capabilities with a
20-second deadline and 2 MiB output cap. They use the provider CLI's existing login, return
normalized account-level aggregates, cache for five minutes in memory, and retain a stale last-good
provider result when refresh fails.

`CUR-AGENT-042` Claude local history inspection returns only aggregate token/time/session counts and
estimated savings/cost. Prompt, response, project path, message ID, and request ID MUST NOT leave
the Node. Unknown model pricing suppresses the estimate and identifies the unpriced model.

`CUR-AGENT-043` Pricing overrides are plugin settings scoped to the Node owner, not core
preferences. Exact custom model IDs outrank built-in groups; reset removes only the override.

`CUR-AGENT-044` Webhook targets require HTTPS except explicitly granted loopback development,
reject credentials, redirects, private/link-local/metadata destinations and DNS rebinding, and use
bounded retries. Events contain only session/task/event IDs, state, and time.

`CUR-AGENT-045` Webhook signing secrets are generated once, stored by the secret broker, shown once,
and used for HMAC-SHA-256 signing. Delivery logs contain status, attempt, response status, redacted
error, and times, never content or secret.

`CUR-AGENT-046` Archive is reversible local state. Permanent delete atomically tombstones/removes
plugin records and object references, then attempts provider deletion only if advertised. The result
distinguishes `deleted`, `unsupported`, and `failed`.

`CUR-AGENT-047` Normalized session history is durable plugin data included in encrypted backups;
provider-discovery caches, derived FTS, usage snapshots, and unreferenced temporary uploads are
excluded and rebuilt.

`CUR-AGENT-048` V2 starts with an empty Agents database. V1 sessions, transcripts, queues,
attachments, artifacts, pricing overrides, webhooks, usage state, and provider resume references
MUST NOT be imported.

`CUR-AGENT-049` Database migrations are release-coupled, reversible within the supported rollback
window, integrity-checked, and restored with the complete system-plugin generation on rollback.
