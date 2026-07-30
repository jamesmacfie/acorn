# Agents migration and parity

**Status:** Normative current-plugin migration<br>
**Requirement prefix:** `CUR-AGENT`

## V1 coupling removal

| V1 coupling | Required V2 replacement |
| --- | --- |
| Agents and core share `agent_*` tables | isolated Agents database plus resource/outbox broker |
| `AgentTaskSidebar` imports `terminalApi` | optional Terminal session snapshot and focus intent |
| composition passes `startTerminalHandoff` callbacks | `acorn/terminal` handoff capability |
| `managedWorkflowStep` imports Agents and Workflows types | Workflows calls `session-execute@2` with schema-bound budgets |
| workflow queries live under `plugins/agents/client/workflowClient.ts` | Workflows owns its Client contracts |
| profile behavior is inferred/wired from built-ins | versioned profile/driver registry descriptors |
| task context contributors are function registries | manifest dependency plus `context-section` snapshot capability |
| tool renderers inspect runtime objects | schema-coordinate `agent-tool-renderer` contributions |
| server bridge slots expose implementation interfaces | query/command/capability broker |
| provider CLI processes receive service-local callbacks | fixed process and broker handles |
| agent WebSocket frames are special cases | declared product events and shared stream protocol |

`CUR-AGENT-130` No core, Terminal, Workflow, Context, Editor, Changes, provider-profile, or other
plugin module may import an Agents implementation module. Core may depend only on release-owned
system-plugin interfaces declared by the capability, event, resource, and health contracts.

`CUR-AGENT-131` The V1 central tables remain untouched. The V2 installation creates a new isolated
database and object roots; it MUST NOT copy V1 sessions, events, attachments, artifacts, webhooks,
usage, settings, or credentials.

`CUR-AGENT-132` The bundled default profile activates Agents with no provider login invented or
copied. Existing provider CLI login may be detected by the fixed-tool driver, but Acorn records no
credential until the owner completes the V2 provider setup/verification flow.

## V1 surface inventory

The migration baseline accounts for every cookie-authenticated route currently mounted at
`/api/agents`:

| V1 family | Routes |
| --- | --- |
| provider/account | `GET /providers`, `GET|PUT /pricing`, `GET /usage`, `POST /usage/refresh` |
| attachments | `POST /attachments`, `GET|DELETE /attachments/:attachmentId` |
| artifacts | `GET /sessions/:sessionId/artifacts`, `GET /artifacts/:artifactId`, `GET /artifacts/:artifactId/content` |
| session reads | `GET /sessions`, `/sessions/search`, `/sessions/:sessionId`, `/sessions/:sessionId/events`, `/sessions/:sessionId/wait`, `/sessions/:sessionId/export` |
| session writes | `POST /sessions`, `PATCH|DELETE /sessions/:sessionId`, `POST /transcript-imports` |
| turn/request | `POST /sessions/:sessionId/turns`, `PATCH|DELETE /sessions/:sessionId/turns/:turnId`, `POST /sessions/:sessionId/cancel`, `POST /sessions/:sessionId/requests/:requestId/resolve` |
| lifecycle | `POST /sessions/:sessionId/fork`, `/compact`, `/handoff-terminal`, `/resume-managed`, `/verify-imported-resume` |

The bearer V1 plugin published `agents.event`, `agents.session`, and `agents.deleted`, and operation
IDs `agents.providers.list`, `agents.sessions.list`, `agents.sessions.search`,
`agents.sessions.create`, `agents.sessions.import-transcript`, `agents.sessions.get`,
`agents.turns.enqueue`, `agents.turns.cancel`, `agents.turns.patch-queued`,
`agents.turns.remove-queued`, `agents.requests.resolve`, `agents.sessions.wait`,
`agents.sessions.patch`, `agents.sessions.fork`, `agents.sessions.compact`,
`agents.sessions.resume-managed`, `agents.sessions.verify-imported-resume`,
`agents.sessions.handoff-terminal`, `agents.sessions.delete`, `agents.sessions.export`,
`agents.artifacts.list`, and webhook list/create/patch/delete/deliveries.

`CUR-AGENT-160` Every V1 route, operation and event above MUST map to a V2 query, command, product
event, content stream, host setting, or an explicit removal. Artifact content and attachments use
streams; waits use snapshot plus subscription; V1 webhooks remain the constrained V2 webhook
resources.

`CUR-AGENT-161` V1 internal WebSocket frames `agent:event`, `agent:session`, and `agent:deleted` are
replaced by the declared product events/session stream. The implementation MUST NOT keep an
undocumented second live channel for Electron.

## Fresh-install sequence

1. The Acorn release verifies and activates the system package and empty database.
2. The Node discovers Claude and Codex executables/adapters and publishes redacted provider health.
3. Electron registers Agent Center, task pane, settings, attention, notification, and renderer
   contributions atomically.
4. Agent Center shows empty history plus installed/authenticated/unavailable provider states.
5. Creating a session selects a task, provider/profile, advertised configuration, and effective
   permissions; the Node lazily resolves the task worktree and starts the driver.
6. The first durable `ready` event enables the composer. A missing executable/login offers setup or
   raw Terminal fallback without damaging the task.

`CUR-AGENT-133` No first-run path may create an implicit task, execute from a repository root,
enable a provider by guessed capability, import V1 history, or silently authorize file/process/
secret/tool access.

## Visual and behavioral parity cases

`CUR-AGENT-134` Fresh Electron displays an Agents Fleet source with workspace-wide session history,
search, provider health, unread/attention state, import, and launch behavior matching V1 Agent
Center, now including explicit Node identity.

`CUR-AGENT-135` A PR/local task displays an Agent pane at the same default position, label, glyph,
minimum width, and `Cmd+Shift+A` shortcut. Pane add/close/move/resize/focus/maximize semantics remain
host-standard.

`CUR-AGENT-136` Claude and Codex structured sessions show provider-advertised model/reasoning/mode/
permission options, streaming assistant content, displayable reasoning, plans, tools, usage,
requests, attachments, artifacts, errors, and completion in transcript order.

`CUR-AGENT-137` The composer preserves multi-part input, `@` file references, context picker and
preview, immutable capture metadata, attachment validation, context budget display, provider
commands, send, and cancel.

`CUR-AGENT-138` Queued turns remain durable, visible, editable, reorderable, and cancellable before
dispatch. Restart preserves undispatched turns and never duplicates an active provider turn.

`CUR-AGENT-139` Permission, question, elicitation, and workflow-gate requests render exact host
controls, accept one idempotent response, survive reconnect, reject stale/double answers, and expire
without granting after process loss.

`CUR-AGENT-140` The task sidebar merges managed sessions, raw Terminal agents, and Workflow
attention; sorts needs-you first; opens the exact request/session; and invokes Terminal/Workflow
intents without cross-plugin imports.

`CUR-AGENT-141` “Continue in terminal” and “Return to managed” preserve exclusive-controller
behavior. An unclean/unsupported resume leaves history readable and offers a labeled context-copy
fork.

`CUR-AGENT-142` Import accepts supported Acorn/Claude/Codex transcripts as read-only history,
searches and exports them, and enables managed input only after explicit live reference
verification.

`CUR-AGENT-143` Fork, compact, archive/unarchive, permanent deletion, JSON/Markdown export, artifact
open/download, and per-session read state preserve V1 user-visible outcomes and distinguish
unsupported provider effects.

`CUR-AGENT-144` Agent usage loads Claude and Codex concurrently, caches five minutes, preserves
last-good stale data per provider, exposes refresh, reports reset windows and health, and never
hides a healthy provider because another fails.

`CUR-AGENT-145` Pricing settings preserve built-in groups, exact custom model overrides, unknown
model disclosure, estimation labels, reset, and refresh invalidation.

`CUR-AGENT-146` Completion/attention notifications are deduplicated and navigate to the exact
node/task/session/request while keeping OS text content-free.

`CUR-AGENT-147` Signed webhooks preserve create/list/edit/delete, task filtering, show-once secret,
bounded retry, delivery inspection, and completion/attention-only payloads under the hardened
network broker.

`CUR-AGENT-148` Large provider output becomes an authenticated artifact and deep-links through
typed intents to Changes, GitHub, Preview, Terminal, HTTP, Database, Notes/Memory, or Workflows when
that target capability is installed; otherwise it has a safe generic viewer/download state.

`CUR-AGENT-149` Raw profiles remain launchable through Terminal when a structured driver is absent,
incompatible, or owner-selected. Raw prompt heuristics remain visibly heuristic and cannot render
an authoritative approval card.

## Fault, offline, and fleet cases

`CUR-AGENT-150` Disconnecting a remote Node makes its Agent views read-only/stale, stops input and
approval, preserves local navigation labels, and resumes from the last contiguous event cursor or
authorized snapshot. Input is never buffered across disconnection.

`CUR-AGENT-151` A replay cursor older than Node retention clears the affected cached projection,
fetches authorized session/attention snapshots, records their snapshot sequence atomically, and
resubscribes without duplicating notifications or webhooks.

`CUR-AGENT-152` Driver crash before response retries only within the classified three-attempt
policy. Crash after response commits marks interruption and requires owner action. Both survive
Node restart with the same outcome.

`CUR-AGENT-153` Provider logout, missing executable, version incompatibility, malformed protocol,
rate limit, task deletion, worktree loss, permission revocation, config-trust invalidation, quota,
and object corruption each produce distinct degraded states and recovery actions.

`CUR-AGENT-154` With Agents startup failure, the shell, tasks and raw Terminal remain usable; all
Agents locations preserve unavailable placeholders and diagnostics. With Terminal absent, managed
Agents remain fully usable except controller handoff/raw roster.

`CUR-AGENT-155` Multi-Node Agent Center merges results deterministically, marks each Node, reports
partial failures, never mixes session identities, and sends create/prompt/approve/delete commands
only to the owning Node.

## Release acceptance

`CUR-AGENT-156` State-machine, repository, migration, outbox, FTS, object-store, fake-driver,
Claude/Codex fixture, scheduler, request-idempotency, controller, rendering, broker-authorization,
workflow-budget, webhook SSRF, restart, and fleet tests MUST pass before V2 release.

`CUR-AGENT-157` Boundary tests MUST reject direct cross-plugin imports, core-table access, raw
process/PTY creation, filesystem paths outside task handles, ambient secrets, private HTTP calls,
and publication of undeclared event types.

`CUR-AGENT-158` Parity testing MUST compare a scripted fresh V1 and fresh V2 task journey for
surface placement, shortcuts, session lifecycle, composer, transcript, requests, queue, context,
attachments, artifacts, usage, settings, notifications, terminal fallback, and failure recovery.

`CUR-AGENT-159` Agents is complete only when every V1 route/function has a query, command, stream,
setting, wizard, contribution, explicitly removed behavior, or owning-plugin capability in this
specification, with no behavior delegated through an implementation callback.
