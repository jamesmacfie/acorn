# Phase 8 — Workflow and profile registries

**Status:** planned · **Depends on:** Phase 5; Phase 4 for tool ceilings ·
**Primary docs:** [agent-runtime](../agent-runtime.md),
[contribution-points](../contribution-points.md) §4.10 and §4.11.

## Goal

Make workflow step kinds, policy evaluators, agent profiles, tool ceilings,
cancellation controls, and triggers declarative. Preserve the existing durable
workflow engine skeleton: rows, re-entrant `tick()`, and dependency injection are
good and should not be rewritten.

## Architectural Context

Current workflow extension points are hardcoded ladders:

- step kind execution;
- policy evaluation;
- positional join binding;
- profile spawning/resume behavior.

The target is a registry-backed runtime where new step kinds and profiles are
small modules, parser errors are named and early, and cancellation is owned by
the engine.

## Implementation Plan

1. 8A: Registry extraction, no behavior change.

   Replace `executeStep`'s kind ladder with `Map<kind, StepHandler>` using the
   contract in [agent-runtime](../agent-runtime.md) §4.1. Replace policy switch
   with a policy registry. Register existing behavior unchanged.

2. 8B: Parser/runtime control-flow contract.

   Replace nearest-preceding-fan-out join lookup with explicit `joins:`.
   Add `${steps.<name>.output}` templating and `decide` branch steps. Unknown
   kinds, dangling joins, invalid/backward branch targets, and invalid template
   references fail at parse/start with named errors. Non-selected branch targets
   become `skipped`; unmatched verdicts fail unless `default` exists.

3. 8C: Agent-profile registry.

   Replace builtin profile lists and per-agent branches with profile
   contributions declaring command, backend preference, MCP registration,
   headless argv, resume argv, stream JSON behavior, and one-shot structured
   `aiArgv?` mode for `decide`.

4. 8D: Tool ceilings.

   Workflows and steps may declare tool allowlists or risk ceilings. Step
   ceilings can only narrow workflow ceilings. Global user permissions apply
   last through the Phase-4 permission filter.

5. 8E: Cancellation controls.

   Add cancel-run and kill-step through an engine-owned active-handler registry.
   Cancellation cascades to fan-out child steps and child tasks, kills in-flight
   processes, and persists `cancelling` / `cancelled` statuses.

6. 8F: Triggers after `ctx.poll`.

   Source/integration contributions register trigger predicates. App-open is
   sufficient; do not build a daemon. Widen `workflow_runs.trigger` beyond
   `manual` and record contributing trigger id.

7. Runtime corrections that do not wait.

   Handoff-note scoping, ci-loop resume session id, concurrency caps, cancel UI,
   memory-review on terminal workflow states, and poll-to-push panel updates are
   phase-independent but must follow [agent-runtime](../agent-runtime.md).

## Slice Order

1. Step and policy registries, behavior-preserving.
2. Explicit joins and parser errors.
3. `decide` and output templating.
4. Profile registry and one-shot structured mode.
5. Tool ceilings.
6. Cancellation.
7. Triggers.

## Acceptance Criteria

- New step kind is one registration.
- New agent profile is one small module.
- Existing workflow behavior is unchanged after 8A.
- Invalid workflow TOML fails early with named errors for unknown kind,
  dangling join, invalid branch target, and invalid template reference.
- A workflow using `decide` runs end-to-end.
- Tool ceilings narrow correctly and cannot bypass user permissions.
- Cancel-run stops fan-out children and child tasks with no orphaned process.
- Trigger-started runs record the trigger id.

## Verification

- `pnpm lint`
- `pnpm test`
- Existing workflow runner tests remain green.
- End-to-end TOML workflow using every step kind, including `decide`.
- Fan-out cancellation test proves child steps and child tasks become
  `cancelled`.
- Live check per agent profile for spawn, resume, MCP registration, and stream
  handling.

## References

- [review.md](../review.md) §1e and recommendation #10.
- [agent-runtime.md](../agent-runtime.md) §2, §3, §4, §6.
- [agent-runtime-influences.md](../agent-runtime-influences.md).
- [contribution-points.md](../contribution-points.md) §4.10 and §4.11.
- [ux.md](../ux.md) §6.
- [memory.md](../memory.md) §6 and §9.
