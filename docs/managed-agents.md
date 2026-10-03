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

## Pages

These pages cover sessions:

<a id="http-control-authority"></a>
<a id="standing-memory"></a>
<a id="session-model"></a>

- [Sessions](./managed-agents/sessions.md): HTTP control authority, standing memory, the session
  model, roster reads, and titles.

<a id="bounded-waits"></a>
<a id="cross-plugin-lifecycle"></a>
<a id="what-a-session-reports"></a>

- [Session events and waits](./managed-agents/session-events.md): the wait route, lifecycle events,
  and telemetry.
- [New-session defaults](./managed-agents/defaults.md): remembered options, inline chats, spawned
  agents, and the Settings page.

<a id="from-the-command-palette"></a>

- [From the command palette](./managed-agents/palette.md): the agents plugin's palette rows.

These pages cover harnesses and the work agents do:

<a id="harnesses"></a>

- [Harnesses](./managed-agents/harnesses.md): the two driver tiers, contributed harnesses, one-shot
  modes, and what the ACP driver declares.
- [Providers and plan usage](./managed-agents/providers.md): installed and signed-in harnesses, and
  usage bars.

<a id="app-access-approval"></a>

- [App-access approval](./managed-agents/app-access.md): Computer Use consent for Codex.

<a id="provider-native-subagents"></a>

- [Subagents](./managed-agents/subagents.md): provider-native subagents.

<a id="managed-delegation"></a>
<a id="reports-back-to-the-owner"></a>

- [Managed delegation](./managed-agents/delegation.md): child sessions and their reports.

<a id="custom-agents"></a>
<a id="from-a-plugin"></a>

- [Custom agents](./managed-agents/custom-agents.md): saved starts for a session.

<a id="web-activity"></a>
<a id="file-changes"></a>

- [Web activity and file changes](./managed-agents/activity.md): structured web and diff events.

<a id="context-files-and-attachments"></a>
<a id="draft-attachments-and-replacing-one"></a>

- [Context, files, and attachments](./managed-agents/attachments.md): attachments, artifacts, and the
  draft attachment seam.

<a id="operations-and-failure"></a>

- [Operations](./managed-agents/operations.md): the turn queue, plan limits, process lifecycle, idle
  stop, and shutdown.
- [Archived agent history](./managed-agents/history-retention.md): the retention pass.

These pages cover the client:

<a id="client-surfaces"></a>

- [Client surfaces](./managed-agents/client-surfaces.md): reads and drafts, the Agent pane, Agent
  Center, and retired sessions.
- [The transcript](./managed-agents/transcript.md): the window, tool cards, request cards, and
  subagent views.
- [The composer](./managed-agents/composer.md): the message field and its slots.
- [The transcript store](./managed-agents/transcript-store.md): how the client holds a session.
- [Transcript search](./managed-agents/transcript-search.md): the full-text index.
