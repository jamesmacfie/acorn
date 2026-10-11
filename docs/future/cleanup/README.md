# Cleanup programme

This programme turns a whole-repository maintainability review into 17 proposals. Read this page
before you pick one up. It holds the shared evidence, the order, the compatibility cutoff, and the
rules every proposal follows.

Date: October 11, 2026. Status: proposed, implementation not started. Investigation baseline:
`6f358af2ba66526b4eca8a38dde7ff7b054f5812`. Line numbers drift, so recheck each proposal's evidence
against the target checkout before you change anything.

## What the review found

The large-scale structure holds. `tools/arch/boundaries.test.ts` enforces the package boundaries,
and a scan of client-core, node-core, agents, workflows, the terminal client, and custody found one
runtime import cycle, between two files in client-core. About 285,000 lines of source hold 15
`as any` casts and one `@ts-expect-error`. The largest hand-written file is 1,449 lines.

The problems sit lower down:

- The quality gate is red, and CI hasn't run on the last 276 commits.
- Each runtime has two hand-written boot sequences, and both pairs have drifted apart.
- A few modules are too large to change safely, and 54 files hand-roll the same async guard.
- Legacy and dead code survived the `acorn-1` reset.
- There's no formatter, so modules come in two densities.
- Comments and docs drift faster than the checks catch.

## The compatibility cutoff

The `acorn-1` baseline, commit `b147a5d35` on September 24, 2026, is a hard cutoff:

- `packages/node-core/src/server/storage/migrationHistory.ts` refuses any database whose migration
  history predates it and points the owner at `pnpm db:reset`.
- A client refuses a Node whose probe doesn't report `baseline: "acorn-1"`.
- A plugin manifest must declare `baseline: "acorn-1"`.
- Device files carry the baseline in their names, such as the plugin trust file in
  `packages/custody/src/plugins/pluginTrustStore.ts`.

So code that reads data from before September 24, or talks to a build from before it, can't run.
Proposal 10 deletes that code without a migration. Proposal 09 is separate: the preview tunnel
postdates the cutoff, but nothing has called it since September 28.

Code added after the cutoff to keep earlier `acorn-1` builds working is different. It follows the
"changes are additive within a major" rule in `docs/api-reference/transport.md`. Proposal 11 asks
whether to keep that rule.

To date a compatibility branch, run `git log --reverse -S'<distinctive string>'` and read the first
commit. If it predates September 24, 2026, the branch is dead.

## Order

Each proposal names its own dependencies. Proposal 01 comes first, because every other proposal
needs a green gate to prove it changed nothing.

| Proposal | Deliverable | Depends on |
| --- | --- | --- |
| [01: green the gate](./01-green-the-gate.md) | Type checks, arch tests, and the test suite pass, and CI runs on every push. | None |
| [02: one Node boot](./02-one-node-boot.md) | One shared boot sequence for the supervised and standalone Node. | 01 |
| [03: one client boot](./03-one-client-boot.md) | One shared client start, one navigation command set, and client schedules on both hosts. | 01 |
| [04: core seams at construction](./04-core-seams-at-construction.md) | No core service is assigned after plugins start. | 02 |
| [05: plugin teardown](./05-plugin-teardown.md) | Every registration records its own undo, so teardown can't miss a kind. | 01 |
| [06: agents session core](./06-agents-session-core.md) | One public runtime object and one store, split by job instead of by inheritance. | 01 |
| [07: EditorPane controller](./07-editor-pane-controller.md) | The editor pane split into a controller and a component. | 01 |
| [08: staleness guards](./08-staleness-guards.md) | Shared helpers replace hand-rolled generation counters. | 07 |
| [09: remove the preview tunnel](./09-remove-preview-tunnel.md) | The unreachable tunnel chain and its Node endpoint are gone. | 01 |
| [10: pre-baseline compatibility](./10-pre-baseline-compatibility.md) | Code that only serves data or builds from before September 24 is gone. | 01 |
| [11: mixed-version policy](./11-mixed-version-policy.md) | A decision on mixed-version support, then removal of what it no longer requires. | 01 and a decision |
| [12: dead exports and routes](./12-dead-exports-and-routes.md) | Unused exports, routes, and facade names deleted, plus a check that keeps them out. | 09, 10, 11 |
| [13: formatter](./13-formatter.md) | One formatter, one mechanical commit, and a check in `pnpm lint`. | 01 |
| [14: dense modules](./14-dense-modules.md) | The hardest-to-read modules rewritten for a reader. | 13 |
| [15: comment cleanup](./15-comment-cleanup.md) | Wrong and stale comments fixed or removed, and a rule that stops more arriving. | 13 |
| [16: docs cleanup](./16-docs-cleanup.md) | Shipped plans retired, stale reference text fixed, and unused anchors removed. | 01 |
| [17: housekeeping](./17-housekeeping.md) | Small structural fixes and three open naming decisions. | None |

Proposals 02 to 08 change structure. Do them one at a time, each on its own branch, so a regression
points at one change.

## Rules for every proposal

1. Keep behavior unless the proposal names the change. A cleanup that changes behavior is two
   changes.
2. Keep the gate green. Before handoff, run `pnpm lint`, `pnpm test --filter=<package>` for each
   package you touched and each package that consumes it, and `pnpm --filter @acorn/arch-tests test`.
3. Update the reference doc that owns any changed contract in the same change.
4. When a proposal ships, delete its file and its row in the order table. Git history keeps the
   proposal.
5. Remove obsolete paths a change creates. A refactor that leaves the old path beside its
   replacement doubles the code to read.

## Out of scope

Security fixes belong to the dated reviews in `docs/security/`. Performance work belongs to the
startup and runtime budgets. Neither is part of this programme, though some proposals shrink the
code those budgets measure.
