# Slice 19: Complete migration and remove superseded paths

Date: 2026-09-20. Status: complete.

The workflow-specific transition command and its tests were removed by the later
[architecture reset programme](../legacy/09-database-baselines.md). The evidence below records the
earlier slice; the current recoverable reset is documented in [local development](../../local-development.md).

Read [context and decisions](./context.md) first, then the owning
[data](./data-contract.md), [workflow](./workflow-contract.md), and [verification](./verification.md)
references.
The [programme index](./README.md) links every related contract and implementation slice.
Prerequisites: 03–18. Do not start dependent work until those slices' acceptance checks pass.

## Outcome

Every dashboard/data consumer uses the shared source contract, and legacy batch execution is gone.

## Work

1. Inventory all compiled/loaded collections, toolkit declarations, client synthesis, caches, core tasks, agent sessions, panel regions, and measure sampling.
2. Move remaining sources to Node-owned declarations and migrate pure projection/sampling consumers. Preserve unknown optional status honestly.
3. Remove legacy collection schemas/parameters, client-only option/fetch authority, old cold-schema behavior, direct fan-out/join, and temporary adapters.
4. Implement the exact targeted development-state reset with a recoverable export and quiescent-writer preflight. Do not run it against unrelated user state.
5. Update owned workflow fixtures/files and actionable old-format diagnostics. Update owning documentation and SDK examples, then remove transition gates.

## Boundaries

Implement this slice within its owning runtime and public contribution/capability seams. Keep pure
rules separate from I/O and UI state. Preserve unrelated behavior and worktree edits. Do not widen
scope to exclusions in [refused alternatives](./refused.md). Update the owning reference docs when
this slice exposes shipped behavior, and keep the programme status accurate during gated rollout.

## Verification

Run reference/import scans, full lint, relevant suites, database checks, and architecture tests. Test the reset on a copied fixture root containing unrelated tasks, credentials, notes, sessions, and files and verify those survive.

Run `pnpm lint` and the relevant owning-package tests before handoff. Include architecture tests
when public exports, plugin contracts, or runtime boundaries change. Follow the real-window checks
for UI changes. Record actual evidence rather than copying expected results into a completion claim.

## Evidence

### Inventory and transition boundary

- Removed the flat collection protocol, manifest contribution, public toolkit/context member, Node
  registry, client registry/cache, provider adapters, core-task and agent-session adapters, dashboard
  composition adapter, direct child-agent fan-out, dedicated join, and their rollout gates. The one
  authority is now the Node data-source registry used by query authoring, published queries,
  dashboard panels and regions, unattended measure sampling, workflow data steps, and bindings.
- Registered sources are core tasks (`core/tasks`), agent sessions, GitHub pull requests, Linear
  issues, Rollbar error groups, and the installed nested-data fixture. Core task
  `worktreeChanged` remains `null` when the Node has not inspected the worktree.
- The versioned `workflow-v2-development-state-v1` transition exports and resets only
  `dashboard_measure_samples`, `dashboard_revisions`, `dashboard_drafts`, `query_consumers`,
  `query_publication_holds`, `query_revisions`, `query_drafts`, the workflow plugin's definition,
  revision, publication, file-draft, dependency, run, step, dispatch, admission, selection,
  processing, record-attempt/state, schedule, and occurrence tables, the `dashboards` preference,
  and core workflow schedules with their scheduler state/runs.
- Renderer activation removes only the retired `workflow-recovery:v1:`, `query-recovery:v1:`,
  `acorn:dashboard-recovery:`, and `acorn:ai-authoring:v1:` device namespaces. The copied-fixture
  test proves tasks, links and lineage, worktrees, notes, agent sessions, credentials/connections,
  devices and pairings, other schedules/preferences, and arbitrary repository/user files survive.
  No transition or reset command was run against the user's data.
- Updated the shipped extensibility, plugin descriptor, Node authoring, and task protocol references
  to describe typed `ctx.dataSources` contributions and nested workflow parentage. The runtime
  workflow-dispatch rollout switch was removed; validated, frozen graph admission is the permanent
  boundary rather than a second execution path.

### Automated checks

- `node --test scripts/workflow-v2-transition.test.mjs`: 2 tests passed, including a recoverable
  SHA-256 manifest with private permissions, exact survival checks, rerun refusal, and refusal of a
  running workflow, reserved dispatch, or claimed occurrence before any export or write.
- `pnpm --filter @acorn/plugin-workflows test -- --run --reporter=dot`: 59 files and 477 tests passed,
  including v2-only runtime validation and actionable old-format file/definition refusal.
- `pnpm --filter @acorn/node exec vitest run test/integration/plugins/workflowRunner.test.ts
  test/integration/plugins/workflowTasks.test.ts --reporter=dot`: 2 files and 25 tests passed after
  the remaining integration definitions and hand-authored TOML fixture moved to format v2, stable
  step IDs, typed input schemas, and typed bindings.
- Dashboard and source suites passed: dashboards-core 206 tests; client dashboard and retired-device
  storage 66 tests; Node dashboard/source 16 tests; GitHub 16, Linear 6, Rollbar 6, and agent session
  1 source-handler tests.
- Public contract checks passed: plugin API surface/entrypoint/data contracts 12 tests; published
  types and generated manifest schema 4 tests; manifest/loader/plugin routes 240 tests; workflow file
  integration 5 tests.
- `pnpm db:check`: all 11 migration chains applied cleanly to fresh databases.
- `pnpm --filter @acorn/arch-tests test -- --run --reporter=dot`: 63 tests passed. The focused
  `docPaths.test.ts` and `boundaries.test.ts` rerun passed 55 tests after the shipped-doc cleanup.
- `pnpm lint`: oxlint completed and TypeScript passed in all 33 packages. The repository's existing
  warning baseline remains non-failing.
- Legacy reference/import scans found no runtime collection or workflow fan-out/join compatibility
  path. `contributions.collections` remains only in the manifest rejection message so an old package
  gets an actionable typed-source migration diagnostic. The only old workflow-kind references are
  the `kind = "fan-out"` input and matching unknown-kind assertion in `workflowFiles.test.ts`, plus
  the `generateWorkflow.test.ts` assertion that the authoring prompt does not advertise `fan-out`.
  Unrelated event and fleet code still uses “fan out” in its ordinary networking sense.
  `DashboardPanelQuery` is the current typed saved-query reference, not the removed flat collection
  contract. `git diff --check` passed.

### Real-window check

`pnpm dev:agent -- --session workflow-v2-phase19-window` opened an isolated desktop session. Home
rendered, **Add panel** opened the shared dashboard editor with source/saved-query selection and no
legacy wizard, and the session stopped cleanly. Screenshot:
`.acorn/agent-dev/workflow-v2-phase19-window/screenshots/phase19-dashboard-editor.png`. The log repeated
the already-recorded loaded Linear/Database `node:module` isolation warning from slices 13 and 15;
live-provider verification remains the slice-20 acceptance item.

## Verify before building

Inventory exact persisted keys/tables before reset. Preserve source files and unrelated worktree changes. Check the separate dashboard backlog notices and remove obsolete implementation guidance when superseded behavior ships.
