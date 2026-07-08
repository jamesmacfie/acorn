# docs/next — the next version

Design and execution docs for acorn's next major iteration: opening every
extension seam, collapsing the transport, and making the app a plugin platform
— while staying shippable at every step. The goals, in order: **maintainable,
performant, extendable, understandable.**

## Start here

**[implementation.md](./implementation.md)** — the build order summary and
cross-phase gates. The comprehensive build guides live in
[`implementation/`](./implementation/), with one markdown file per phase: what
to do, why, what "done" means, how to verify, and the risks for that phase.
Everything else in this folder augments those guides.

## Reading order

| Doc | What it is |
| --- | --- |
| [implementation.md](./implementation.md) + [`implementation/`](./implementation/) | **The hub and phase guides.** Sequencing summary plus one comprehensive build guide per phase |
| [review.md](./review.md) | The architecture review that motivates the work — findings with file:line evidence, prioritized recommendations, technology choices |
| [extensibility.md](./extensibility.md) | The target: acorn as a plugin platform. Tenets, the core, the extension model, parity map, hard parts, sequencing |
| [contribution-points.md](./contribution-points.md) | §4 of the extensibility design: the full contribution-point catalog (panes, sources, commands, agent tools, …) |
| [state-and-policies.md](./state-and-policies.md) | §5 of the extensibility design: `ctx` services, the state tier/scope model, concurrency/budget/retention policies |
| [integrations.md](./integrations.md) | The integration-provider contract: descriptor, connections/auth, capabilities, link identity, promotion, context formatting, mutations, error taxonomy, lifecycle, conformance — normative for Linear/Rollbar and every future provider (Sentry, Better Stack, Notion, …) |
| [memory.md](./memory.md) | The next-era memory contract: files remain truth, plugins/integrations/workflows feed human-gated proposals, provenance/scope/retrieval/retention rules |
| [inventories.md](./inventories.md) | Ground truth: the exact IPC channels, pref keys, error sites, TTLs, listeners the phases work through. Checklists, not estimates |
| [feature-parity.md](./feature-parity.md) | The proof obligation: one checkbox per shipped behaviour, grouped into per-domain contracts with owners and verification methods. Parity means behaviours, not feature names |
| [agent-runtime.md](./agent-runtime.md) | Workflow/agent runtime corrections and adopted additions: the handoff-note bug, session resume, concurrency ceilings, cancel-tree, the `decide`/branch step kind, per-run tool ceilings, triggers |
| [agent-runtime-influences.md](./agent-runtime-influences.md) | The agentfield design study: what acorn borrowed, what it validated, what it rejected — the rationale behind agent-runtime.md's additions, with the plugin-fit mapping |
| [self-improvement.md](./self-improvement.md) | The self-improvement axis (Lilian Weng study): where acorn sits, and which already-designed types keep the door open without a reshape. Annotation-only — nothing to build yet |
| [performance.md](./performance.md) | Perf baseline, budgets, and the five fixes folded into phases — plus the diff-pipeline constraint |
| [ui-state.md](./ui-state.md) | How UI state changes propagate and fail: the three reaction rules (failure surfaces, latest-wins, derive-don't-effect) |
| [security.md](./security.md) | The loopback threat model, the invariants every phase must preserve, the new rules Phase 3 must add |
| [testing.md](./testing.md) | The smoke suite that gates Phases 3/5/6, route-test priorities, the plugin conformance suite |
| [ux.md](./ux.md) | The new user-facing surfaces specified once (will-phase dialog, trust dialog, permissions page, pane management, …) and the invariants not to regress |
| [docs-overhaul.md](./docs-overhaul.md) | Which existing docs each phase invalidates, and the post-implementation README/docs rewrite plan |

Citation conventions used across the set: *(review #N)* = review.md's
recommendation table; *(ext §N)* = extensibility.md; *(points §4.N)* =
contribution-points.md; *(state §5.N)* = state-and-policies.md;
*(integrations §N)* = integrations.md; *(memory §N)* = memory.md;
*(inv §N)* = inventories.md;
*(parity §N)* = feature-parity.md;
*(perf/ui-state/agent-runtime §N)* = the matching doc; *(influences §N)* =
agent-runtime-influences.md; *(self-improve §N)* = self-improvement.md.
