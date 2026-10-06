# Phase 09: activity feed, session options, and request notes

Status: proposed, 2026-10-07. Entry: phase 08 disposition recorded. Next:
[phase 10](./10-harness-bridges.md).

## Outcome

A loaded plugin draws a live view of a session's tool activity, context use, and subagents on every
harness, changes a session's advertised options under a high grant, and adds a warn-only note to a
pending request. None of this needs a bridge, because acorn already holds the data and the control.
Source: [what popular mods need](../09-session-reach.md).

## Ownership and data flow

Driver normalized events → provider event materializer → agents ledger → bounded activity projection
→ lifecycle publisher and `agents.activity.v1` read → loaded plugin worker → remote tree in a pane or
`agents:session-header`. Option changes go plugin → `agents.sessionControl.setConfig` → the runtime
path the model picker uses → driver `setConfig` → `session_metadata` → clients.

Read `plugins/agents/src/contract/lifecycle.ts`, `plugins/agents/src/contract/wire.ts`,
`plugins/agents/src/server/sessions/sessionControl.ts`, the runtime's config option handling in
`runtime.ts`, the remote point table in [remote points](../../../plugins/remote-points.md), and
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

Update [managed agents](../../../managed-agents.md), [remote points](../../../plugins/remote-points.md),
[events](../../../plugins/events.md), and [security](../../../security.md). Supply phase 10 with the
policy and meter package revisions.

## Verify before building

Recheck the usage fields each driver reports, subagent parent IDs per harness, lifecycle event
bounding, and loaded-plugin access to agents capabilities.
