# Phase 1: Side sessions on the Node

Date: October 27, 2026. Status: proposed.

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
