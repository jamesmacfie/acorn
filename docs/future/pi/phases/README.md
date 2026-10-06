# Sequential implementation plan

Status: proposed, 2026-10-03; phases 09 and 10 added and acceptance moved to phase 11 on 2026-10-07.
No phase is implemented by this plan. Execute these handoffs in
order, using one phase as the developer's assignment. The numbered files in the parent folder are
topic proposals, not execution phases.

Read the [programme overview](../README.md), [Mods comparison and permission design](../../mods.md),
and [refusals](../refused.md) first. This plan resolves sequencing and delivery details. The topic
proposals explain intent; this folder owns implementation order and acceptance. Shipped reference
documents remain authoritative about implemented behavior.

## The phases

| Phase | Handoff | Result required before the next phase |
| --- | --- | --- |
| 01 | [Contributed omp harness](./01-omp-harness.md) | A tested loaded harness, or a recorded unsupported capability with a bounded driver fix. |
| 02 | [Permission veto and policy plugin](./02-permission-veto.md) | Permission refusals work through a real loaded plugin, with resolved cards on both hosts. |
| 03 | [Attributed session messages](./03-session-messages.md) | Interactive sessions accept bounded, attributed notes; the policy plugin explains its refusals. |
| 04 | [Model grants and interactive advisor](./04-model-grants-and-advisor.md) | A real advisor proves host-held model choices, accounting, and a bounded completed-turn reader. |
| 05 | [Unattended follow-ups](./05-unattended-follow-ups.md) | Workflow and delegation owners account for and cancel plugin follow-ups before unattended delivery is enabled. |
| 06 | [Portable plugin skills](./06-portable-skills.md) | A skills-only plugin delivers a validated, readable index on start and resume. |
| 07 | [Native skill delivery](./07-native-skills.md) | Claude uses native skills; Codex uses a verified native door or the documented portable fallback. |
| 08 | [Resource-read experiment](./08-resource-read-experiment.md) | Paired results justify retaining the experiment, or its implementation is removed. |
| 09 | [Activity feed, session options, and request notes](./09-session-reach.md) | A loaded meter reads activity on every harness and changes options; the policy plugin notes risky requests. |
| 10 | [Harness bridges](./10-harness-bridges.md) | Bridged harnesses run acorn's hooks on every tool call; Codex has a bridge or an evidenced limitation. |
| 11 | [Programme acceptance](./11-programme-acceptance.md) | Combined real-host evidence, published owning contracts, and a recorded disposition for every phase. |

Each phase assumes the previous phase's accepted handoff, even where the underlying feature could
be implemented independently. Phase 01 may finish with an evidenced harness limitation rather than
blocking all harness-neutral work. Phase 08 may finish by deleting the experiment. Neither outcome
licenses silently omitting verification.

## Decisions that reconcile the proposals

- Keep the permission hook veto-only. A timeout passes the request to the person. Explanation is a
  separate messaging grant, delivered in phase 03; it is optional in the policy plugin's settings.
- Add a canonical provider request ID to the hook payload. The consumer needs it to distinguish
  retries from separate permission requests when assigning explanation idempotency keys.
- Explain only committed vetoes, using resolved lifecycle notifications and a bounded blocked
  projection. A handler's late or superseded verdict must not produce a false explanation.
- Ship messaging with the policy consumer. Ship model grants with the advisor. A fake driver is
  useful evidence, but does not replace a loaded consumer crossing the worker boundary.
- Introduce a bounded review reader in phase 04. Findings was deleted, and
  `agents.reviewInput.v1` is absent from the agents lifecycle contract inspected on 2026-10-03.
  Do not restore Findings or assume its reader still ships.
- Restrict automatic messages to interactive sessions through phase 04. Phase 05 owns unattended
  operation lifetime, accounting, and completion. `controller: 'acorn'` alone is insufficient.
- Preserve explicit-backend generation calls. The omitted-backend path uses the host grant and its
  cap. That cap does not bound all calls a plugin with the broad `models` permission can make.
  Explain this distinction in settings and the owning contract.
- Deliver skills as named procedures. Always-on instructions remain context sections. Native
  delivery is per harness, and an unavailable native door uses the portable delivery result.
- Give the permission hook's subject a named public type. Phase 10's `agents:before-tool` reuses it,
  so one policy handler covers asked questions and bridged calls.
- Bridges install through each harness's own hook system and never return allow. They are acorn's
  answer to in-loop extension; acorn still builds no loop of its own.
- Treat resource reads as a measured experiment. Keep writes and search as tools, preserve task
  authorization, and require the original 15% context saving without losing completed tasks.

## Shared architecture and review rules

The Node owns policy decisions, queues, grants, accounting, skill catalogues, and orchestration.
The agents plugin owns session contracts and lifecycle. Core owns model credentials, generic plugin
loading, trust, and MCP transport. Plugins consume these owners through public contracts and declared
contributions; they do not import their implementations or read their databases.

Trace every client change through its Node route, public wire type, broker, selected-Node query
cache, and shared UI consumer. Use additive wire changes and migrations rather than resets. Put
domain logic in feature-owned modules; keep activation entrypoints and runtime coordinators thin.

Use standalone policy, advisor, and skills packages as real consumers. Their source must accompany
the handoff in a durable repository or supplied archive, with an exact revision and install/build
instructions. Do not make the next developer reconstruct them from an absolute local folder. Small
test fixtures can live beside the owning tests; production consumers remain loaded packages.

## Verification for every phase

Run `pnpm lint` and focused tests for the changed owners. Typical commands are:

```sh
pnpm --filter @acorn/plugin-agents test
pnpm --filter @acorn/node-core test
pnpm --filter @acorn/arch-tests test
```

Recheck package scripts before running a command. For the full suite use `pnpm test`, which bounds
process concurrency. Run the architecture and documentation tests when contracts or docs change.
Exercise the Node without a desktop when changing Node ownership or loaded-plugin transport.

For desktop changes, run the real Tauri window with
`pnpm dev:agent -- --session pi-phase-NN`, then the `dev:agent:ui` driver. Take a fresh snapshot after
each transition, inspect screenshots, and stop the driver. For terminal changes, use
`pnpm dev:tui:agent -- --session pi-phase-NN-tui --fixture tui-navigation`, the PTY driver, and both
the default size and `resize 120 40`. Follow [local development](../../../local-development.md)
for complete commands. Do not label graphical acceptance passed without these checks.

Tests must prove behavior at a boundary: permission resolution, persisted state, worker transport,
authorization, concurrent admission, lifecycle, or visible output. Avoid tests that restate a helper.

## The handoff record

At the end of each phase, update its status with an absolute date and record:

- The implementation revision, changed contracts, migrations, and consumer package revisions.
- The commands run and results, plus links to real-host reports and inspected screenshots.
- Provider versions and protocol evidence for any harness-specific claim.
- Any limitation, its effect on subsequent phases, and the accepted fallback.
- The owning docs updated and the exact next phase to begin.

Retained future files describe decisions and evidence. Shipped behavior belongs in the owning
reference docs. Never report a phase complete with an unresolved acceptance gate.

## Verify before building

Re-read [architecture](../../../architecture-overview.md), [conventions](../../../conventions.md),
[plugin map](../../../plugin-map.md), [managed agents](../../../managed-agents.md),
[agent tools](../../../agent-tools.md), and [node extension points](../../../plugins/node-side-extension-points.md).
Inspect the working tree and preserve unrelated work. Paths in each handoff are starting points,
not permission to assume the implementation has remained unchanged.
