# Agent runtime — corrections and ceilings

**Status:** findings + design corrections · **Date:** 2026-07-07 · **Companions:**
[review.md](./review.md) §1e, [contribution-points.md](./contribution-points.md) §4.8/§4.10/§4.11,
[implementation.md](./implementation.md) Phase 8 + ongoing tracks, [ux.md](./ux.md) §6 (cancel +
live-tail UX)

Phase 8 makes the workflow *engine* extensible (step-kind registry, policy registry, explicit
`joins:`). This doc covers what that leaves untouched: how the runtime actually behaves — how
steps pass data, what governs agent spend, what the user can see and stop. It is grounded in a
full sweep of `workflowRunner.ts`/`workflowWiring.ts`/`headless.ts`/`notes.ts` and the agents
panel.

The headline verdict is positive: **the substrate is right.** Inter-agent state flows through the
worktree, repo-scoped notes, memory, and the DB — human-readable, inspectable, no message bus —
and that non-design should be kept deliberately (§5). But the sweep found one confirmed
correctness bug, three small high-value corrections, and three missing UI controls. All are
independent of the phase sequence and mostly tiny.

One boundary up front: these are *additions* on top of the existing PTY/session contracts users
already rely on — tmux persistence vs `node-pty` death-with-app, ring-buffer-only replay (no
output on disk), Shift+Enter newline, the three `sendToAgent` modes with bracketed-paste
wrapping, the shared agent-state vocabulary, edge-driven notices/unread, ⌘W focus containment.
Those are pinned in [feature-parity.md](./feature-parity.md) §9; nothing in this doc relaxes
them, and the WS/profile refactors (Phases 3 and 8) re-verify them.

---

## 1. How it works today (the facts the other docs don't record)

- **Data passes between steps via handoff notes, not wiring.** A completed agent step's
  structured output (or text result) is appended to a note (`workflowRunner.ts:246-248` →
  `writeHandoff`, `workflowWiring.ts:63-66`); the next step's prompt is
  `def.prompt + assembleContext(taskId)` (`workflowRunner.ts:229-232`), and the handoff rides
  back in via `TaskContext.notes`. No step references another step's output directly; prompts
  are literal TOML strings with no templating.
- **Agent steps are headless spawns**, not PTYs: `claude -p --output-format stream-json
  --permission-mode dontAsk` / `codex exec --json` (`headless.ts:30-56`), 10-minute timeout with
  process-group SIGKILL (`headless.ts:109,122-130`), stdout parsed for the last `result` event
  (`headless.ts:79-98`). Only claude-code and codex have headless modes; shell/aider return null.
- **Persistence is exemplary** (review.md already credits it): every step's
  `inputsJson`/`resultJson` (last 100 stream events)/`structuredJson`/`sessionId`/`costUsd` land
  in `workflow_steps` (`db/schema.ts:460-481`); `reconcile()` resets orphaned `running` steps to
  `pending` on boot (`workflowRunner.ts:152-161`).
- **The agents panel** merges PTY sessions + workflow steps into an urgency-sorted roster
  (`features/agents/model.ts:101-124`), approves/rejects gates, and can resume a completed step's
  session as an interactive TUI (`model.ts:83-88`). It refetches runs + per-run steps every 3 s
  (`AgentsPanel.tsx:45`).

---

## 2. Corrections

### 2.1 Handoff notes leak across runs and tasks (confirmed bug)

Every run appends to one shared slug, `workflow-handoffs` (`workflowWiring.ts:65`). Three
compounding consequences:

1. **Cross-run bleed:** run #2 on a task reads run #1's stale handoffs — the context assembler
   inlines every included note into every step's prompt.
2. **Cross-task bleed:** `notesStore.append()` creates the missing note with
   `originTaskId: null` (`notes.ts:181`) — and doesn't accept an `originTaskId` option at all
   (`notes.ts:172`). Notes are workspace(repo)-scoped (`taskWorktree.ts:167-184`), and the
   context filter shares any note *without* an `originTaskId` across tasks
   (`knowledgeIpc.ts:74-76`). So two tasks on the same repo read each other's workflow handoffs.
3. **Silent truncation kills the mechanism:** the assembler slices each note body to 2,000 chars
   and takes only the first 10 notes (`knowledgeIpc.ts:78-80`). Once the shared note outgrows
   that, **newer handoffs stop reaching the next step entirely** — the pipeline keeps "working"
   while passing stale data.

**Fix:** per-run slug (`workflow-handoffs-<runId>`), `append()` grows an `originTaskId` option
(stamped from the run's task), and the run's completion (`done`/`failed`/`safety-rail`) flips the
note to `included: false` — it stays as an audit trail but leaves the context. Small, and it
makes the handoff mechanism actually mean "output of the previous step in *this* run".

### 2.2 Session resume is plumbed and never used

`resumeSessionId` exists in the headless layer (`headless.ts:25,35`) and no caller passes it —
`runStep` opts are always `{prompt, model, schema}` (`workflowRunner.ts:232,262,302,373`). The
cost is concrete in **ci-loop**: every iteration spawns a fresh session that re-reads the entire
context and has no memory of what it tried last iteration. Passing the previous iteration's
captured `sessionId` as `resumeSessionId` is a one-field change that makes ci-loop meaningfully
smarter and cheaper. (Sequential top-level steps should **stay** fresh sessions — different step,
different job; the handoff note is the intended carrier there. Resume is for iteration *within*
a step.)

### 2.3 Nothing governs the most expensive resource in the app

- Fan-out runs all children via `Promise.all` with no concurrency cap
  (`workflowRunner.ts:298-314`) — a plan step that emits 12 tasks spawns 12 concurrent headless
  agents.
- `costUsd` is captured per step and never aggregated or bounded; the only limit anywhere is the
  10-minute per-step timeout.

state §5.2's budget posture covers pollers and badges but not agents. **Fix:** one
`MAX_CONCURRENT_HEADLESS` constant (a semaphore around `runStep`; fan-out children queue), and an
optional workflow-level `max_cost_usd` in the TOML — when the run's summed `costUsd` crosses it,
the run parks at `safety-rail` (the state already exists for exactly this shape of stop,
`workflowRunner.ts:380-386`). Both are data-driven policy in the points §4.8 sense: the point is
that a runaway fan-out has a ceiling, not that the ceiling is clever.

### 2.4 Named ceilings, deliberately kept (write them down, don't fix them)

- **Fan-out children get only their seed prompt** — no context assembly
  (`workflowRunner.ts:301`). Defensible (children are scoped subtasks; the parent plan step chose
  what each needs) but currently an accident of implementation. Make it a documented rule of the
  fan-out contract.
- **Join is all-or-nothing:** any non-`done` child fails the join and the run
  (`workflowRunner.ts:322-347`). No partial continue, no single-child retry. Acceptable ceiling
  for now — the failed run's steps are all persisted, so the user can restart — but the contract
  should say so. Revisit only when a real workflow hits it; per-child retry is the likely first
  ask.

---

## 3. UI management of agents

### 3.1 There is no way to stop anything (the missing control)

No cancel-run, no kill-step — from the agents panel or anywhere. A wrong-prompt headless step
runs its full 10 minutes; a mis-planned fan-out runs every child. The pieces already exist: the
process-group kill (`headless.ts:122-130`), the status vocabulary (add `cancelled` or reuse
`failed` with a distinguishing `error`), and the panel's action row. Cancel-run = mark run +
pending steps, kill the in-flight child process(es); kill-step = the same scoped to one step.
This is the highest-priority item in this doc after §2.1.

### 3.2 Running steps are invisible

The activity feed parses `resultJson.events`, which is written **only at step completion**
(`workflowRunner.ts:233-239`) — a live 10-minute agent shows nothing. Phase 3's WS is the natural
transport: design the socket's framing for a second frame type from day one (`term:out` frames
and `workflow:step:event` frames on one connection), and have `runHeadless` emit parsed
stream-json lines as they arrive instead of only buffering. The persistence story doesn't change
(the last-100-events snapshot still lands in `resultJson`); the live tail is a view, not a store.

### 3.3 Poll → push

The runner already has a `notify` path used for gates (`workflowRunner.ts:196`,
`workflowWiring.ts:145`). Emit step status transitions through it and the agents panel's 3 s
`setInterval` (`AgentsPanel.tsx:45`) becomes an `onStatus`-driven refetch — simpler *and*
cheaper. Whatever polling remains rides `ctx.poll` when it lands (state §5.2), and pauses when
hidden per [performance.md](./performance.md) §3.2.

Minor, deferred: the roster is per-task; there is no cross-task "everything running right now"
view. Rail badges partially cover it — defer until it's actually missed.

---

## 4. The data-passing ceiling: templating, not a dataflow engine

If workflows ever need explicit edges — a step consuming a *specific* prior step's structured
output rather than the whole context blob — the answer is one variable namespace in prompts:

```toml
prompt = "Implement the plan below.\n\n${steps.plan.output}"
```

resolved at step start from the persisted `workflow_steps` rows (`structuredJson` ?? `result`),
unknown references failing the run at parse time like unknown step kinds already do. ~30 lines,
TOML stays declarative, and the runner already hand-concatenates prompts in three places
(ci-loop `workflowRunner.ts:373-377`, fan-out seeds `:301`, `requiresRun` `:227`) that this would
regularize. **Do not build it yet** — the handoff note covers today's workflows once §2.1 fixes
it. This section exists so that when the need appears, the shape is already decided and nobody
reaches for a dataflow engine.

---

## 5. Non-goals

- **No inter-agent message bus.** Worktree + notes + memory + DB is the substrate, on purpose:
  everything agents share is inspectable by the user in the same panes.
- **No typed step-output schemas registry, no per-edge wiring.** §4's templating is the ceiling.
- **No new step kinds.** The registry (Phase 8) makes them cheap when a real one appears.
- **No structured (non-PTY) agent transports.** Already deliberately deferred
  (`profiles.ts:14-18`); nothing here changes that.
