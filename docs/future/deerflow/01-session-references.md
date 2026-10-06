# Session references in the composer

Status: proposed, October 6, 2026. Not started. Part of the [DeerFlow review](./README.md).

## Problem and outcome

You often want one agent to build on what another agent already worked out: the plan an earlier
session agreed, or the cause a debugging session found. Today you copy and paste the text, or you
fork the whole session.

Let the person attach one or more of the task's other agent sessions to their next message. The
agent receives a bounded snapshot of each conversation as context, marked as text the person didn't
write. The attachment applies to that one message only.

## What DeerFlow does

DeerFlow's composer has a **Reference a conversation** button. You pick up to three of your recent
conversations, and they show as chips on the next message only. The agent gets a `read_conversation`
tool that pages the visible text of those conversations, and its access ends when the run ends. Text
in old messages doesn't grant access. See the "Reading a Referenced Conversation" section of
`references/deer-flow/README.md`.

## What acorn has already

Two pieces cover most of the work:

- `buildForkContext` in `plugins/agents/src/server/sessions/runtimeContext.ts` turns a session's last
  200 user messages, assistant messages, file changes, and plans into one `context` input part, capped
  at 100,000 characters, with provenance and a deep link back to the source session. Context-copy forks
  use it.
- The composer's context picker draws every `AgentContextContribution`
  (`plugins/agents/src/client/composer/AgentContextPickerModal.tsx`). The terminal plugin's
  contribution in `plugins/terminal/src/client/agentContextContribution.ts` is a short example of the
  `options` and `capture` pair. The registry is
  `packages/client-core/src/host/registries/sources/agentContexts.ts`.

Captured contexts already ride the draft, persist with it, show in the turn's **Context manifest**
fold, and count against the per-turn context budget.

## Scope

In scope:

- An **Agent sessions** context contribution, owned by the agents plugin, that lists the current
  task's managed sessions other than the one being written to.
- A device-only Node route that renders a snapshot for one session.
- The snapshot wrapped as pasted content, so the receiving agent treats it as information.

Out of scope for the first cut:

- Sessions from other tasks or workspaces. The capture scope carries an optional workspace ID, so a
  workspace-wide list is a later step that needs its own authorization check.
- A paging tool for transcripts longer than the cap. [History search](./03-history-search.md) can
  grow a read scope for referenced sessions later.
- `@session` tokens typed in the message field. The picker is enough to learn whether people use this.

## Design

Data flow: the person opens the context picker, chooses **Agent sessions**, and ticks one or more
rows. The contribution's `capture` calls the route once per row. The route reads the session through
the agents store, renders the snapshot, and returns it. The composer adds each result to the draft's
contexts. On send, each context goes to the harness as an `<acorn-context>` block through
`plugins/agents/src/server/drivers/contextBlock.ts`.

1. Split `buildForkContext` so the event-to-text rendering is one function and the fork wording is
   another. A reference needs a different preamble: "A conversation from another agent session in
   this task, attached by the user for this message."
2. Wrap the rendered conversation with `pastedContent` from `@acorn/plugin-api/node`. A referenced
   session can hold text an agent read from a hostile page, and the fork path has no wrapper because
   the fork's own provider wrote that text.
3. Add `GET /v1/p/agents/sessions/:id/reference-context`. It's device-only, like the other session
   control routes in [sessions](../../managed-agents/sessions.md#http-control-authority), and checks
   that the session belongs to the caller's task. It returns one `AgentContextSnapshot`.
4. Register the contribution from the agents client. `options` lists the task's sessions newest first,
   at most 50, excluding the target session, with title, harness, and last activity. `capture` calls
   the route for each selected ID.
5. Label the snapshot `Session · <title>`, set `resourceId` to the session ID, and keep the deep link
   so the manifest row opens the source.

The contribution's `options` receives `AgentContextCaptureScope` from
`packages/protocol/src/agents/agentContext.ts`, which holds a task ID and an optional workspace ID,
not the target session. Either add an optional `sessionId` to that scope, which is an additive
contract change, or accept that the list includes the session you're writing to. Prefer the scope
change.

## Limits and risks

- The 100,000-character cap drops the start of a long session. Say so in the snapshot when it
  truncates, the way the fork path ends at the last 200 events.
- Several large references can exceed the per-turn context cap. The composer's budget already warns.
- Each snapshot is a copy at capture time. Later changes to the source don't reach the turn.

## Verification

- A unit test for the split renderer, covering truncation, the pasted-content wrapper, and an empty
  session.
- A route test for a foreign task ID, an unknown ID, and a task credential, which gets a 403.
- A composer test that a captured reference shows in the manifest and survives a draft reload.
- In the real app, start two sessions in one task, reference the first from the second, and confirm
  the agent can quote it. Use `pnpm dev:agent -- --session <name>` and the `dev:agent:ui` driver.

## Docs to update

[The composer](../../managed-agents/composer.md) and
[contribution kinds](../../contribution-kinds.md) if the scope type changes.

## Verify before building

- Whether the terminal client draws the context picker, and what it needs to draw this contribution.
- Whether `exportSnapshot` is the right read for a session that's running, or whether the reference
  should stop at the last settled turn.
- The per-turn context cap and how the composer reports a snapshot over it.
