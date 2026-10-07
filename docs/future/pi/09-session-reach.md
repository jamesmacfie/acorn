# Phase 09: activity feed, session options, and request notes

Status: proposed, 2026-10-07. Entry: phase 08 disposition recorded. Next:
[phase 10](./10-harness-bridges.md).

## Outcome

A loaded plugin draws a live view of a session's tool activity, context use, and subagents on every
harness, changes a session's advertised options under a high grant, and adds a warn-only note to a
pending request. None of this needs a bridge, because acorn already holds the data and the control.

## Design

The design as proposed on 2026-10-07. The implementation steps below refine it and win where they differ.

### Why

On 2026-10-07 the community directory at [claudemod.com](https://www.claudemod.com/browse) listed
172 entries across mods, skills, agents, commands, hooks, MCP servers, configs, and harnesses. Most
of them are content. The mods and hooks that are code fall into four groups:

| Group | Examples | Acorn today |
| --- | --- | --- |
| Live dashboards | Context and token meters, burn rate against the five-hour limit, cost, subagent trees, CI and pull request status | `agents:session-header` gets token and cost accounting. CI and pull requests are plugin data already. Nothing gives a plugin tool activity or the subagent tree. |
| Guards | Block destructive commands, confirmation codes, test-first guards | Phases 02 and 10. |
| Feedback after edits | Run the linter, type checker, or tests after an edit and tell the model | Phase 10's `after-tool` point. |
| Session control | Pause at a budget, cycle reasoning effort from a shortcut, desktop and audio alerts | `agents.sessionControl` offers only `cancel`, and only workflows calls it. No plugin can change a session's model or effort. |

Content is covered elsewhere: skills by [phase 06](./06-portable-skills.md), subagents by custom agents,
configs by context sections, and MCP servers by MCP management. Importing whole Claude Code plugin
bundles waits on [ecosystem](../ecosystem/README.md).

Three gaps remain that don't need a bridge, because acorn already holds the data or the control.

### Gap 1: a read-only activity feed

Every driver already normalizes tool calls, usage, subagent updates, and file changes into the
session ledger (`AgentNormalizedEvent` in `plugins/agents/src/contract/wire.ts`). That's true for
every harness, with no bridge. A plugin sees only turn, request, and session lifecycle events.

Add a bounded, harness-neutral projection:

- A `plugin:agents:activity` event for tool start and finish, carrying `toolCallId`, `kind`, `title`,
  `status`, and `paths`, plus subagent start and finish with its parent.
- A `usage` frame with context tokens, context window, and the rate-limit percentages the harness
  reports, when it reports them.
- An `agents.activity.v1` read that rebuilds the current state for one session, so a pane opened
  mid-session doesn't start empty.

Leave tool output, message text, and reasoning out. The title is what the transcript card already
shows. Command lines stay with the hooks, where the grant is explicit.

### Gap 2: changing a session's options

Extend `agents.sessionControl` with `setConfig(taskId, sessionId, optionId, value)`. Validate the value
against the options the harness advertised, through the same path the model picker uses. That makes
an "effort cycle" shortcut or a "switch to a cheaper model past 80% of the limit" plugin possible. It
is a high grant, because it changes what a person's session spends.

Leave `compact` out until a consumer asks. A budget plugin needs `cancel` too, so check that a loaded
plugin can be granted the capability rather than only the compiled workflows plugin.

### Gap 3: a note on a pending request

Open an `agents:request-card` remote point in `stack` mode, up to two, with props
`{ taskId, sessionId, requestId, kind, title }`. A policy plugin with warn-only rules shows why a
request looks risky without blocking it.

The point decorates the card. It never replaces the card or its buttons, so no plugin draws or
presses **Approve**. Confirmation codes and similar flows use phase 10's `ask` verdict instead.

### Later, each with its trigger

- **Notes on a message.** Claude's Mods can draw under any user or assistant message. Trigger: the
  advisor in [phase 04](./04-model-grants-and-advisor.md) needs to attach a concern to the turn it reviewed, rather than
  showing a card.
- **Plugin sounds.** Mods has `$.audio`. Acorn's notifications already alert on attention. Trigger: a
  request that notifications don't cover.

## Ownership and data flow

Driver normalized events → provider event materializer → agents ledger → bounded activity projection
→ lifecycle publisher and `agents.activity.v1` read → loaded plugin worker → remote tree in a pane or
`agents:session-header`. Option changes go plugin → `agents.sessionControl.setConfig` → the runtime
path the model picker uses → driver `setConfig` → `session_metadata` → clients.

Read `plugins/agents/src/contract/lifecycle.ts`, `plugins/agents/src/contract/wire.ts`,
`plugins/agents/src/server/sessions/sessionControl.ts`, the runtime's config option handling in
`runtime.ts`, the remote point table in [remote points](../../plugins/remote-points.md), and
`AgentRequestCard.tsx`. Agents owns every projection and the point. Plugins read public contracts only.

## Implementation

1. Define the activity frames and the rebuild read in agents' public contract. Project tool start
   and finish, subagent start and finish with parent, and usage snapshots from the materialized
   ledger. Keep tool output, message text, reasoning, and command lines out. Bound every string and
   the rebuild size.
2. Publish `plugin:agents:activity` from the lifecycle seam after events commit, never before. Make
   the rebuild read agree with the published frames after a Node restart and during replay.
3. Add `setConfig` to `agents.sessionControl`. Validate task and session ownership, then the option
   and value against the session's advertised options. Reuse the picker's path so persisted config and
   `session_metadata` stay consistent. Refuse terminal-controlled and archived sessions. Record the
   calling plugin in the session's diagnostics so a person can see who changed the model.
4. Check whether a loaded plugin can be granted `agents.sessionControl` at all. If it can't, add the
   grant with distinct trust copy for cancel and for option changes.
5. Open `agents:request-card` as a `stack` point, up to two, on both hosts. Props are
   `{ taskId, sessionId, requestId, kind, title }`. Draw it inside the card, below the host's controls.
   The host keeps the buttons.
6. Build a standalone session meter plugin as the consumer for steps 1 to 4: a pane with tool
   activity, context fill, and the subagent tree, plus a command that cycles reasoning effort.
   Extend phase 02's policy plugin with warn-only rules drawn through `agents:request-card`.

## Verification and acceptance

Apply [shared verification](./README.md#verification-for-every-phase). Prove:

- The same tool and subagent activity reaches the meter for Claude, Codex, and DeepSeek sessions,
  and a pane opened mid-session rebuilds to the same state.
- No activity frame carries output, message text, or a command line.
- An option the harness doesn't advertise is refused, and an accepted change shows in the session's
  picker on both clients.
- A request-card note appears on a pending request and leaves approval to the person.

## Documentation and handoff

Update [managed agents](../../managed-agents.md), [remote points](../../plugins/remote-points.md),
[events](../../plugins/events.md), and [security](../../security.md). Supply phase 10 with the
policy and meter package revisions.

## Verify before building

Recheck the usage fields each driver reports, subagent parent IDs per harness, lifecycle event
bounding, and loaded-plugin access to agents capabilities.

From the design:

- Which usage fields each driver reports, from a live Claude, Codex, and DeepSeek session.
- That `subagent` events carry a parent ID on every harness that reports subagents.
- The config option path the model picker uses, and whether it already accepts a non-person caller.
- Event bounding and grant projection for a new lifecycle channel.
