# Trim: maintainability and dependency work

Date: 2026-10-06. Status: phases 01–08 complete; phase 09 is next.
Planning revision: `2ae55abb5ca25399d9510eb23df14176a1ba1c82`.

This programme turns the maintainability and dependency investigations into sequential assignments.
Give a developer one numbered file at a time. Each file contains the context needed to execute it
without the original conversation. The [evidence record](./evidence.md) retains the investigation's
measurements; phase 01 establishes the reproducible implementation baseline.

## Assessment and intended result

Acorn has sound runtime boundaries, strict TypeScript, feature ownership, and substantial tests.
Most files are small. Maintenance cost concentrates in a few components, composition roots, and the
agent runtime. Splitting these by responsibility should make common changes easier to reason about.

Dependency count alone overstates the problem: the lockfile includes development tools, peers, and
optional platform packages. The actionable opportunities are unused direct declarations, unnecessary
native files in desktop staging, and two dependency branches whose runtime use needs investigation.
Preserve libraries that already solve difficult editing, storage, protocol, and rendering problems.

Success means fewer unnecessary dependency roots and shipped bytes, acyclic internal value imports
in the identified areas, explicit state owners, thin activation code, and preserved product behavior.
There is no arbitrary package-count or file-length target. Read [refused approaches](./refused.md).

## Sequential assignments

Phases 08–15 remain TODO. Start the next phase only after the preceding phase's acceptance and
handoff. This order is an execution order; some assignments have no technical dependency on earlier
changes. Phases 04, 05, and 14 permit a documented retention decision under their acceptance criteria.
That is a completed investigation, never a claim that a reduction or migration shipped.

| Phase | Standalone task | Required handoff |
| --- | --- | --- |
| 01 DONE | [Baseline and ownership inventory](./01-baseline.md) | Node 24.21.0 baseline, repeatable inventory, ownership map, and four passing gates. See [evidence](./evidence.md#phase-01-implementation-baseline-2026-10-05). |
| 02 DONE | [Remove unused direct dependencies](./02-direct-dependencies.md) | Five declarations removed; frozen lockfile, consumer suites, and independent CLI/TUI startup passed. See [evidence](./evidence.md#phase-02-unused-direct-dependencies-2026-10-06). |
| 03 DONE | [Stage native files for the target](./03-native-payload.md) | Five target fixtures and Darwin arm64 PTY smoke passed; staged helper fell by 60,496,168 B. Other target runtime smoke remains a release gate. See [evidence](./evidence.md#phase-03-target-native-files-2026-10-06). |
| 04 DONE (retention) | [Resolve the bundled Claude payload](./04-claude-payload.md) | Binary retained: adapter managed policy can clear Acorn's override and use the SDK fallback; zero realized savings. See [evidence](./evidence.md#phase-04-bundled-claude-payload-2026-10-06). |
| 05 DONE (retention) | [Resolve the keymap dependency branch](./05-keymap.md) | Keymap retained: its supported entries avoid Core at runtime, but the required package dependency remains; zero realized savings. See [evidence](./evidence.md#phase-05-keymap-dependency-branch-2026-10-06). |
| 06 DONE | [Remove internal import cycles](./06-import-cycles.md) | Workflow and agent-selection SCCs removed; exact graph and passing gates in [evidence](./evidence.md#phase-06-internal-import-cycles-2026-10-06). |
| 07 DONE | [Separate rail task editing](./07-tab-rail.md) | Dialog state, Node-scoped reads and writes, and held-request guard moved beside the rail. See [evidence](./evidence.md#phase-07-rail-task-editing-2026-10-06). |
| 08 DONE | [Separate composer operations](./08-agent-composer.md) | Shared draft custody retained; submission, capture, and attachment operations extracted. See [evidence](./evidence.md#phase-08-composer-operations-2026-10-06). |
| 09 | [Thin workflow activation](./09-workflow-activation.md) | Feature-owned services and a readable plugin composition root. |
| 10 | [Separate plugin contribution registration](./10-plugin-host.md) | Named adapters with unchanged lifecycle, rollback, and permission behavior. |
| 11 | [Separate agent admission](./11-agent-admission.md) | A single queue coordinator with explicit policy and await-time guards. |
| 12 | [Separate provider process ownership](./12-agent-processes.md) | One owner for live generations, startup, retirement, and process timers. |
| 13 | [Replace runtime inheritance](./13-agent-composition.md) | Product commands compose an engine through narrow operations. |
| 14 | [Resolve provider coupling debt](./14-provider-boundary.md) | A consumer map and a concrete migration decision; no speculative schema rewrite. |
| 15 | [Combined acceptance](./15-acceptance.md) | Comparable measurements, complete gates, host evidence, and final dispositions. |

## Rules that apply to each handoff

- Inspect the working tree and preserve unrelated work. Do not create a branch unless requested.
- Re-read live code. Earlier phases may have moved paths; use their handoffs to find the new owner.
  Revision drift alone is expected. Stop when the proposed behavior or boundary no longer fits.
- Preserve plugin API major 3, public exports, routes, persisted identifiers, and existing database
  history. These tasks do not authorize breaking contracts or resetting data.
- Put new modules beside their feature. Use typed dependencies and existing stores. Avoid global
  service locators, broad barrels, generic controller frameworks, and duplicate state owners.
- Keep security decisions centralized. Refactoring does not change loaded-plugin permissions,
  provider access, task token scope, broker validation, or frame trust.
- Use focused tests during editing, package and consumer suites before handoff, and the root complete
  gate in phase 15. Add tests for concrete behavior gaps; do not test file size or mirror helpers.
- Record command, revision, runtime, outcome, and limitations in `evidence.md`. Update the task's status
  and this table. A failing required gate is blocked with a reason, not complete.
- Update shipped behavior in its owning reference doc. Keep these files as plans and delivery records.

## Runtime and verification

Work from the repository root with pnpm 11 and a Node version supported by root `package.json`.
The investigation machine's Node 24.11.0 was below the supported Node 24 floor of 24.18.1; its passing
architecture check does not establish a supported-runtime baseline. The bundled pin was 24.21.0.

Use `pnpm test:focus <package> <file> [-t <name>]` while editing. Use `pnpm test`, whose wrapper
bounds concurrency, for the full gate. A package test alone does not prove its source consumers pass.
Every numbered file specifies its relevant commands and any host or packaging evidence.

## Verify before building

Read [architecture](../../architecture-overview.md), [package boundaries](../../architecture/packages.md),
[conventions](../../conventions.md), [testing](../../testing.md), and [local development](../../local-development.md).
Check root scripts, Node support, current task scope, and the preceding accepted handoff before work.
