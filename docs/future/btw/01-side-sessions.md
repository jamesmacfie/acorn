# Phase 1: Side sessions on the Node

Date: October 27, 2026. Status: done.

## Completion note

October 27, 2026. Phase 1 landed on branch `phase-1-side-sessions`.

What landed:

- `POST /sessions/:id/btw` with a body of `{ requestedConfigOptions?: Record<string, string> }`. It's
  a device action, so service and task credentials get `403`. An unknown source gets `404`, and a
  source on an archived task gets fork's refusal, "The task is not active."
- `runtime.btw(sessionId, requestedConfigOptions)`, the bridge method, and `managedAgentApi.btw` in
  `managedClient.ts`.
- `AgentSessionOrigin = InlineDiffOrigin | BtwOrigin` in `contract/wire.ts`, used by `AgentSession`
  and `rowMapping.ts`. The create schema's `origin` is a discriminated union on `kind`.
- The route and the origin are documented in
  [Sessions § Side questions](../../managed-agents/sessions.md#side-questions).
- Tests: `runtimeBtw.test.ts` covers the mid-turn start, the origin read back from the row, the
  requested mode being applied, and the unknown source. `managed.test.ts` covers the credential
  checks, and `shared/inlineDiff.test.ts` covers the schema.

Decisions and deviations:

- `btw` uses `acceptSession`, not `createSession` as fork does. The route answers as soon as the row
  is stored, and the harness starts behind it. The client gets the session at once, which the split
  in phase 2 wants.
- `btw` drops the source's `requestedConfigOptions` and keeps only the caller's. With no options
  sent, the side session has none, so it doesn't re-apply a workflow step's choices.
- The `applyRequested` branch checks for any `origin`, not for each kind by name. Every origin is a
  session that picks its own options, which matches the comment above the saved-defaults check.
- `BtwOrigin` isn't exported, because nothing outside `wire.ts` names it and knip fails an unused
  export. Export it when a reader needs it.
- The copy doesn't flush the event buffer first. A flush would split a streaming message into two
  stored events and change the source's transcript. The cost is up to 40 milliseconds of streamed
  text missing from the copy.
- Readers that assumed every origin is a diff line now check `kind` first. They're in
  `InlineDiffCard.tsx`, the **Inline chats** section of `AgentTaskSidebar.tsx`, and the git plugin's
  `changesModel.tsx`.

What later phases need to know:

- A side session is hidden from the task sidebar until phase 3 adds its section. The managed list
  keeps only sessions with no origin, and **Inline chats** keeps only `inline-diff`.
- Phase 2 must send the harness's read-only permission value in `requestedConfigOptions`. The Node
  doesn't choose one.
- The answer to the README's question about transcript size: `renderSessionConversation` keeps the
  last 200 events and 100,000 characters. That's about 25,000 tokens a question at most.

## Step 1 result: Claude Code's own `/btw`

`/btw` doesn't work through Acorn. I didn't drive a full `pnpm dev:agent` session. I asked the Claude
Agent SDK that the ACP adapter drives (`@anthropic-ai/claude-agent-sdk` 0.3.197, under
`@agentclientprotocol/claude-agent-acp` 0.54.1) directly, signed in with the same account:

- `supportedCommands()` lists 81 commands, and `btw` isn't one of them.
- Sending `/btw what is 2+2?` as a prompt answers "/btw isn't available in this environment." as an
  ordinary assistant message, which goes into the conversation.

Acorn also never sends a second prompt into a running turn on its own. A message typed mid-turn is
queued until the turn ends. **Steer** hands it to the running turn, so it becomes part of that turn.
The Node half of this plan is needed for Claude too.

## Goal

A device caller can start a side session from any managed session, including one with a turn in
flight. The side session runs on the source's harness and profile, has the source's transcript
attached to its first draft, starts in the harness's read-only permission mode, and carries
`origin: { kind: 'btw', sourceSessionId }`.

## Steps

1. Check whether Claude Code's own `/btw` works through Acorn's composer. Start a Claude session in
   `pnpm dev:agent`, give it a long task, and type `/btw what file are you in?` while it runs. Record
   the result in this document. If it answers without disturbing the turn, stop and discuss with
   James before going further.
2. Add the origin type to `plugins/agents/src/contract/`:

   ```ts
   export type BtwOrigin = { kind: 'btw'; sourceSessionId: string }
   export type AgentSessionOrigin = InlineDiffOrigin | BtwOrigin
   ```

   Change `wire.ts` and `rowMapping.ts` to use `AgentSessionOrigin`. Every reader that assumes an
   origin is a diff location must narrow on `kind` first. Search for `.origin` across `plugins/` and
   `apps/` to find them.
3. Make `origin` in `createAgentSessionSchema` a discriminated union on `kind`, adding the `btw`
   shape with `sourceSessionId: z.string().uuid()`.
4. Add `runtime.btw(sessionId, requestedConfigOptions)`. It reads the source, builds the copy with
   `engine.forkContext(source)`, and calls `createSession` with the source's task, harness, and
   profile, `parentSessionId: source.id`, the `btw` origin, and a title such as
   `Side question: <source title>`. Unlike `fork`, it doesn't check for an active turn and never asks
   the harness for a native fork. Build `config` the way `fork` does, from the source's `config` with
   `forkKind: 'acorn-context-copy'`, `forkSourceSessionId`, and `pendingForkContext`, so the side
   session keeps the source's identity and authority snapshots and the composer attaches the copy
   unchanged. Then set `requestedConfigOptions` to what the caller sent, which replaces the source's.
5. Apply the requested options. In session start, add `session.origin?.kind === 'btw'` to the
   `applyRequested` branch beside `inline-diff`. The client sends the read-only permission value in
   phase 2, the same way the inline diff card does.
6. Add `POST /sessions/:sessionId/btw` in `routes/managed.ts`, with a body of
   `{ requestedConfigOptions?: Record<string, string> }`, through the bridge like `fork`. It's a
   device action, so service and task credentials get `403`. A source on an archived task gets the
   same refusal `fork` gives.
7. Add `btw` to `managedClient.ts` beside `fork`.
8. Document the route and origin in `docs/managed-agents/sessions.md`, next to forks.

## Acceptance

- `POST /sessions/:id/btw` on a session with a running turn answers a new session at once. The
  source's turn keeps running, and its queue and events are unchanged.
- The new session lists with `origin.kind === 'btw'` and `parentSessionId` set to the source.
- Its first draft carries the **History copied from** context, which includes the running turn's
  events so far.
- With the read-only value requested, the harness reports that permission mode in `configOptions`.
- A task credential gets `403`. An unknown source gets `404`.
- Tests cover the mid-turn start, the origin round trip through the row mapping, the schema refusing
  a `btw` origin with no `sourceSessionId`, and the credential checks.
