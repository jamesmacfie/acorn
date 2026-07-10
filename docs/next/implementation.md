# Implementation guide — summary

**Status:** active execution plan · **Audience:** developers and agents implementing `docs/next`.
Phase 10 is paused at its acceptance gate; the filesystem move has landed, but the boundary,
parity, and documentation completion criteria remain open.

This is the hub for the next-version implementation. It is deliberately short:
the comprehensive instructions now live in one phase file per phase under
[`implementation/`](./implementation/). Agents and developers should start here
to understand sequence, dependencies, gates, and completion rules, then use the
phase file as the authoritative guide for the actual change.

The source docs this plan executes are:

- [review.md](./review.md) — architecture findings and prioritized
  recommendations.
- [extensibility.md](./extensibility.md),
  [contribution-points.md](./contribution-points.md), and
  [state-and-policies.md](./state-and-policies.md) — the plugin-platform target.
- [integrations.md](./integrations.md) — the provider contract.
- [memory.md](./memory.md) — the memory contract.
- [inventories.md](./inventories.md) — the exact channel, route, pref, listener,
  and error-site checklists.
- [feature-parity.md](./feature-parity.md) — the behaviour-level proof
  obligation.
- [performance.md](./performance.md), [ui-state.md](./ui-state.md),
  [agent-runtime.md](./agent-runtime.md), [security.md](./security.md),
  [testing.md](./testing.md), [ux.md](./ux.md), and
  [docs-overhaul.md](./docs-overhaul.md) — cross-cutting gates and constraints.

When this guide and a design doc disagree on implementation detail, this guide
and its phase files win. Update the design doc in the same PR.

## Phase Index

| Phase | File | Purpose | Unlocks | Completed |
| --- | --- | --- | --- | --- |
| 0 | [Contract hygiene](./implementation/phase-00-contract-hygiene.md) | Make the server/client contract mandatory: response typing, one error envelope, shared auth guard. | Safer route growth in Phase 3 and projected tool routes in Phase 4. | ✅ |
| 1 | [Composition root + lifecycle](./implementation/phase-01-composition-root-lifecycle.md) | Move boot wiring out of terminal code and add ordered startup/reconcile/shutdown. | Any later registry or projection has one place to register and dispose. | ✅ |
| 2 | [Sync engine](./implementation/phase-02-sync-engine.md) | Extract serve-then-revalidate and cache policy from copied route logic. | Provider/source descriptors in Phase 7 and future mirrored resources. | ✅ |
| 3 | [Transport collapse](./implementation/phase-03-transport-collapse.md) | Move request/response IPC to loopback HTTP and streams to one authenticated WS. | Agent-tool projection, browser-mode capability clarity, route-owned plugins. | ✅ |
| 4 | [Agent-tool projection](./implementation/phase-04-agent-tool-projection.md) | Declare tools and context sections once, then project to MCP, harness HTTP, and renderer clients. | Tool permissions, provider context formatting, workflow tool ceilings. | ✅ |
| 5 | [Client registries](./implementation/phase-05-client-registries.md) | Open client extension seams: panes, commands, keybindings, settings, events, UI slots, notices. | Startup restore descriptors, provider UI contributions, workflow/profile UI. | ✅ |
| 6 | [Startup restore pipeline](./implementation/phase-06-startup-restore-pipeline.md) | Replace effect-order startup state with ordered persisted-state descriptors. | Stable plugin-owned persisted state and scoped eviction. | ✅ |
| 7 | [Integration providers and source contributions](./implementation/phase-07-integration-providers.md) | Express Linear/Rollbar through the provider contract before a third provider exists. | Zero-core-file provider additions and provider-owned source/context/link surfaces. | ✅ |
| 8 | [Workflow and profile registries](./implementation/phase-08-workflow-profile-registries.md) | Make step kinds, policies, profiles, tool ceilings, cancellation, and triggers declarative. | Workflow extensibility and runtime control surfaces. | ✅ |
| 9 | [Platform migrations](./implementation/phase-09-platform-migrations.md) | Opportunistic platform shifts: WebContentsView, node:sqlite spike, safeStorage path. | Cleaner platform layer before final foldering. | ◐ A impl (live verify pending) · B parked · C ✅ |
| 10 | [Foldering](./implementation/phase-10-foldering.md) | Move into `core/` + `plugins/` only after the seams exist. | Completion of the plugin-platform architecture. | ⏸ paused — filesystem/composition move landed; 82 boundary edges, 106 unchecked parity rows, and docs graduation remain |

## Completion Definition

The phases are designed so the app remains buildable and shippable after each
phase. By the end of Phase 10, all goals of `docs/next` must be complete:

- The extension seams named in `extensibility.md` and
  `contribution-points.md` exist and are exercised by current in-tree features.
- Every behaviour in [feature-parity.md](./feature-parity.md) has an owner and
  is verified or explicitly documented as a non-goal.
- The request/response surface is loopback HTTP, streams are WebSocket, and the
  Electron preload residue is limited to true Electron capabilities.
- Agent tools, context sections, panes, sources, settings pages, commands,
  workflows, profiles, and provider surfaces are declared through registries or
  descriptors rather than hand-synced ladders.
- Runtime state has explicit ownership, restore order, failure surfaces,
  lifecycle disposal, and scoped eviction.
- Security invariants in [security.md](./security.md) hold after every phase.
- Performance baselines in [performance.md](./performance.md) are captured
  before the phases that need them and compared after each relevant change.
- Existing docs in `docs/` are updated as architecture facts change, following
  [docs-overhaul.md](./docs-overhaul.md).
- Phase 10's folder move is mostly mechanical. If a `git mv` forces new API
  design, an earlier seam was missed and the move waits.

## Work Rules

1. Each phase is independently shippable. Ship a short stack of reviewable PRs,
   not one mega-branch.
2. Before claiming a phase done, run `pnpm lint`, `pnpm test`, that phase's
   verification list, and any applicable smoke/performance/parity checks.
3. Work from [inventories.md](./inventories.md), not memory. Tick consumed
   channels, pref keys, listeners, route gaps, stale docs, and parity rows in
   the same PR that changes them.
4. A phase PR names the architectural boundary it changes and lists upstream
   callers plus downstream consumers touched.
5. New concepts go to the first homes named in the relevant phase file unless
   local code makes another home clearly simpler; record that reason in the PR.
6. Compatibility stays until the last commit of a slice. Add the new path, prove
   it, then delete the old path in the same domain slice.
7. Derived lists stay derived from registries or descriptors. New hand-synced
   lists are regressions.
8. New mutations, pollers, background refreshes, agent operations, and write
   paths must name their failure surface before they ship.

## Cross-Phase Gates

- **Smoke suite:** lands before Phase 3 and gates Phases 3, 5, and 6. The five
  required tests are boot, restore, open-task, terminal-echo, and quit-clean
  ([testing.md](./testing.md) §1).
- **Performance baseline:** capture marks before Phases 1, 3, and 6 touch boot,
  transport, or restore paths ([performance.md](./performance.md) §3.1).
- **Feature parity:** any phase that moves a domain re-verifies that domain's
  section in [feature-parity.md](./feature-parity.md).
- **Security:** the invariants in [security.md](./security.md) §2 are
  non-negotiable. A phase that violates one has failed even if tests pass.
- **Documentation:** any PR changing an architecture fact updates the doc that
  states that fact ([docs-overhaul.md](./docs-overhaul.md) §1).

## Sequencing

Phases 0, 1, and 2 are foundational and can begin immediately; they have little
design risk and reduce later blast radius. Phase 3 depends on the smoke suite
and the transport/perf baseline. Phase 4 depends on Phases 1 and 3. Phase 5
depends on the smoke suite and creates the client extension substrate. Phase 6
depends on Phase 5's event bus. Phase 7 depends on Phase 2 and benefits from
Phase 4's context/tool seams. Phase 8 depends on Phase 5 and Phase 4 for tool
ceilings. Phase 9 is parallel and opportunistic. Phase 10 is last.

```text
Phase 0 (contracts) ──┐
Phase 1 (composition) ├─→ Phase 3 (transport) ─→ Phase 4 (tools/context)
Phase 2 (sync)       ─┘         │                         │
                                │                         └─→ Phase 7 (providers)
Phase 5 (client registries) ─→ Phase 6 (restore)
        │
        └─→ Phase 8 (workflow/profile registries)

Phase 9 (platform migrations) — parallel, opportunistic
Phase 10 (foldering) — last
```

## Ongoing Tracks

Some work has no phase gate because it is small, high-value, or naturally rides
the next touched file:

- Smoke/route/conformance tests from [testing.md](./testing.md).
- Immediate performance items from [performance.md](./performance.md): pause
  visible-only polling and add the obvious secondary indexes.
- UI reaction hygiene from [ui-state.md](./ui-state.md): latest-only guards,
  visible failure surfaces, and no silent preference/draft failures.
- Agent runtime corrections from [agent-runtime.md](./agent-runtime.md), with
  run-scoped handoff notes first.
- Data-model hygiene from `review.md` and `extensibility.md` §8.5: lineage,
  prune/index derivation, `workspace_config`, and provider model migrations.
- Deduplication, observability, component decomposition, autosave clobber guard,
  repo-config trust gate, poll scheduler, retention sweep, and plugin
  conformance tests.
- Self-improvement futureproofing from [self-improvement.md](./self-improvement.md):
  **annotation-only, nothing to build.** The axis rides the registries already
  sequenced in Phase 4 (agent tools) and Phase 8 (step kinds/profiles) plus the
  memory `'consolidation'` seam — no phase gate, no new work, just seams kept open.

These tracks do not replace the phase files. If an ongoing-track change touches
a phase-owned boundary, follow that phase's rules.
