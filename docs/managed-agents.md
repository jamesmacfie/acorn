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

## Providers

Claude and Codex drivers adapt provider protocols into the common session/event model. A provider
PROFILE — how to launch the CLI, resume it, run it headless — is registered into a core registry and
used by terminal, agents, and workflows. A profile may be available for interactive terminal use
without the managed driver being enabled; `aider` is exactly that case.

**Both are first-party.** The profiles live in `plugins/agents/src/main/profiles/`, and the driver
registry is not a contribution point: `plugins/agents/src/node/index.ts` registers `claude` and
`codex` by literal. Adding an agent CLI means a change to plugins/agents.

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

## Context, files, and attachments

Context is assembled by the Node from registered task sections and sent as an immutable snapshot.
Attachments are validated, task-scoped, stored through the shared blob cache, and referenced by
session records. Artifacts are authenticated no-store downloads; provider paths and worktree paths
are revalidated against the owning task.

## Operations and failure

Only one turn dispatches per session. Workspace/provider ceilings bound concurrency. Cancellation,
timeout, provider disconnect, and restart are explicit states. A live stream can be lost without
killing the provider process; the client reattaches from the session sequence or terminal replay tail.

## Source map

The main implementation is in `plugins/agents/src/node`, `src/main`, `src/server/routes`, and
`src/client`; process/profile boundaries are supplied by `plugins/agents/src/main/index.ts` and the
terminal plugin.
