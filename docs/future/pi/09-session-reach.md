# 09. What popular mods need that needs no bridge

Status: proposed, 2026-10-07. Not started.

Execution handoff: [phase 09](./phases/09-session-reach.md).

## Why

On 2026-10-07 the community directory at [claudemod.com](https://www.claudemod.com/browse) listed
172 entries across mods, skills, agents, commands, hooks, MCP servers, configs, and harnesses. Most
of them are content. The mods and hooks that are code fall into four groups:

| Group | Examples | Acorn today |
| --- | --- | --- |
| Live dashboards | Context and token meters, burn rate against the five-hour limit, cost, subagent trees, CI and pull request status | `agents:session-header` gets token and cost accounting. CI and pull requests are plugin data already. Nothing gives a plugin tool activity or the subagent tree. |
| Guards | Block destructive commands, confirmation codes, test-first guards | Phases 02 and 10. |
| Feedback after edits | Run the linter, type checker, or tests after an edit and tell the model | Phase 10's `after-tool` point. |
| Session control | Pause at a budget, cycle reasoning effort from a shortcut, desktop and audio alerts | `agents.sessionControl` offers only `cancel`, and only workflows calls it. No plugin can change a session's model or effort. |

Content is covered elsewhere: skills by [06](./06-agent-content.md), subagents by custom agents,
configs by context sections, and MCP servers by MCP management. Importing whole Claude Code plugin
bundles waits on [ecosystem](../ecosystem/README.md).

Three gaps remain that don't need a bridge, because acorn already holds the data or the control.

## Gap 1: a read-only activity feed

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

## Gap 2: changing a session's options

Extend `agents.sessionControl` with `setConfig(taskId, sessionId, optionId, value)`. Validate the value
against the options the harness advertised, through the same path the model picker uses. That makes
an "effort cycle" shortcut or a "switch to a cheaper model past 80% of the limit" plugin possible. It
is a high grant, because it changes what a person's session spends.

Leave `compact` out until a consumer asks. A budget plugin needs `cancel` too, so check that a loaded
plugin can be granted the capability rather than only the compiled workflows plugin.

## Gap 3: a note on a pending request

Open an `agents:request-card` remote point in `stack` mode, up to two, with props
`{ taskId, sessionId, requestId, kind, title }`. A policy plugin with warn-only rules shows why a
request looks risky without blocking it.

The point decorates the card. It never replaces the card or its buttons, so no plugin draws or
presses **Approve**. Confirmation codes and similar flows use phase 10's `ask` verdict instead.

## Later, each with its trigger

- **Notes on a message.** Claude's Mods can draw under any user or assistant message. Trigger: the
  advisor in [05](./05-advisor.md) needs to attach a concern to the turn it reviewed, rather than
  showing a card.
- **Plugin sounds.** Mods has `$.audio`. Acorn's notifications already alert on attention. Trigger: a
  request that notifications don't cover.

## Verify before building

- Which usage fields each driver reports, from a live Claude, Codex, and DeepSeek session.
- That `subagent` events carry a parent ID on every harness that reports subagents.
- The config option path the model picker uses, and whether it already accepts a non-person caller.
- Event bounding and grant projection for a new lifecycle channel.
