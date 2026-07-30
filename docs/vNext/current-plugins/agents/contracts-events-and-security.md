# Agents contracts, events, and security

**Status:** Normative current-plugin migration<br>
**Requirement prefix:** `CUR-AGENT`

All resource IDs below are node-qualified Acorn URIs. Query and command envelopes, idempotency,
revisions, errors, cancellation, and deadlines follow the shared
[command contract](../../contracts/queries-commands-and-results.md). This document defines the
Agents operation catalog that the manifest's digest-pinned schemas must implement.

## Query catalog

| Query ID | Target/input | Result and limits | Required capability |
| --- | --- | --- | --- |
| `acorn.agents.providers.list.v2` | Node; optional forced probe | descriptors, health, advertised capabilities/config; force rate-limited | `core.agent:read` |
| `acorn.agents.sessions.list.v2` | Node/workspace/task, archived/attention filters, cursor, ≤100 | session resource page | `core.agent:read` |
| `acorn.agents.sessions.search.v2` | Node/workspace/task, 1–500 char query, ≤100 | authorized FTS session hits with safe snippets | `core.agent:read` |
| `acorn.agents.sessions.snapshot.v2` | session, after session sequence, ≤2,000 events | session, turns, requests, event page, snapshot sequence | `core.agent:read` |
| `acorn.agents.sessions.events.v2` | session, after sequence, ≤2,000 | normalized event page | `core.agent:read` |
| `acorn.agents.attachments.get.v2` | attachment | metadata and authorized content stream descriptor | `core.agent:read` |
| `acorn.agents.artifacts.list.v2` | session | bounded artifact metadata | `core.agent:read` |
| `acorn.agents.artifacts.get.v2` | artifact | metadata and authorized content/resource intent | `core.agent:read` |
| `acorn.agents.usage.get.v2` | Node; optional provider | five-minute cached aggregate and freshness | `core.agent:read` |
| `acorn.agents.webhooks.list.v2` | Node; optional task | redacted registrations, health and bounded deliveries | `core.agent:read` |

`CUR-AGENT-080` Provider descriptors MUST omit executable host paths, environment, credentials,
provider protocol payloads, and diagnostics containing local paths. They include stable provider/
profile IDs, driver kind/version, installed/authenticated state, status authority, capabilities,
configuration options, commands, skill metadata, and safe diagnostics.

`CUR-AGENT-081` Search authorization is applied before FTS results leave storage. Snippets are
bounded and HTML-free; search MUST NOT reveal the existence of an unauthorized task/session.

## Command catalog

| Command ID | Target and effect | Idempotency / commit / deadline | Capability and confirmation |
| --- | --- | --- | --- |
| `acorn.agents.session.create.v2` | task; create configured managed session | keyed; session row + creation event; 30 s | `core.agent:create`, provider fixed-process/use-secret grants |
| `acorn.agents.transcript.import.v2` | task; import ≤10 MiB approved format | keyed; imported session/ledger; 60 s | `core.agent:create`, file/user-content read |
| `acorn.agents.import.verify-resume.v2` | imported session; live provider verification | keyed saga; verified controller/config event; 30 s | `core.agent:create`, provider process |
| `acorn.agents.attachment.upload.v2` | task; content stream | keyed; verified object + metadata; 60 s | `core.agent:prompt` |
| `acorn.agents.attachment.delete.v2` | unreferenced attachment | naturally idempotent; metadata tombstone; 10 s | `core.agent:prompt` |
| `acorn.agents.turn.enqueue.v2` | session; 1–32 input parts/policy | keyed; queued turn + event; 30 s | `core.agent:prompt`; external-send confirmation policy |
| `acorn.agents.turn.update-queued.v2` | queued turn; input/order | keyed/revision; turn projection + event; 10 s | `core.agent:prompt` |
| `acorn.agents.turn.cancel.v2` | queued/active turn | keyed; queue cancel or durable cancellation intent; 30 s | `core.agent:terminate` |
| `acorn.agents.request.resolve.v2` | pending request; typed resolution | keyed/revision; resolving claim before provider send; 30 s | `core.agent:approve`; host risk confirmation |
| `acorn.agents.session.update.v2` | session; title/config/read/archive | keyed/revision; projection + event; 10 s | `core.agent:prompt` or `read` by field |
| `acorn.agents.session.fork.v2` | session/turn; new title | keyed saga; new lineage/context session; 60 s | `core.agent:create` |
| `acorn.agents.session.compact.v2` | session | keyed saga; provider operation then compaction event; 300 s | `core.agent:prompt`; explicit content effect |
| `acorn.agents.session.handoff-terminal.v2` | session | keyed saga; controller lease then Terminal capability | `core.agent:terminate`, Terminal dependency |
| `acorn.agents.session.resume-managed.v2` | terminal-controlled session | keyed saga; verify terminal exit/provider resume then lease | `core.agent:prompt`, Terminal dependency |
| `acorn.agents.session.archive.v2` | session | naturally idempotent/revision; archived projection/event | `core.agent:terminate` |
| `acorn.agents.session.delete.v2` | session | keyed; local deletion/tombstone commit, provider delete saga; 300 s | `core.agent:terminate`; destructive |
| `acorn.agents.session.export.v2` | session; JSON/Markdown destination | keyed read-to-artifact saga; 60 s | `core.agent:read`, file/download confirmation |
| `acorn.agents.usage.refresh.v2` | Node/provider | keyed; in-memory snapshot only; 25 s | `core.agent:read`, fixed process |
| `acorn.agents.pricing.update.v2` | Node setting revision | keyed; settings commit/event; 10 s | `core.settings:write` |
| `acorn.agents.webhook.create.v2` | Node/optional task | keyed; registration + secret ref; 30 s | `core.network`, `core.secret:create`; external-send |
| `acorn.agents.webhook.update.v2` | webhook | keyed/revision; registration event; 10 s | same constrained network grant |
| `acorn.agents.webhook.delete.v2` | webhook | naturally idempotent; revoke secret/delete log/event | `core.network`; destructive |

`CUR-AGENT-082` Every command validates that session, turn, request, attachment, and task share the
same owning Node and ancestry. Payload-supplied parent IDs or file paths do not establish scope.

`CUR-AGENT-083` Turn dispatch is an asynchronous operation after the enqueue commit. Enqueue success
means “durably queued,” never “provider accepted.” Provider acceptance, output, completion, and
failure are later events.

`CUR-AGENT-084` Request resolution schemas are driver-advertised but host-validated and closed.
Secret question answers are encrypted operation input, excluded from events/history unless the
provider contract explicitly requires a redacted “answered” fact.

`CUR-AGENT-085` A wait is implemented as snapshot plus event subscription, not a special mutating
route. It supports ready, attention, turn-completed, and stopped predicates; a single wait is capped
at 30 seconds and resumes from an event cursor.

## Exported capabilities and dependencies

Agents exports:

| Capability | Semantics |
| --- | --- |
| `acorn-plugin://acorn/agents/capability/session-execute@2` | create/reuse a workflow-scoped session, enqueue a bounded turn, await a terminal result under inherited budgets |
| `acorn-plugin://acorn/agents/capability/session-snapshot@2` | authorized redacted session/transcript projection |
| `acorn-plugin://acorn/agents/capability/context-attach@2` | attach immutable context snapshots to a not-yet-dispatched turn |
| `acorn-plugin://acorn/agents/capability/attention-snapshot@2` | bounded task/workspace attention projection |

`CUR-AGENT-086` `session-execute@2` requires caller-supplied task, effective tool ceiling, time/token/
cost/turn budgets, idempotency key, deadline, and visibility. Child sessions can only narrow
budgets and authority. Agents owns execution; Workflows owns orchestration and checkpoint state.

`CUR-AGENT-087` Agents has optional dependencies on `acorn/terminal` controller-handoff and
read-only raw-session snapshot capabilities, and `acorn/workflows` attention/navigation contracts.
Missing optional dependencies remove only their handoff/roster behavior.

`CUR-AGENT-088` Provider drivers and executable profiles are discovered through the versioned
driver/profile registry. Agents MUST NOT import `profiles-claude`, `profiles-codex`, `terminal`, or
`workflows` implementation modules or infer capability from installation coordinate alone.

## Event catalog

The manifest publishes under `acorn.agents.*`:

| Event type | Subject and safe payload |
| --- | --- |
| `acorn.agents.session.created.v2` | session; task, provider/profile, kind, safe title |
| `acorn.agents.session.state-changed.v2` | session; prior/new runtime, authority, reason code |
| `acorn.agents.session.attention-changed.v2` | session; prior/new attention, optional request URI |
| `acorn.agents.session.controller-changed.v2` | session; prior/new controller, terminal URI if authorized |
| `acorn.agents.session.updated.v2` | session; changed non-secret field names/revision |
| `acorn.agents.session.archived.v2` | session; archived state |
| `acorn.agents.session.deleted.v2` | tombstone; provider deletion outcome |
| `acorn.agents.turn.queued.v2` | turn; session, source, ordinal |
| `acorn.agents.turn.dispatch-started.v2` | turn; attempt/provider |
| `acorn.agents.turn.updated.v2` | turn; ordinal/status change |
| `acorn.agents.turn.completed.v2` | turn; stop reason, redacted usage |
| `acorn.agents.turn.failed.v2` | turn; stable code, retryability |
| `acorn.agents.request.created.v2` | request; kind/title/expiry, no secret answer |
| `acorn.agents.request.resolved.v2` | request; outcome/choice kind, no secret content |
| `acorn.agents.request.expired.v2` | request; reason |
| `acorn.agents.transcript.item-recorded.v2` | session; event URI/session sequence/type and bounded display payload |
| `acorn.agents.artifact.created.v2` | artifact; kind/title/media/size/authorized intent |
| `acorn.agents.provider.health-changed.v2` | Node; provider, health, safe reason |
| `acorn.agents.webhook.delivery-changed.v2` | webhook; delivery state/attempt/status |

`CUR-AGENT-089` Detailed transcript events may be subscribed only with session-read authority and
are sensitivity-classified. Fleet attention subscribers receive the smaller attention event, not
prompts, responses, filenames, tool input/output, or context.

`CUR-AGENT-090` Session event commits first to the Agents ledger/outbox. The core broker then assigns
the Node event sequence. Duplicate global delivery MUST NOT duplicate transcript rows, projections,
webhooks, notifications, or workflow effects.

`CUR-AGENT-091` Streaming provider deltas are coalesced into bounded transcript chunks before
durability. Event payloads never exceed the 256 KiB shared limit; larger output becomes an artifact.

## Stream catalog

| Stream | Direction | Authority and behavior |
| --- | --- | --- |
| `agents.session-events` | Node → Client | ordered normalized event/resource patches; resumable by session and Node sequence |
| `agents.artifact-content` | Node → Client | bounded authorized binary/text content; no general cache |
| `agents.attachment-upload` | Client → Node | credit-controlled bytes with declared size/digest/media |
| `agents.operation-progress` | Node → Client | fork/compact/delete/export/import progress, safe fields only |

`CUR-AGENT-092` Provider protocol streams are internal to the driver host. A Client or other plugin
cannot subscribe to ACP or JSON-RPC frames.

## Security requirements

`CUR-AGENT-093` Provider credentials are Node-owned secret references. Drivers receive a brokered
provider operation or the narrowest fixed-tool login context; the Client, transcript, WASI
extensions, tool renderers, webhooks, and context contributors never receive credential plaintext.

`CUR-AGENT-094` Files and context are untrusted input. File references resolve descriptor-relative
inside the task root; context snapshots are schema/size/sensitivity checked; repository instructions
cannot widen the tool ceiling or approve repository trust.

`CUR-AGENT-095` Provider output is hostile text/data. Materialization validates event type, string/
array/object depth, patch and output sizes, URL/path/resource intents, and strips raw protocol/
authorization fields before any commit or render.

`CUR-AGENT-096` Agent tools are broker calls, not environment-inherited tokens or private HTTP
routes. Delegation is audience-, operation-, task-, session-, deadline-, and grant-version-bound.

`CUR-AGENT-097` Agent approval differs from plugin installation permission and repository config
trust. One approval MUST NOT grant either other authority or persist as “always” unless the host
shows and records that exact policy choice.

`CUR-AGENT-098` Terminal handoff transfers one controller lease only. It does not grant Agents
terminal input generally, and it does not allow Terminal to mutate the managed transcript.

`CUR-AGENT-099` Attachment/artifact download uses `nosniff`, safe disposition names, explicit media
allowlists, private no-store caching, authorization on every open/range, and no active-content
execution in the Electron origin.

`CUR-AGENT-100` Webhook SSRF checks apply to initial URL, DNS answers, redirects, retries, and
connection destination. Signing secrets and provider/content data MUST NOT enter delivery logs.

`CUR-AGENT-101` Diagnostics, audit, lifecycle events, crashes, and usage collection exclude prompts,
responses, reasoning, context, attachments, command bodies, provider raw payloads, file/worktree
paths, secret answers, tokens, broker handles, and complete webhook URLs.

`CUR-AGENT-102` Permanent delete is high-friction and names local history, object content, webhook
effects, provider-deletion uncertainty, and backup retention. Deleting an active session first
stops or checkpoints its driver.

`CUR-AGENT-103` Security conformance MUST cover forged provider events, malformed/deep/oversized
payloads, path traversal, symlink swaps, MIME spoofing, approval double-submit, ambiguous
acknowledgement, confused deputy, grant revocation during tool use, secret logging, webhook SSRF,
artifact active content, controller races, and restart after every commit boundary.

## Error vocabulary

`CUR-AGENT-104` Agents operations use the shared errors plus:
`provider-unavailable`, `provider-unauthenticated`, `provider-incompatible`, `session-not-ready`,
`controller-busy`, `turn-not-queued`, `turn-already-committed`, `request-not-pending`,
`request-expired`, `provider-outcome-ambiguous`, `resume-rejected`, `context-budget-exceeded`,
`attachment-invalid`, `attachment-too-large`, `artifact-unavailable`, `scheduler-overloaded`, and
`provider-operation-unsupported`.

`CUR-AGENT-105` Error detail is safe and actionable but non-oracular. It may identify a provider or
owner-visible resource after authorization; it never includes process command lines, raw provider
messages, secrets, hidden resources, or host paths.
