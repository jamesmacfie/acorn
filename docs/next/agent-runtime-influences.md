# Workflow runtime — what we borrowed from agentfield (and what we left)

**Status:** design rationale + adopted decisions · **Date:** 2026-07-08 · **Companions:**
[agent-runtime.md](./agent-runtime.md) (the runtime corrections this doc extends),
[contribution-points.md](./contribution-points.md) §4.8/§4.10/§4.11,
[state-and-policies.md](./state-and-policies.md) §5.2, [implementation.md](./implementation.md)
Phase 8

This doc records a design study: we read **agentfield** (agentfield.ai — an open-source
control plane for complex agent workflows) end to end (docs, examples, integrations, the
whole blog, and the cloned source at `references/agentfield`) and pressure-tested acorn's
workflow/agent runtime against it. It answers three questions the runtime has to get
right — **orchestration, passing state between steps, persisting step history** — and one
the plugin design has to answer — **how all of this stays a set of contributions rather
than a special case in the core.**

The verdict up front: **acorn's runtime design is already right, and the work is
refinement, not rework.** agentfield validated most of acorn's existing choices and
surfaced a handful of concrete, in-scope additions. Everything adopted here lands on an
*existing* contribution point or on core runtime policy — nothing needs a new
architecture.

---

## 1. What agentfield is, and why acorn diverges

agentfield is a **distributed, multi-tenant control plane**: a stateless Go server that
routes execution across an independently-deployed *fleet* of agent nodes (Python/Go/TS
SDKs), backed by a Postgres lease queue, a KV+vector "memory fabric" with reactive
change-events, DID/verifiable-credential governance with cryptographic audit chains, and
first-class webhook/cron trigger sources. Its thesis: "build, deploy, and govern AI
agents like APIs." Workflows are *emergent* — you write plain imperative functions that
`app.call("node.func")` each other, and the control plane reconstructs the DAG after the
fact from parent/child execution links.

acorn is the opposite shape: a **single-user local Electron app**. One process, one
SQLite file, one user who is the trust authority, agents that are CLIs spawned on the
same machine. It does not need — and should actively avoid — a control plane, a fleet, a
distributed queue, cryptographic delegation, or a background daemon. So most of
agentfield's machinery is scale-driven complexity acorn should decline. What's left, once
you strip the distribution and the multi-tenancy, is a set of genuinely good *runtime*
ideas that apply at any scale.

---

## 2. Borrowed vs validated vs rejected

### 2a. Ideas that VALIDATE acorn's existing design (change nothing — cite as pressure-testing)

| agentfield idea | acorn's existing mechanism |
| --- | --- |
| "The DAG is a *record* of the run, not a pre-declaration" (reconstructed from `parent_execution_id`/`root_workflow_id`) | `workflow_steps` rows + `parentStepId` *are* the record — acorn stores it directly instead of reconstructing it |
| Durability = DB rows, not RAM; crash recovery via a periodic stale-reaper | `workflow_runs`/`workflow_steps` are the checkpoint; `reconcile()` resets orphaned `running`→`pending` on boot (agent-runtime §1) |
| Gates enforced *outside* the agent; the verifier is hidden from the writer (Goodhart's law) | `gate-policy` re-derives its verdict in main and ignores whatever the step claimed (workflowRunner `executeStep`) |
| Isolated git worktree per parallel unit → lock-free parallelism | fan-out children each get their own branch/worktree (`workflow_steps.worktreePath`; state §5.2) |
| Schema-validated at the edges, untyped JSON on the wire | per-step `schema` option + captured `structuredJson` ("the edge currency") |
| Human gate = a `waiting` DB status row, resumed by an external signal (crash-safe) | `gate-human` → `waiting-gate`/`gated`, resumed by `resolveGate` |

The lesson from these rows: acorn's substrate is sound. agentfield arrived at the same
answers from a distributed direction, which is the strongest possible confirmation that
they're not accidents of acorn being small.

### 2b. Ideas genuinely worth borrowing (adopted — §3 below)

Concurrency governance, cancel-tree, per-run tool allowlisting, a cheap `decide`/branch
step kind, source-contributed triggers, a decided shape for typed failure-recovery, and
a scope vocabulary for the handoff fix.

### 2c. Rejected — deliberate non-goals (expand agent-runtime §5)

| Rejected agentfield concept | Why acorn declines it |
| --- | --- |
| Control plane / standalone server / agent fleet | single process, in-main runner; no per-step HTTP hop between agents |
| Daemon / background job runner | the runner ticks only while the app is open; triggers ride `ctx.poll` (§3E), recovery rides `reconcile()` |
| Cost budgeting / `max_cost_usd` / per-call spend caps | acorn drives Claude/Codex on **subscriptions** — per-call dollar cost is moot. Runaway *spawns* are bounded as a resource concern (§3A), never a dollar one |
| DID / verifiable credentials / cryptographic audit chains | trusted, single-user, in-tree (ext tenet 5); the persisted `inputsJson`/`resultJson`/`structuredJson` rows are already an inspectable audit trail |
| Memory-fabric message/event bus + reactive `on_change` | worktree + notes + memory + DB stays the only channel (existing agent-runtime §5 non-goal, reconfirmed) |
| Separate event-sourcing table (`(execution, sequence)` append-only log) | the "last 100 events in `resultJson`" snapshot + the planned WS live-tail (agent-runtime §3.2) cover observability at one-user scale |
| Canary / versioning / weighted routing, multi-backend storage abstraction, restart-with-result-reuse ("golden runs") | multi-tenant/fleet features with no single-user payoff; revisit only if a real need appears |

---

## 3. The adopted decisions

Each item names its concrete shape and the contribution point or policy it rides. A
developer implements the runtime from this section.

### A. Concurrency governance  *(resource, not cost — agent-runtime §2.3)*

Runaway *spawns* are a load problem independent of billing, and subscriptions make the
dollar dimension irrelevant. What acorn adopts:

- **`MAX_CONCURRENT_HEADLESS` semaphore** around `runStep`. Today `runFanOut` uses an
  uncapped `Promise.all` (`workflowRunner.ts` `runFanOut`), so a plan emitting 12 tasks
  spawns 12 concurrent headless agents. Fan-out children queue on the semaphore and drain
  as slots free.
- **Per-step turn caps** — bound how long a single headless step may loop. Today the only
  ceiling is the 10-minute timeout in `headless.ts`; a turn cap is the finer, cheaper
  bound (agentfield enforces one per harness call).
- **Fan-out depth cap** — agentfield makes recursion depth caps mandatory. acorn's
  fan-out is one level today, but a `branch`/sub-workflow (D) can nest; the cap makes a
  runaway nesting a `safety-rail` stop, not an unbounded spawn.

Explicitly **not** adopted: `max_cost_usd`, `costUsd` aggregation, per-worker dollar
caps. The `workflow_steps.costUsd` column stays (harmless, already captured) — we just
build no ceilings on it. Record this in §2.3 so it isn't re-proposed.

### B. Cancel-tree  *(sharpen agent-runtime §3.1)*

§3.1 already names "no way to stop anything" as the top priority after the handoff bug.
agentfield's concrete refinement: a single execution-cancel can't reach a fan-out's
children, so it has a dedicated **cancel-tree** that cancels every non-terminal execution
under a run. acorn's cancel-run must do the same:

- Mark the run + all non-terminal steps `cancelled`, and — critically — cascade to
  **fan-out child steps and their child tasks** (`parentStepId` / `tasks.parentId`), not
  just the top-level sequential steps.
- Kill in-flight child process(es) via the existing process-group kill
  (`headless.ts:122-130`).
- Add `cancelling` / `cancelled` statuses as named in agent-runtime §4.1;
  `cancelled` is a clean terminal state, not a failure. Cancel is
  immediate/no-confirm — stopping an agent is recoverable (ux §6).

### C. Per-step / per-run tool allowlist & risk ceiling  *(ties points §4.8 to posture)*

agentfield restricts harness capability *physically* (`tools=["Read","Write","Bash"]`),
not by prompting. acorn has global risk tiers (points §4.8 `read`/`write`/`execute`) and
a permissions page, but nothing scopes tools *per run*. The `autonomous` posture is
exactly where this bites: an autonomous run skips human gates, so it should not also have
unbounded tool reach.

- A run (or an individual step) may declare a **tool allowlist or a risk ceiling** in its
  workflow TOML. The concrete shape is agent-runtime §4.1: step ceilings
  intersect with workflow ceilings, then global user permissions apply last.
- Enforcement reuses the **same `when`/permission filter the agent-tool projection
  already consults** (points §4.8) — no new mechanism; the run's ceiling is one more
  input to the existing filter.
- Rule of thumb: autonomy and capped capability travel together. A workflow that opts
  into `autonomous` and leaves the ceiling wide is a lint-worthy smell.

### D. Decision / branch step kind  *(NEAR-TERM — new points §4.10 step kind)*

agentfield's central cost/quality lever is the two-tier LLM split: cheap single-shot
structured `.ai()` calls make routing/gating decisions; expensive tool-using
`.harness()` calls do the substantive work. acorn today spawns a full headless CLI for
*every* agent step and has **no conditional branching** — workflows are linear plus
fan-out/join. That's the biggest capability gap the study surfaced, and it fits acorn's
model cleanly:

- A new **`decide` step kind** (registered via `ctx.workflows.registerStepKind`, points
  §4.10) whose work is a **single structured model call** — one-shot, no tools — not a
  headless agent. Cheap judgment where today you'd either spawn a whole CLI or hand-code
  a policy.
- It selects the next step from its `structuredJson`. Extend `WorkflowStepDef` with:

  ```ts
  branches?: Record<string, string>   // verdict value → target step `name`
  ```

  resolved against the run's step list at parse time; an unknown target fails the load
  the same way an unknown step `kind` already does (the TOML loader does this well).
- Mechanism: `AgentProfileContribution` (points §4.11) grows an optional **one-shot
  structured mode** — an `aiArgv?`/single-turn variant beside `headlessArgv`/`resumeArgv`
  — so the cheap tier reuses the profile registry rather than introducing a new transport.
  Deterministic decisions still belong in `gate-policy` (cheaper still, re-derived in
  main); `decide` is for judgment-needing, **tool-free** routing.
- This is the natural home for the **`${steps.<name>.output}` templating ceiling**
  (agent-runtime §4). A branch's decision usually needs a *specific* prior step's output,
  not the whole context blob — exactly the case templating was reserved for. So templating
  moves from "shape decided, unbuilt" to **built alongside `decide`**: resolve
  `${steps.<name>.output}` at step start from the persisted `structuredJson ?? result`,
  unknown references failing at parse time.

### E. Triggers / scheduling  *(NEAR-TERM — source-contributed, app-open, NO daemon)*

agentfield has first-class webhook/cron/event triggers via a source-plugin registry.
acorn's standing non-goal is "no daemon, read-driven, no background jobs" — but the
`workflow_runs.trigger` column already exists (default `'manual'`), and the plugin model
already has a coalesced, visibility-paused poll scheduler. The reconciliation that
respects the non-goal:

- Triggers are **contributions** on the source / integration-provider model (points §4.2
  / §4.14), not a daemon. A trigger declares a predicate over data acorn *already
  observes* (a poll tick sees a PR opened, checks turn red) or a while-app-open schedule.
- They ride the existing **`ctx.poll` scheduler** (state §5.2): coalesced,
  visibility-paused, rate-limit-aware — so "runs only while the app is open" holds *by
  construction*, not as a bolted-on guard. No cron daemon, no inbound webhook listener.
- `trigger` widens from `'manual'` to the contributing trigger's id; the run records what
  fired it (the audit trail already wanted this).
- This is the shippable, in-scope slice of the designed-but-unshipped **"Pulse"**
  background-triage idea (architecture-overview.md). Name that lineage explicitly so the
  two don't drift into separate designs.

### F. Typed failure-recovery actions  *(shape decided, build when needed)*

agentfield's nested control loops use typed recovery verdicts
(`RETRY_MODIFIED` / `SPLIT` / `ACCEPT_WITH_DEBT` / `ESCALATE`). acorn's join is
all-or-nothing today (agent-runtime §2.4 already names per-child retry as the likely first
ask). Record the typed-action shape as the **decided direction** for when join/step error
handling gets richer — as a future `StepHandler` outcome type on the points §4.10
contract — and **don't build it yet.** This mirrors acorn's existing discipline of
deciding the shape so nobody later reaches for a general workflow-recovery engine.

### G. Memory-scope framing for the handoff fix  *(reinforces agent-runtime §2.1)*

agentfield's memory fabric has four scopes: **global / session / actor / run**. That
vocabulary maps almost exactly onto acorn's handoff substrate, which already spans global
(memory files), workspace/repo (notes), and task — and is *missing* the run scope, which
is precisely the §2.1 handoff-bleed bug. Reframe the §2.1 fix
(`workflow-handoffs-<runId>` slug + stamped `originTaskId` + flip to `included:false` on
completion) as **adding the run scope** the substrate lacked — a validated scoping model,
not an ad-hoc patch.

---

## 4. Plugin-architecture fit

The reassuring result: every adopted idea lands on an existing seam. No orchestration
concept becomes a core special case.

| Adopted idea | Where it plugs in |
| --- | --- |
| `decide` / branch step kind (D) | points §4.10 `ctx.workflows.registerStepKind` |
| One-shot structured (cheap-tier) mode (D) | points §4.11 `AgentProfileContribution` (new `aiArgv`/single-turn field) |
| Triggers / scheduling (E) | points §4.2 sources / §4.14 integration providers, evaluated by `ctx.poll` (state §5.2) |
| Per-run tool allowlist / risk ceiling (C) | points §4.8 agent-tool risk tiers + the permission filter the projection already consults |
| Concurrency governance (A) | core runtime policy (state §5.2 → agent-runtime §2.3) |
| Cancel-tree (B), live-tail (agent-runtime §3.2) | core runtime + the reserved `workflow:step:event` WS frame (implementation Phase 3) |
| Typed failure-recovery actions (F) | future points §4.10 `StepHandler` outcome contract |

**Litmus test, unchanged:** adding a new step kind, a new agent profile, or a
source-contributed trigger touches **zero** core files.

---

## 5. Where this lands in the build

Per [implementation.md](./implementation.md): the near-term items thread into **Phase 8**
(workflow & profile registries) / the ongoing tracks — the `decide`/branch step kind +
templating (D), the per-run tool allowlist/risk ceiling (C), cancel-tree (B), and
triggers via `ctx.poll` (E). Concurrency governance (A) stays a design-docs refinement in
agent-runtime §2.3 / the existing ongoing track. The handoff-scope fix (G) is the
existing "§2.1 first" ongoing track. Typed failure-recovery (F) is deferred until a real
workflow needs it.
