# Managed agents

The agents plugin runs structured Claude Code and Codex sessions, and harnesses other plugins
contribute. It stores each session as a durable ledger of normalized events, and serves the same
session to Agent Center, the task's Agent pane, HTTP routes, and live WebSocket frames. Read this page
to find the topic page that owns a part of it.

The headless [CLI](./cli.md#commands) uses the same provider list, session and turn operations, event
pages, and bounded wait route as Agent Center. It queues turns through the agents plugin, and doesn't
drive raw terminals or resolve approvals.

## Where the code is

- `plugins/agents/src/contract/wire.ts` holds the session, turn, event, request, and attachment wire
  types. `plugins/agents/src/contract/toolTone.ts` holds the tool status tone that Changes shares.
- `plugins/agents/src/server/` holds the runtime, drivers, delegation, usage, and routes.
  `plugins/agents/src/node/index.ts` wires it into the Node.
- `plugins/agents/src/client/` holds the pane, Agent Center, composer, and settings.
- Core receives only the attention snapshot in `packages/protocol/src/agents/attention.ts`.

## Usage records

The `usage-records` data source exposes one ledger usage event per record, including session, turn,
task, provider, model recorded on that turn, token deltas, USD cost, and whether cost was reported,
estimated from the named model price, or unknown. A reported cost is the session's running total for every harness, and Codex's tokens are too, so
each counts from the session's previous report. Deltas are computed before a dashboard time filter,
so a session crossing a window boundary contributes only usage inside it. Historical deletion or a
bounded ledger scan is reported as incomplete event coverage. Session totals are sums of these
records; any convenience total must use the same pricing and delta policy. The pure per-event token
pricing formula lives in `@acorn/protocol/usageCost.ts` and is shared with the `agent-cost` badge.

## Pages

These pages cover sessions:

- [Sessions](./managed-agents/sessions.md): HTTP control authority, standing memory, the session
  model, roster reads, and titles.

- [Session events and waits](./managed-agents/session-events.md): the wait route, lifecycle events,
  and telemetry.
- [New-session defaults](./managed-agents/defaults.md): remembered options, inline chats, spawned
  agents, and the Settings page.

- [From the command palette](./managed-agents/palette.md): the agents plugin's palette rows.

These pages cover harnesses and the work agents do:

- [Harnesses](./managed-agents/harnesses.md): the two driver tiers, contributed harnesses, one-shot
  modes, and what the ACP driver declares.
- [Providers and plan usage](./managed-agents/providers.md): installed and signed-in harnesses, and
  usage bars.

- [App-access approval](./managed-agents/app-access.md): Computer Use consent for Codex.

- [Permission policy](./managed-agents/permission-policy.md): `agents:before-permission`, a plugin's
  refusal of a harness permission request, and what it can't see.
- [Harness bridges](./managed-agents/loop-hooks.md): `agents:before-tool` and `agents:after-tool` on
  every tool call Claude Code makes, the bridge program, and why Codex has none.

- [Session messages](./managed-agents/session-messages.md): `agents:session-messenger`, a plugin's
  attributed note on a session, with its limits and idempotency.
- [Unattended follow-ups](./managed-agents/unattended-follow-ups.md): the operation a note on a
  workflow or delegated session joins, and `agents:turn-follow-up`, the review window its owner opens
  before it reports.
- [Review input](./managed-agents/session-events.md#review-input): `agents.reviewInput.v1`, one
  completed turn's text and final answer for a reviewer, bounded and checked against its task.
- [Activity](./managed-agents/session-events.md#activity): `plugin:agents:activity` and
  `agents.activity.v1`, a session's tool calls, subagents, and context fill, without content.
- [Session control](./managed-agents/session-control.md): `agents.sessionControl`, stopping a turn or
  changing an advertised option from another plugin, named in the transcript, and `agents.toolCaller`,
  the signed session behind another plugin's agent tool call.

- [Subagents](./managed-agents/subagents.md): provider-native subagents.
- [Background commands](./managed-agents/background-commands.md): shell commands that run past their turn.

- [Managed delegation](./managed-agents/delegation.md): child sessions and their reports.

- [Custom agents](./managed-agents/custom-agents.md): saved starts for a session.
- [Skills](./managed-agents/skills.md): a plugin's named procedures, approved on the Node and delivered
  at every start and resume, natively to Claude Code and Codex and as an index to other harnesses.

- [Web activity and file changes](./managed-agents/activity.md): structured web and diff events.

- [Context, files, and attachments](./managed-agents/attachments.md): attachments, artifacts, and the
  draft attachment seam.

- [Operations](./managed-agents/operations.md): the turn queue, plan limits, process lifecycle, idle
  stop, and shutdown.
- [Steer a running turn](./managed-agents/steering.md): handing a queued message to the running turn,
  and what each harness supports.
- [Archived agent history](./managed-agents/history-retention.md): the retention pass.
- [Repeated tool calls](./managed-agents/repeated-tool-calls.md): the warning when an agent repeats
  the same tool call.

These pages cover the client:

- [Client surfaces](./managed-agents/client-surfaces.md): reads and drafts, the Agent pane, Agent
  Center, and retired sessions.
- [The transcript](./managed-agents/transcript.md): the window, tool cards, request cards, and
  subagent views.
- [The composer](./managed-agents/composer.md): the message field and its slots.
- [The transcript store](./managed-agents/transcript-store.md): how the client holds a session.
- [Turn facts](./managed-agents/turn-facts.md): one row of numbers for each finished turn.
- [Transcript search](./managed-agents/transcript-search.md): the full-text index.
- [Cross-session reads](./managed-agents/cross-session-reads.md): the tools that let an agent find
  and read other sessions in its project.
