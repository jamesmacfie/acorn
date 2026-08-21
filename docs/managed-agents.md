# Managed agents

The agents plugin manages structured Claude and Codex sessions. It stores a durable normalized event
ledger and exposes the same session through the Agent Center, task Agent pane, HTTP routes, and live
WebSocket streams.

## Session model

A session belongs to one task and provider profile. It contains turns, normalized events, permission
and question requests, attachments, artifacts, usage snapshots, and lifecycle state. Each session
event has a durable sequence. HTTP pagination is the replay authority; the WebSocket is the live tail.

Session state changes and their event records are committed together. Once a turn has committed any
events, a restart never silently resubmits it. Reconciliation marks interrupted work and leaves an
explicit state for the owner to inspect.

A workspace-scoped list or search resolves the task ids first, through
`CoreServices.tasks.idsForWorkspace()`, then narrows this plugin's own tables to those ids. An empty
result narrows the answer to nothing rather than falling back to unfiltered: unfiltered is how a
workspace-scoped read would leak another workspace's sessions into the caller's view.

## Providers

Claude and Codex drivers adapt provider protocols into the common session/event model. A provider
PROFILE — how to launch the CLI, resume it, run it headless — is registered into a core registry and
used by terminal, agents, and workflows. A profile may be available for interactive terminal use
without the managed driver being enabled; `aider` is exactly that case.

**Both are first-party.** The profiles live in `plugins/agents/src/main/profiles/`, and the driver
registry is not a contribution point: `plugins/agents/src/node/index.ts` registers `claude` and
`codex` by literal. Adding an agent CLI means a change to plugins/agents.

A profile's `id` is persisted, not just displayed: it is stored as a session row's `profileId` and
as a workflow step's `profile`. Renaming one is a compatibility break across every stored row, not a
label edit.

Until recently each profile was its own workspace package, which read as an extension seam and was
not one — everything that actually encodes provider knowledge (drivers, normalizers, usage probes,
pricing) was already inside plugins/agents, so a new profiles package bought a menu entry whose agent
could not run. Making the driver registry a real contribution point is the change that would open
this up; the packages were not.

The Node probes provider availability and usage on bounded intervals. Usage and pricing details are
displayed in the Agent pane; pricing overrides are local preferences and provider prompts/responses
are not stored by the model-provider plugin.

## Client surfaces

- Agent Center aggregates sessions, search, provider health, attention, transcript import, and launch.
- The Agent pane shows the current transcript, composer, queue, context, requests, artifacts, and a
  same-task roster.
- Terminal handoff transfers an exclusive input-controller lease to a raw provider TUI. A managed
  session and a raw terminal cannot write the same provider session simultaneously.
- Notifications and the attention inbox represent requests that need the owner; dismissal of purely
  informational UI is client-local.

A session's lifetime is bounded by its task's. Sessions belonging to a task that is no longer active
— archived, cancelled, or hard-deleted with its project — are retired: they leave the live list every
glance surface reads (Agent Center, the Fleet stat, the attention inbox, the `sessions` dashboard
collection) and appear in the archived list instead. This is resolved when the list is read rather
than cascaded onto the session's own `archivedAt`, because removing a project deletes its tasks
outright and no cascade would visit those rows. A read that names a task id is exempt — the task pane
is looking at that task.

## Context, files, and attachments

Context is assembled by the Node from registered task sections and sent as an immutable snapshot.
Attachments are validated, task-scoped, stored through the shared blob cache, and referenced by
session records. Artifacts are authenticated no-store downloads; provider paths and worktree paths
are revalidated against the owning task.

## Operations and failure

Only one turn dispatches per session. Workspace/provider ceilings bound concurrency. Cancellation,
timeout, provider disconnect, and restart are explicit states. A live stream can be lost without
killing the provider process; the client reattaches from the session sequence or terminal replay tail.

Shutdown runs in the order that cannot resurrect what it just stopped: cancel every pending
provider-reconnect timer first, since a live one would call `ensureSession` and repopulate a session
the shutdown is trying to end, then stop each live provider child, then flush the durable event
buffer's per-session timers, then stop the webhook delivery pump. All of it runs before the plugin's
SQLite file closes, because any of those steps can still write a final row. The plugin's `dispose()`
(`plugins/agents/src/node/index.ts`) runs this sequence and then clears its own capability bridges
explicitly, rather than relying on teardown order, so a second boot in the same process (as
`apps/node/src/service/runtime.test.ts` exercises) never serves a request through the first boot's
closed database handle.

Each session mints its own scoped internal token rather than sharing one environment record
(`docs/security.md` § Credential handling), so the list of secrets to redact out of provider messages
and transcripts is collected as sessions start rather than computed once.

## Source map

The main implementation is in `plugins/agents/src/node`, `src/main`, `src/server/routes`, and
`src/client`; process/profile boundaries are supplied by `plugins/agents/src/main/index.ts` and the
terminal plugin.
