# Self-improvement — the axis we're not building yet (and why the shapes already fit)

**Status:** study + positioning (no build) · **Date:** 2026-07-08 · **Companions:**
[agent-runtime.md](./agent-runtime.md) §5–6 (the runtime non-goals/near-term this extends),
[contribution-points.md](./contribution-points.md) §4.8/§4.10/§4.11 (the registries that double as
the harness surface), [memory.md](./memory.md) §3/§6 (the propose→accept loop),
[extensibility.md](./extensibility.md) tenet 2 / §9.1 ("don't foreclose, don't build")

This doc records a design study — Lilian Weng, *"Harness Engineering for Self-Improvement"*
(lilianweng.github.io, 2026-07-04) — read against acorn's agent runtime, and states acorn's
position on the axis the post opens.

The verdict up front: **acorn is already well-positioned for this axis, mostly by accident, and
we are deliberately not building it.** The designed types and contracts are already extensible in
the directions self-improvement would need, so this doc adds *annotations*, not machinery. It
exists so the axis isn't re-litigated and so a future implementer knows which seams were kept open
on purpose.

---

## 1. Two orthogonal axes

`agent-runtime.md` / `agent-runtime-influences.md` already pressure-tested the runtime along one
axis. This post is about a different one. Don't conflate them.

- **Scale / orchestration axis** (agentfield): control planes, message buses, daemons,
  distributed fleets, cost budgeting. acorn *rejected* most of it (single process, no bus, no
  daemon — influences §2c). Correct for a single-user local app.
- **Self-improvement axis** (this doc): does the harness get *better at its job over time*, and
  who does the improving? This is orthogonal to scale — you can self-improve in one process on one
  machine, and it needs almost none of the scale machinery acorn rejected.

acorn has thought hard about the first axis and, until now, not at all about the second.

## 2. The post's ladder, and where acorn sits

The post arranges self-improvement by *what gets optimized* and *who optimizes it*:

```
Context engineering  (ACE / MCE — the "evolving playbook")
  → Workflow design   (ADAS / AFlow — search the workflow graph)
  → Harness code      (Meta-Harness — the harness is an editable artifact)
  → Self-modifying    (STOP — improve the improver)
  → Evolutionary      (AlphaEvolve / DGM — population + fitness search)
  → Joint model+harness (SIA)
```

Unified by one loop — **propose → evaluate → accept** — over **durable file-system state**, gated
by a **verifier** and **human oversight** that sits *outside* the loop being optimized.

**acorn sits at Level 1 (Context engineering), human-gated** — and further along than expected.
Everything above is absent, mostly on purpose (§5).

## 3. What acorn already gets right

Each maps to a principle the post spends its "design maxims" on:

- **File-truth memory + propose→evaluate→accept.** `.acorn/memory/*.md` is truth, SQLite is a
  derived index; session-end distill → structural verify → human-gated proposal → committed →
  injected into the next session ([memory.md](./memory.md) §6). That *is* the post's "evolving
  playbook" (ACE) and its propose-evaluate-accept loop. ~80% built already.
- **Runtime-re-derived gates defeat reward-hacking.** `gate-policy` re-derives verdicts in the
  runtime (`checks-green` polls the checks mirror), never trusting agent output
  ([agent-runtime.md](./agent-runtime.md) §1). Reward-hacking is the post's hardest named
  bottleneck; "agents can't lie past a gate" is a structural defense most harnesses lack.
- **The evaluator sits outside the evolving loop.** The write-path invariant — no
  `ctx.memory.writeAccepted(...)`; only a human UI action writes accepted memory
  ([memory.md](./memory.md) §1#2/§4/§9) — is exactly the post's oversight boundary.
- **Durable, replayable trajectories.** `workflow_runs`/`workflow_steps` persist
  inputs/results/structured/sessionId; worktree-per-task makes each run self-contained. That's the
  inspectable execution history the higher levels reason over.

## 4. The two ceilings (both already accounted for)

1. **The harness is hardcoded, not a registry.** Levels 3–5 need the harness to be a
   first-class, enumerable, editable artifact ("code is the universal search space"). acorn's
   Phase 4 (agent tools) and Phase 8 (step kinds / profiles) registries are the precondition —
   **already sequenced for extensibility reasons.** The registry doubles as the harness search
   space; we get the seam for free.
2. **No automated evaluator / fitness signal.** acorn's verifier is *structural* (dangling refs,
   dup-hash, contradiction) plus CI pass/fail. There is no held-out task corpus and no
   outcome-quality score. Every level above 1 needs a scalar fitness. This is genuinely absent and
   **correctly YAGNI** — the post itself calls weak evaluators the universal hard part.

## 5. Futureproofing verdict per designed type

The crux, and the reason this is annotation-only. For each already-designed contract: the seam it
provides, and whether building self-improvement would *reshape* it (it wouldn't — all additive).

| Designed type / contract | Where | Self-improvement seam | Change if we build it? |
| --- | --- | --- | --- |
| `AgentToolContribution` | points §4.8 | `name`/`description`/`input`/`risk` make the registry **self-describing** — a harness search space | **Additive.** A read-only "describe the harness" introspection projection is a 4th projection target beside MCP/HTTP/renderer; no field changes. Anchored by ext tenet 2 ("core can index, list, conflict-check"). |
| `StepHandlerOutcome` | points §4.10 / runtime §4.1 | the outcome union is the extension point for fitness / recovery verdicts | **Additive.** Already designed to extend for typed failure-recovery (agent-runtime §6.4); a fitness/quality signal rides the same union. |
| `WorkflowDef` / `ToolCeiling` / `posture` | runtime §4.1 | an evolutionary/search loop is a new step-kind + a fitness policy | **Additive.** Rides `registerStepKind` / `registerPolicy` (points §4.10); `posture: autonomous` + tool ceilings already govern the autonomy a loop would use. |
| `MemoryOrigin` / `MemoryOriginKind` | memory §3 | `'consolidation'` is the reserved ACE-curator kind; `sourceRefs`/`workflowRunId` carry evidence | **None.** The consolidation kind is already reserved; a curator pass emits candidates like any other origin. |
| Write-path invariant | memory §1#2 / §4 / §9 | evaluator-outside-the-loop boundary | **Protect as a hard rule — never relax.** It is what makes higher automation *safe* to add later. |

## 6. Non-goals (don't build yet)

Standing non-goals on this axis, so they aren't re-proposed:

- **No workflow-graph search** (AFlow/ADAS), **no self-modifying harness** (STOP/DGM), **no
  evolutionary population loop** (AlphaEvolve), **no joint model+harness** (SIA).
- **No fitness scorer / outcome-quality metric**, **no eval / regression corpus**, **no
  embeddings** for memory retrieval (memory.md's existing explicit decision).

The door is left open by three things already in the design — the Phase 4/8 **registries** (the
editable harness surface), the memory **`'consolidation'` origin kind** + proposal queue (the ACE
curator seam), and **replayable run records** (what a future eval harness would replay). The one
prerequisite that would actually gate a move past Level 1 — an automated evaluator — is the thing
we deliberately don't build until a real need appears.
