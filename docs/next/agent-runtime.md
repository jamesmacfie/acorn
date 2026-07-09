# Agent runtime — corrections and ceilings

**Status:** findings + design corrections · **Date:** 2026-07-07 (rev. 2026-07-08) ·
**Companions:** [review.md](./review.md) §1e,
[contribution-points.md](./contribution-points.md) §4.8/§4.10/§4.11,
[implementation.md](./implementation.md) Phase 8 + ongoing tracks, [ux.md](./ux.md) §6 (cancel +
live-tail UX), [agent-runtime-influences.md](./agent-runtime-influences.md) (the agentfield study
these corrections were pressure-tested against)

> **Pressure-tested against agentfield.** These decisions were checked against
> [agentfield](https://agentfield.ai) — a distributed control plane for agent workflows —
> in [agent-runtime-influences.md](./agent-runtime-influences.md). It confirmed the substrate
> (§1) and sharpened four items below: concurrency governance (§2.3, cost-free on
> subscriptions), cancel-*tree* (§3.1), a cheap `decide`/branch step kind and the templating
> ceiling (§4, §6), per-run tool ceilings (§6), and the run-scope framing of the handoff fix
> (§2.1). The rejected control-plane machinery is listed as non-goals (§5).

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

Memory is part of that substrate only at task/run boundaries. It is not the
workflow data bus: handoff notes carry run-scoped step output, while the memory
review pass distills durable lessons into human-gated proposals after an
interactive session or workflow run reaches a boundary
([memory.md](./memory.md) §6).

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
   (`notes.ts:172`). *Today* notes are only workspace(repo)-scoped (`taskWorktree.ts:167-184`),
   and the context filter shares any note *without* an `originTaskId` across tasks
   (`knowledgeIpc.ts:74-76`). So two tasks on the same repo read each other's workflow handoffs.
   The future-state fix is structural: **task** is a first-class note scope with its own storage
   home (`notes/task/<taskId>/`, [feature-parity.md](./feature-parity.md) §10 `NoteLocation`), so
   agent/handoff writes default there and can't reach a sibling task regardless of `originTaskId`.
3. **Silent truncation kills the mechanism:** the assembler slices each note body to 2,000 chars
   and takes only the first 10 notes (`knowledgeIpc.ts:78-80`). Once the shared note outgrows
   that, **newer handoffs stop reaching the next step entirely** — the pipeline keeps "working"
   while passing stale data.

**Fix:** the handoff note is written in **task** scope (the run's task, `notes/task/<taskId>/`)
under a per-run slug (`workflow-handoffs-<runId>`); `append()` grows an `originTaskId` option
(stamped from the run's task) for provenance, and the run's completion
(`done`/`failed`/`safety-rail`) flips the note to `included: false` — it stays as an audit trail
but leaves the context. Small, and it makes the handoff mechanism actually mean "output of the
previous step in *this* run".

This is best understood as **realising the scopes the substrate was missing**, not a one-off patch.
agentfield's memory fabric distinguishes global / session / actor / **run** scopes; the future-state
acorn substrate spans global (memory files), workspace/repo (notes), and **task** (notes' own
`notes/task/<taskId>/` home) — and the per-run slug is the *run* refinement *inside* task scope, not
a fourth peer ([feature-parity.md](./feature-parity.md) §10 `NoteLocation`;
[agent-runtime-influences.md](./agent-runtime-influences.md) §3G).

### 2.2 Session resume is plumbed and never used

`resumeSessionId` exists in the headless layer (`headless.ts:25,35`) and no caller passes it —
`runStep` opts are always `{prompt, model, schema}` (`workflowRunner.ts:232,262,302,373`). The
cost is concrete in **ci-loop**: every iteration spawns a fresh session that re-reads the entire
context and has no memory of what it tried last iteration. Passing the previous iteration's
captured `sessionId` as `resumeSessionId` is a one-field change that makes ci-loop meaningfully
smarter and cheaper. (Sequential top-level steps should **stay** fresh sessions — different step,
different job; the handoff note is the intended carrier there. Resume is for iteration *within*
a step.)

### 2.3 Nothing bounds concurrent spawns

- Fan-out runs all children via `Promise.all` with no concurrency cap
  (`workflowRunner.ts:298-314`) — a plan step that emits 12 tasks spawns 12 concurrent headless
  agents.
- The only limit anywhere is the 10-minute per-step timeout — no per-step turn bound, no depth
  bound once steps can nest.

state §5.2's budget posture covers pollers and badges but not agents. **Fix** — three
resource ceilings, all data-driven policy in the points §4.8 sense (the point is that a runaway
fan-out *has* a ceiling, not that the ceiling is clever):

- one `MAX_CONCURRENT_HEADLESS` constant (a semaphore around `runStep`; fan-out children queue
  and drain as slots free);
- a per-step **turn cap** (a finer bound than the 10-minute wall-clock timeout — agentfield
  enforces one per harness call);
- a **fan-out depth cap** so a nested `branch`/sub-workflow (§6, `decide`) can't recurse without
  bound — hitting it is a `safety-rail` stop (the state already exists for exactly this shape,
  `workflowRunner.ts:380-386`).

**Cost is deliberately *not* a dimension here.** acorn drives Claude/Codex on subscriptions, so
per-call dollar cost is moot: no `max_cost_usd`, no `costUsd` aggregation, no per-worker spend
cap. The `workflow_steps.costUsd` column stays (it's captured for free) but nothing is ceilinged
on it. This decision is recorded so it isn't re-proposed
([agent-runtime-influences.md](./agent-runtime-influences.md) §3A, §2c).

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
process-group kill (`headless.ts:122-130`), the `cancelled` terminal status named in §4.1,
and the panel's action row. Cancel-run = mark run + pending steps, kill the in-flight child
process(es); kill-step = the same scoped to one step.
This is the highest-priority item in this doc after §2.1.

**Cancel must be a *tree*, not a single row.** agentfield learned this the hard way and has a
dedicated cancel-tree: a cancel scoped to one execution can't reach a fan-out's children. In
acorn a fan-out's children are separate step rows (`parentStepId`) running in their own child
tasks (`tasks.parentId`), so cancel-run must **cascade to child steps and their tasks**, marking
every non-terminal descendant `cancelled` and killing each in-flight child process — not just the
top-level sequential steps. Cancel is immediate and needs no confirmation: stopping an agent is
recoverable ([ux.md](./ux.md) §6).

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
regularize. This remains "templating, not a dataflow engine" — when the need appears, the shape
is already decided and nobody reaches for a dataflow engine.

**The need has appeared: the `decide`/branch step kind (§6) is exactly this case.** A branch's
decision usually consumes a *specific* prior step's output, not the whole context blob — so
`${steps.<name>.output}` moves from "shape decided, unbuilt" to **built alongside `decide`**. The
handoff note still covers linear workflows once §2.1 fixes it; templating is for the steps that
need a named edge.

### 4.1 Workflow runtime contract — the implementation shape

Phase 8 must not leave runtime semantics to the first implementation PR. The
registry opens the extension seam, but the workflow engine remains the owner of
durability, ordering, cancellation, and status transitions. Step handlers do
work; the engine persists the run.

Target definition shape:

```ts
type WorkflowPosture = 'gated' | 'autonomous'
type ToolRisk = 'read' | 'write' | 'execute'

interface WorkflowDef {
  name: string
  posture?: WorkflowPosture
  trigger?: string              // persisted on workflow_runs; absent/manual means user-started
  tools?: ToolCeiling           // inherited by steps unless narrowed
  steps: WorkflowStepDef[]
}

interface ToolCeiling {
  allow?: string[]              // explicit tool ids; empty means no tools
  maxRisk?: ToolRisk            // highest risk tier visible to the run/step
}

interface WorkflowStepDef {
  name: string
  kind?: string                 // resolved through the step-kind registry; default 'agent'
  profileId?: string
  model?: string
  prompt?: string
  schema?: object
  policy?: string
  maxIterations?: number
  requiresRun?: string
  childStep?: ChildStepDef
  joins?: string                // fan-out step name to aggregate; replaces nearest-fan-out scan
  branches?: Record<string, string> // decide verdict -> target step name
  tools?: ToolCeiling           // may only narrow the workflow-level ceiling
}

interface ChildStepDef {
  name?: string
  profileId?: string
  model?: string
  prompt?: string
  schema?: object
  tools?: ToolCeiling
}
```

TOML follows those names directly (`max_iterations`, `requires_run`,
`child_step`, `joins`, `[steps.branches]`, `[tools]`, `[steps.tools]`). Run-level
and step-level tool ceilings intersect: a step cannot widen what the workflow
allows, and global user permissions still apply last. `autonomous` with neither
`allow` nor `maxRisk` is a parse warning at first, then a parse error once the
projection is in place; autonomous mode means fewer human gates, not unbounded
tool reach.

Status vocabulary is part of the contract:

| Row | Non-terminal | Terminal |
| --- | --- | --- |
| `workflow_runs.status` | `running`, `gated`, `cancelling` | `done`, `failed`, `safety-rail`, `cancelled` |
| `workflow_steps.status` | `pending`, `running`, `waiting-gate` | `done`, `failed`, `skipped`, `safety-rail`, `cancelled` |

Compatibility is read-time first. Existing rows with old `defJson` are parsed
with missing fields defaulted (`kind: 'agent'`, no `joins`, no `branches`, no
tool ceiling). No data migration is required merely to add these fields because
`defJson` is a frozen run record. Schema/comment migrations still update the
documented status vocabulary and add indexes where performance.md requires
them.

The `StepHandler` contract is deliberately narrow:

```ts
interface StepHandlerContext {
  run: RunRow
  step: StepRow
  def: WorkflowStepDef
  renderedPrompt: string
  tools: EffectiveToolSet
  signal: AbortSignal
  emit(event: WorkflowStepEvent): void
}

type StepHandlerOutcome =
  | { status: 'done'; result?: unknown; structured?: unknown; sessionId?: string | null }
  | { status: 'failed'; error: string }
  | { status: 'safety-rail'; error: string }
  | { status: 'waiting-gate' }
```

Handlers do not update `workflow_runs` / `workflow_steps` directly. They return
an outcome; the engine writes `inputsJson`, `resultJson`, `structuredJson`,
`sessionId`, `costUsd` when present, status, and timestamps. That keeps plugin
step kinds from learning table details and keeps cancellation/reconcile
centralized. The future typed failure-recovery actions (§6.4) extend this
outcome union, not the table-writing rules.

Branching is explicit:

- `decide` must produce a scalar verdict in `structuredJson.verdict` unless its
  handler declares another field. The selected value is looked up in
  `branches`.
- Unmatched verdicts fail the decide step and run with a named error unless a
  `default` branch is present.
- Non-selected branch target steps are marked `skipped` when the run passes
  them. `skipped` is terminal and never considered a join failure.
- Branch targets must point forward in the current expanded step list. Backward
  jumps are loops; use `ci-loop` or a future recovery action instead.
- `${steps.<name>.output}` resolves from the named step's
  `structuredJson ?? resultJson.result`. References to unknown steps, future
  steps, skipped steps, or failed steps fail parse/start with a named error.

Join semantics stay intentionally simple. `joins` names the fan-out step to
aggregate; no nearest-preceding scan remains. A join ignores branch-skipped
steps outside the named fan-out, but every child row of the named fan-out must
be terminal `done` or the join fails all-or-nothing (§2.4).

Cancellation is engine-owned. The engine keeps an in-memory registry of
`runId -> stepId -> AbortController/process-kill hook` while handlers run.
Cancel-run transitions the run to `cancelling`, aborts every registered
handler, marks every non-terminal descendant step `cancelled`, cascades to
fan-out child tasks (`tasks.parentId`), and finally marks the run `cancelled`.
If a step completes concurrently with cancellation, `cancelled` wins unless the
run had already reached a terminal state. On boot, `reconcile()` requeues only
`running` rows belonging to non-cancelled runs; `cancelling` rows become
`cancelled` because their child processes died with the app.

---

## 5. Non-goals

Standing non-goals, reconfirmed against the agentfield study
([agent-runtime-influences.md](./agent-runtime-influences.md) §2c):

- **No inter-agent message bus, no reactive `on_change` fabric.** Worktree + notes + memory + DB
  is the substrate, on purpose: everything agents share is inspectable by the user in the same
  panes. agentfield's memory-fabric event bus is exactly what this rejects.
- **No typed step-output schemas registry, no per-edge wiring.** §4's `${steps.<name>.output}`
  templating is the ceiling; the `decide` step (§6) consumes it, it does not replace it with a
  dataflow engine.
- **No interactive structured (non-PTY) agent *transports*.** Interactive/headless sessions stay
  CLI/PTY (`profiles.ts:14-18`). The `decide` tier (§6) is a *stateless one-shot* structured
  model call — not a persistent structured session — so it doesn't reopen this.

Rejected agentfield machinery (scale-driven complexity with no single-user payoff):

- **No control plane / standalone server / agent fleet.** Single process, in-main runner; no
  per-step HTTP hop between agents.
- **No daemon / background job runner.** The runner ticks only while the app is open; triggers
  ride `ctx.poll` (§6), recovery rides `reconcile()` on boot.
- **No cost budgeting / `max_cost_usd`.** Subscriptions make per-call dollar cost moot; spawns
  are bounded as a concurrency/turn/depth concern (§2.3), never a dollar one.
- **No DID / verifiable-credential / cryptographic-audit governance.** Trusted, single-user,
  in-tree (ext tenet 5); the persisted step rows are already an inspectable audit trail.
- **No separate event-sourcing table.** The last-100-events snapshot in `resultJson` plus the WS
  live-tail (§3.2) cover observability at one-user scale.
- **No canary/versioning/weighted routing, multi-backend storage abstraction, or
  restart-with-result-reuse ("golden runs").** Revisit only if a real need appears.

Separate axis, also a non-goal for now: **self-improvement** — a harness that gets better at
its job over time (context/workflow/harness-code optimization, evolutionary search). It is
orthogonal to the scale concerns above and needs almost none of the rejected machinery. acorn
sits at a human-gated Level 1 (memory review = a primitive "evolving playbook"). The designed
contracts here (`StepHandlerOutcome`, `WorkflowDef`/`ToolCeiling`, the registries) are already
extensible in the directions it would need — additive, no reshape. Shape decided, deliberately
unbuilt, in the spirit of §6.4: [self-improvement.md](./self-improvement.md).

## 6. Adopted from the agentfield study (near-term)

Four capabilities the study surfaced as in-scope. Each rides an existing contribution point —
none is a core special case ([agent-runtime-influences.md](./agent-runtime-influences.md) §4 has
the full plugin-fit mapping). Sequenced in [implementation.md](./implementation.md) Phase 8 /
ongoing tracks.

### 6.1 The `decide`/branch step kind — conditional routing on a cheap tier

acorn spawns a full headless CLI for *every* agent step and has no conditional branching
(workflows are linear + fan-out/join). agentfield's central lever is the two-tier split: cheap
one-shot structured calls make routing decisions, expensive tool-using calls do the work.

- A new **`decide` step kind** (`ctx.workflows.registerStepKind`, points §4.10): a single
  structured model call, one-shot, **no tools** — cheap judgment, not a headless agent.
- It routes on its `structuredJson`. `WorkflowStepDef` grows
  `branches?: Record<string, string>` (verdict value → target step `name`), resolved against the
  run's steps at parse time; unknown targets fail the load like unknown `kind`s already do.
- Mechanism: `AgentProfileContribution` (points §4.11) grows an optional one-shot structured mode
  (`aiArgv?`/single-turn) beside `headlessArgv`/`resumeArgv`, so the cheap tier reuses the profile
  registry rather than a new transport. Deterministic decisions still belong in `gate-policy`;
  `decide` is for judgment-needing, tool-free routing.
- `${steps.<name>.output}` templating (§4) is built with this — a branch typically consumes a
  specific prior step's output.

### 6.2 Per-run tool allowlist & risk ceiling — autonomy travels with a cap

agentfield restricts harness capability physically (`tools=[…]`), not by prompt. The
`autonomous` posture — which skips human gates — is where acorn most needs this.

- A run (or step) may declare a **tool allowlist or risk ceiling** in its workflow TOML.
- The concrete TOML shape and merge rule are in §4.1: workflow and step
  ceilings intersect, and user permissions apply last.
- Enforcement reuses the **same `when`/permission filter the agent-tool projection already
  consults** (points §4.8) — the run's ceiling is one more input, no new mechanism.
- Rule: an `autonomous` run with an unbounded ceiling is a smell.

### 6.3 Triggers / scheduling — source-contributed, app-open, no daemon

agentfield has webhook/cron/event triggers via a source registry. acorn keeps "no daemon,
read-driven" by binding triggers to what it already observes:

- Triggers are **contributions** on the source / integration-provider model (points §4.2 /
  §4.14), evaluated by the existing **`ctx.poll` scheduler** (state §5.2) — coalesced,
  visibility-paused — so "runs only while the app is open" holds by construction.
- A trigger's predicate reads data acorn already polls (a PR opened, checks turned red) or a
  while-app-open schedule; `workflow_runs.trigger` widens from `'manual'` to the trigger's id.
- This is the shippable slice of the designed-but-unshipped **"Pulse"** idea — same lineage, not
  a second design.

### 6.4 Typed failure-recovery actions — shape decided, build when needed

agentfield's nested loops use typed recovery verdicts
(`RETRY_MODIFIED`/`SPLIT`/`ACCEPT_WITH_DEBT`/`ESCALATE`). acorn's join is all-or-nothing today
(§2.4). Record the typed-action shape as the decided direction for when join/step recovery gets
richer — a future `StepHandler` outcome type on the points §4.10 contract — and **don't build it
yet.**
