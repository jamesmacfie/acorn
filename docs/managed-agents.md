# Managed agents

Managed Agents is Acorn's task-scoped conversational runtime for Claude Code and Codex CLI. It
replaces the proposed standalone direct-API Chat product. A managed session always belongs to an
Acorn task and therefore to that task's worktree; Acorn does not create an implicit conversation in
the repository root.

Claude and Codex use structured provider protocols. Other detected agent profiles remain available
as raw terminal sessions. The terminal is a permanent escape hatch, not a compatibility layer that
Acorn intends to remove.

## Product surfaces

| Surface | Role |
| --- | --- |
| Agent Center | Workspace-wide history, search, provider health, unread/attention state, transcript import and launch |
| Task Agent pane | Session tabs, normalized transcript, composer, queue, requests, artifacts, lifecycle controls and context preview |
| Right rail | Compact working/needs-you roster; a request opens the exact task, session and request card |
| Terminal drawer | Shells, legacy agent TUIs, tool terminals and explicit managed-to-terminal handoff |

The transcript renders messages, displayable reasoning, plans, tools, file changes, attached
terminals, usage and provider requests from normalized protocol events. Controls are capability
gated from the provider descriptor; the client never infers support from a provider name or model
id. Markdown is parsed into controlled Solid components: raw HTML, unsafe URLs and automatic remote
images are rejected.

## Ownership and boundaries

The Electron-free utility service owns the complete runtime: provider processes, scheduling,
session state, SQLite transactions, the object stores, HTTP routes and WebSocket publication.
Electron main remains limited to native windows, dialogs, notifications, safe storage and narrow
task-addressed OS capabilities.

Across core and `plugins/agents`:

- `@acorn/protocol/managedAgents.ts` is the provider-neutral domain and normalized-event vocabulary.
- `@acorn/protocol/agentContext.ts` defines the immutable context snapshot contract and portable budget.
- `main/drivers/` owns protocol parsing and process supervision for each provider.
- `main/stateMachine.ts` owns pure command decisions and event projection.
- `main/sessionRepository.ts` owns append-first event transactions and session projections, while
  `main/store.ts` owns the durable turn queue and related queries.
- `main/runtimeEngine.ts` owns process supervision, scheduling and recovery;
  `main/runtime.ts` owns user-facing lifecycle commands and controller leases.
- `main/providerEventMaterializer.ts` bounds provider display data and promotes large output to
  artifacts before persistence.
- `server/routes/managed.ts` exposes the cookie-authenticated desktop API.
- `server/publicApi.ts` contributes the bearer automation API.
- `client/` owns Agent Center, the task pane, composer, transcript and request UI.

Three explicit contribution seams prevent the Agents plugin from absorbing specialist features:

- an agent-driver registry for structured providers;
- `AgentContextContribution` for immutable pane-owned context snapshots;
- a tool-renderer registry for typed deep links into owning panes.

Provider wire formats do not cross those boundaries and are not persisted. Acorn stores only
normalized, bounded events.

## Provider drivers

`AgentDriver` covers discovery and health, advertised capabilities/configuration, process start and
resume, turn submission, cancellation, provider requests, optional fork/compact/archive/delete and
failure classification. Each live session has an isolated protocol process.

### Claude

Claude runs through the packaged `claude-agent-acp` adapter, pointed at the user's installed
`claude` executable and existing CLI login. ACP messages, tools, plans, configuration, usage,
questions and permission options are normalized. The ACP session id is persisted only as an opaque
resume reference.

### Codex

Codex uses app-server v2 over supervised newline-delimited JSON-RPC. Thread/model/reasoning
configuration, skills, approvals, lifecycle notifications and requests come directly from the
protocol; managed sessions never scrape the Codex TUI. Native fork, compact, archive and delete are
used when advertised.

### Raw terminal profiles

Aider and other detected profiles keep the existing PTY/tmux path. Their state authority is
reported as lifecycle hook, process or terminal-screen evidence. A terminal heuristic is never
promoted to an authoritative permission card.

## Durable domain

The local database contains:

| Table | Purpose |
| --- | --- |
| `agent_sessions` | Task/profile/provider identity, provider resume reference, controller lease, lifecycle, attention, configuration, lineage and read/archive state |
| `agent_turns` | Durable ordered queue, immutable input/policy manifest, dispatch result, retry attempt, usage and timing |
| `agent_events` | Append-only, schema-versioned normalized event ledger with monotonic per-session sequence |
| `agent_requests` | Permission, question, elicitation and workflow-gate identity plus single-resolution state |
| `agent_attachments` | Metadata and references into the attachment object store |
| `agent_artifacts` | Metadata for large patches, output, screenshots, plans and exports |
| `agent_operations` | Command-idempotency results |
| `agent_events_fts` | FTS5 projection of titles, user/assistant text, tool summaries and artifact metadata |
| `agent_webhooks` / `agent_webhook_deliveries` | Signed completion/attention subscriptions and inspectable attempts |

Events are the local presentation/replay authority. Session, turn and request rows are query
projections updated in the same transaction as their event. A durable commit happens before a
WebSocket frame is published. High-frequency deltas are coalesced into bounded chunks, and large
content becomes an object-store artifact rather than unbounded event JSON.

Acorn deliberately does not store credentials, authorization headers, raw provider request/response
bodies, unbounded terminal output, base64 file bodies or reasoning the provider does not explicitly
make displayable. Local history is not silently substituted for provider execution context:
resumability remains the provider's authority.

## State, attention and authority

Runtime state and user attention are separate:

```text
runtime:   creating connecting replaying ready working waiting cancelling
           reconnecting stopped failed archived

attention: permission question workflow_gate completed error unread none

authority: protocol lifecycle_hook process terminal_screen
```

This avoids treating “waiting for the user” as process liveness and makes degraded terminal
evidence visible in diagnostics.

## Scheduling and recovery

Only one provider turn can be active in a session. Defaults are three active turns per workspace
and two per provider account. Extra turns remain durable and editable/reorderable until dispatch.
Interactive work receives priority, with bounded aging so workflows cannot starve indefinitely.
A structured turn is dispatched only after the protocol reports readiness.

On process loss Acorn keeps undispatched work queued, marks an active turn interrupted and expires
unresolved provider requests without granting them. It attempts bounded provider resume but never
automatically re-submits a turn after any response event has been durably accepted. Automatic retry
is limited to failures the driver classifies as safely transient before any response was accepted,
with a maximum of three attempts.

Permission/question resolution is claimed durably before transport. Concurrent resolution attempts
cannot answer a request twice; an ambiguous transport acknowledgement expires the claim instead of
silently retrying an approval.

## Controller handoff

Every session has one input controller: `acorn`, `terminal` or `external`. Managed UI and a raw TUI
never write to one provider session concurrently.

“Continue in terminal” finishes/cancels active work, checkpoints the provider reference, stops the
driver and transfers the lease. The managed transcript remains readable but cannot send or answer
requests. Returning requires the terminal to exit and the provider reference to pass a clean resume.
If it cannot, the user creates an explicitly labelled context-copy fork.

Imported Claude/Codex/Acorn transcripts are read-only local history. Import never invents a provider
session. A candidate provider reference must pass an explicit live verification before the imported
session becomes resumable.

## Context, attachments and artifacts

Context contributors produce immutable snapshots with source ownership, provenance, capture time,
freshness, sensitivity, a byte/token estimate and an owning-pane deep link. The composer opens a
source-owned selection modal before capture, previews the exact snapshots and enforces a 512 KiB
Acorn context ceiling before provider-specific limits. Shipped picker contributors cover
task/PR/issues/notes/memory, terminal, HTTP, saved database queries and Docker state. Worktree files
are attached with the composer's task-scoped `@` autocomplete.

Attachments live in a dedicated content-addressed store separate from the GitHub blob cache:

- at most 8 files per turn;
- 10 MiB per attachment and 25 MiB aggregate;
- 1 MiB decoded text per text/source attachment;
- validated JPEG, PNG, GIF, WebP, PDF and UTF-8 text/source content;
- a 24-hour grace period before unreferenced upload collection.

Names are metadata, never storage paths. Path traversal, symlinks, MIME spoofing, interrupted
uploads and quota limits are validated at the service boundary. Large generated output is stored as
an artifact and opened/downloaded through authenticated local routes. Typed artifacts deep-link
back to Changes, GitHub review, Preview, Terminal, HTTP, Database, Notes/Memory or Workflows instead
of duplicating those specialist products.

## Workflows

Claude/Codex agent steps can use the same managed runtime and event ledger as interactive sessions.
The workflow row stores `agentSessionId`, while its normal durable checkpoint and structured-result
semantics remain intact. Hidden workflow sessions still appear in Agent Center with lineage.

Workflow, step and child budgets may independently cap wall time, cost, input/output tokens and
turns; children can only narrow inherited limits. Human/provider requests use the same durable
attention path. The legacy headless runner remains for profiles that have not passed the managed
driver conformance suite.

## Automation and webhooks

The public plugin surface is `/api/v1/plugins/agents`. It separates:

- `agents:read` — provider health, history, search, status, events, artifacts and waits;
- `agents:write` — session/turn/lifecycle operations and webhook management;
- `agents:approve` — provider permissions, questions, elicitations and workflow gates.

Mutating calls use normal public-API idempotency. `/sessions/:id/wait` supports `ready`,
`attention`, `turn_completed` and `stopped` with a sequence cursor. The public WebSocket publishes
durably committed session/event/deletion frames.

Optional signed webhooks emit only content-free completion/attention envelopes. Secrets are
generated once, encrypted at rest and used for HMAC-SHA256 signatures. Targets must be HTTPS
(loopback HTTP is allowed for local development); credentials, redirects and private-network DNS
targets are rejected. Delivery uses bounded retries and keeps an inspectable log.

Automation cannot bypass task/worktree ownership, provider permissions, configuration trust or
workflow safety ceilings.

## Deletion, export and memory

Archive is reversible. Permanent deletion transactionally removes the local event/projection
records and object references, then garbage collection removes now-unreferenced bytes. Remote
archive/delete is attempted only when the driver advertises it, and the result explicitly reports
`deleted`, `unsupported` or `failed`.

Markdown exports are readable; versioned JSON exports are lossless. Completed sessions can create
reviewable memory candidates with provenance to session, turn, event and artifact. Partial streams
are not promoted automatically.

## Testing and conformance

The feature includes pure state-machine and replay tests, SQLite migration/FTS tests, object-store
safety tests, fake-driver runtime tests, Claude ACP and Codex fixture normalizer tests, scheduler
and controller tests, request idempotency tests, safe-rendering tests, public-scope tests, workflow
budget/replay tests and service restart behavior. The deterministic fake driver is the common
provider conformance harness; a provider is first-class only after it passes readiness, streaming,
request, cancellation, resume and malformed-event behavior.

## Deferred program work

Core desktop implements the local-first Claude/Codex architecture. These later workstreams must
extend the same session/event/controller contracts and are not shipped by the current desktop:

- remote `ExecutionHost` implementations and SSH transport;
- the paired mobile companion and encrypted relay;
- third-party driver/renderer distribution, signing and marketplace;
- structured Gemini CLI, OpenCode and GitHub Copilot drivers;
- advanced evaluation.

They must not introduce a second session model or move provider credentials away from the execution
host.
