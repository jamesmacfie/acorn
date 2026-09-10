# Phase 2: ambient attribution on the node

Status: not started. Waits on phase 0.

## Goal

A git spawn, a SQL statement, a process spawn, a sync decision, and a background refresh deep in a
call stack know which request, schedule, hook, or plugin caused them. One `AsyncLocalStorage` holds
`{traceId, spanId, owner}` and is entered at the seams phase 0 already spans. Workflow runs and steps
and agent sessions and turns are spans, emitted by those plugins through `ctx.telemetry`.

## Why this phase, and why now

Phase 0 answers "which plugin's route is slow". It cannot answer "which plugin's route made git
slow", because `core/git.ts` and `storage/sqlite.ts` are reached from anywhere and know nothing about
their caller. Threading an owner through every call would touch hundreds of signatures. One
async-local store touches five entry points.

## Scope

In:

- `packages/node-core/src/server/telemetry/context.ts` (new): one `AsyncLocalStorage<{traceId,
  spanId, owner}>`, `runWith(ctx, fn)`, `current()`.
- Entered at `requestIdMiddleware`, `dispatchPluginRoute`, `#runOnce`, `callOne` in the hook runner,
  and `runProcess`'s callers that have a task.
- `measure` reads `current()?.owner` when the caller passes `'core'`, and the git, SQL, and proc
  histograms gain the owner.
- `serveThenRevalidate` and `trackBackgroundRefresh` gain the owner in their label and a
  `sync.<decision>` count.
- `wsBroadcast` and `sendFrame`: the `ws.frame` histogram and `ws.shed` event.
- `agentTools.ts` `invoke()`: a `tool.call` span. `recordAudit`: an `audit.<action>` event.
- `plugins/workflows/src/server/workflowRunner.ts`: `workflow.run` and `workflow.step` spans.
  `plugins/agents/src/server/sessions/sessionExecute.ts` and `runtimeEngine.ts`: `agent.turn` and
  `agent.session` spans.
- A measurement: the boot test's `[helper:boot]` and the node's `[service:boot]` marks, and the
  `ACORN_PERF` request line, before and after, recorded in `docs/performance.md`.

Out: the renderer, which has no async context to enter.

## Design detail

**One store, entered at five places.** `AsyncLocalStorage` is stdlib and costs a few percent on
promise-heavy paths in the worst published measurements. The cost is paid only when telemetry is on:
`runWith` calls `fn()` directly when `telemetryEnabled()` is false. The measurement in scope is the
evidence; if it shows more than 5% on the request line, the store is entered only for plugin
dispatches and the git and SQL attribution stays `core` for core routes.

**Owner precedence.** An explicit owner passed to a verb wins over the ambient one. The ambient one
wins over `'core'`. A plugin's `ctx.telemetry` always passes its own id, so a plugin cannot inherit a
core owner or another plugin's.

**Compiled plugins instrument themselves.** Workflows and agents are compiled and have `ctx`. Their
spans are emitted from their own code with their own owner; core adds nothing plugin-specific.

## Code touched

- `packages/node-core/src/server/telemetry/context.ts` (new) and test.
- `packages/node-core/src/server/respond.ts`, `pluginHost/dispatch.ts`, `schedules/scheduler.ts`,
  `pluginHost/hooks.ts`, `core/git.ts`, `storage/sqlite.ts`, `core/proc.ts`, `sync/engine.ts`,
  `background.ts`, `transport/wsHub.ts`, `routes/plugins/agentTools.ts`, `audit.ts`.
- `plugins/workflows/src/server/workflowRunner.ts`; `plugins/agents/src/server/sessions/sessionExecute.ts`,
  `runtimeEngine.ts`.

## Tests

- `context.test.ts`: `current()` inside `runWith`, undefined outside, correct across an `await` and
  a `setTimeout`, and untouched when disabled.
- `respond.test.ts`: a route handler that calls `gitText` produces a `git.*` histogram with the
  request's owner.
- `dispatch.test.ts`: a plugin fetch that runs SQL produces a `sql.*` histogram with the plugin id.
- Workflow and agent tests: one span per run, step, session, and turn with the expected status.
- The boot test's marks, before and after, in the phase's commit message.

## Docs owed

`docs/telemetry.md` (new in phase 0) gains "Ambient attribution"; `docs/performance.md` gets the measurement and a
row for the store; `docs/workflows.md` and `docs/managed-agents.md` name their spans.

## Doors left open

1. The store's shape is `{traceId, spanId, owner}` and nothing else, so a request-scoped logger or a
   per-request deadline could ride it later without a second store.
2. `runProcess` is entered only when a caller has a task; a future task-scoped owner
   (`task:<id>`) would use the same field.

## Done when

- A plugin route that runs `git status` produces a `git.status` histogram sample with the plugin's id
  and the request's trace.
- The `ACORN_PERF` request line's p50 moves by less than 5% with telemetry on, measured on the same
  fixture before and after, and the number is in `docs/performance.md`.
- `pnpm lint` and `pnpm test` are green.

## Verify before building

- No `AsyncLocalStorage` or `async_hooks` import exists in the tree.
- `measure` in the phase 0 collector takes the owner as its first argument.
- `serveThenRevalidate`'s dedupe key is `${userId}:${resource}` with no provider dimension.
- `workflowRunner.ts` has `start`, `tick`, `execute`, and `finishRun`, and `deps.runChanged` and
  `deps.stepChanged` callbacks.
