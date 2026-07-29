# Self-improvement — future position

**Status:** design position; no implementation scheduled · **Reviewed:** 2026-07-29

This note records how acorn's shipped agent and memory architecture relates to automated
self-improvement. It is deliberately not an implementation plan. Current runtime contracts live in
[workflows.md](../workflows.md), [notes-and-memory.md](../notes-and-memory.md),
[mcp.md](../mcp.md), and [plugins.md](../plugins.md).

## Position

acorn supports a human-gated form of context improvement today:

1. Agent sessions and task changes can produce memory candidates.
2. Candidates are structurally reviewed and written to the local proposal store.
3. A human edits, accepts, or rejects each proposal in the Context pane.
4. Accepting writes Markdown under repo or operator memory; SQLite is only the derived search index.
5. Later agents receive the accepted memory through launch context and MCP reads.

This is the useful first rung of the broader self-improvement ladder: the working context can improve
over time, but the evaluator and write authority remain outside the agent loop.

acorn does **not** currently search workflow graphs, mutate its harness, evolve populations of agents,
train models, or maintain an automated quality/fitness score. Those are standing non-goals until a
concrete product need and a trustworthy evaluator exist.

## Shipped seams that keep the option open

| Existing contract | Future seam | Constraint to preserve |
| --- | --- | --- |
| File-truth memory plus `MemoryProposalStore` | A future curator can propose consolidations through the same queue | Agents never write accepted memory directly |
| Durable `workflow_runs` / `workflow_steps` | Completed trajectories can be inspected or replayed by a future evaluation harness | Run records remain auditable and task-scoped |
| Workflow step, profile, policy, tool, pane, source, and route registries | A future harness can enumerate capabilities without hard-coding every plugin | Provider-specific/runtime details stay behind contributions |
| Runtime-derived gates and tool ceilings | Evaluation and autonomy can be constrained independently of agent claims | Gate verdicts must not trust self-reported success |
| Worktree-per-task execution | Candidate changes remain isolated and reviewable | Promotion into the main checkout stays an explicit human/tool action |

These seams make future work additive; they are not a reason to build it early.

## What would have to exist first

Any move beyond human-gated context improvement needs all of the following:

- a representative, versioned task/evaluation corpus;
- an outcome measure that cannot be gamed by merely changing agent output;
- cost, time, tool, and concurrency budgets enforced by the runtime;
- replayable inputs with privacy-safe observability;
- rollback and comparison of candidate harness/config changes;
- an approval boundary outside the process being optimized.

Without those pieces, “self-improvement” is an uncontrolled mutation loop rather than a product
capability.

## Standing decisions

- Do not add workflow-graph search, self-modifying harness code, evolutionary populations, or
  model-training machinery speculatively.
- Do not weaken the proposal gate to make automation easier.
- Do not treat tests alone as an outcome-quality score; they are necessary correctness gates, not a
  complete evaluator.
- Periodic memory consolidation may be added later, but it must emit ordinary proposals and use the
  same human accept/reject path.
- Revisit this position only with a concrete workload whose repeated outcomes can be measured.
