# WP-04 — Delete the githubShellReads ledger (F10b)

**Effort:** M · **Depends on:** WP-03 (the shell must already resolve sources via the registry, so
these reads have a contribution seam to move into).

## Context — finding 10, docs/analysis.md

`packages/client-core/src/githubShellReads.ts` (62 lines) is a deliberate ledger: every GitHub
route, query key, and response shape the shell still reads directly, collected in one file. Its own
header is the spec — the paths/shapes are owned by `plugins/github/src/contract/api.ts` and are
*duplicated* here because client-core, a shared library, may not import a plugin. The header states
the end state: when finding 10 lands, this file "should be DELETED, not moved."

At pin time it carries `reposRoute = '/v2/p/github/repos'`, a `pullRoute(owner, repo, number)`
builder, and the query definitions the shell uses (repo list, pins, pull-checks style reads).
`packages/client-core/src/queries.ts` is already drained to 71 lines; this ledger is the residual.

Related ratchet: `tools/arch/boundaries.test.ts:285` — the `CORE_IMPORT_ROOTS` comment says the
set "shrinks with finding 10" as github/linear/rollbar reads leave core. `CORE_IMPORT_ROOTS` is an
exact-set assertion (`toEqual`), so removing the last consumer of a root **requires** removing the
root from the array in the same commit.

## Pre-flight

```sh
cat packages/client-core/src/githubShellReads.ts
grep -rn 'githubShellReads' packages apps plugins --include='*.ts*' | grep -v '\.test\.'
sed -n '269,325p' tools/arch/boundaries.test.ts
```

Enumerate every consumer of every export. The consumer list defines the slices.

## End state

- `githubShellReads.ts` deleted.
- Each read the shell needs is supplied by a plugins/github client contribution through an
  existing registry seam (sources/panes/attention/etc. — pick the seam each consumer already sits
  behind; do not invent a new generic "data contribution" mechanism unless at least two consumers
  need the identical shape).
- Query keys preserved or deliberately migrated: repo memory records that the IndexedDB-persisted
  query cache has **no buster** — if a persisted response type changes shape, bump the query key in
  the same commit.

## Non-goals

- Route ownership in the router (WP-05) and CSS (WP-06).
- Generalizing to linear/rollbar reads — verify first whether any still live in core
  (`grep -rn "'/v2/p/linear\|/v2/p/rollbar" packages/client-core/src`); if yes, add a slice per
  find, if no, record that they are already clean.

## Slices (one commit each)

1. **Map consumers.** For each export, note the consuming shell file and which registry seam that
   consumer already uses. Commit the map as an amendment to this doc (table under Progress).
2..N. **One export (or one coherent group) per slice:** add the contribution on the plugins/github
   side, switch the shell consumer to the contribution, delete the export. Query keys unchanged
   unless shapes change (then bump — see above).
Final. **Delete the file.** Remove any now-unused root from `CORE_IMPORT_ROOTS`
   (`tools/arch/boundaries.test.ts:269`) in the same commit; the shrunk set is the proof.

## Gates

Per slice: `pnpm --filter @acorn/client-core test`, `pnpm --filter @acorn/plugin-github test`,
`pnpm lint`. Final slice: `pnpm --filter @acorn/arch-tests test` + desktop e2e (the repo list and
pull views are core UX).

## Risks & rollback

- **Persisted query cache:** stale cached shapes against new readers — the no-buster gotcha above
  is the sharpest edge in this package.
- **Load order:** contributions register at client plugin activation; any shell read that fires
  before activation must handle "no contribution yet" the same way it handles "no data yet".
- Slices are per-export and revert independently; the file deletion is last so the tree is never
  in a half-ledger state.

## Doc updates

`docs/frontend.md` § Node data access (shell no longer reads provider routes directly) — final
slice. User QA note: repo list renders, pins work, PR checks visible on a task.

## Done criteria

- [x] `githubShellReads.ts` gone; grep for it returns nothing.
- [x] `CORE_IMPORT_ROOTS` was remeasured; no root lost its last legitimate consumer.
- [x] No `/v2/p/github` literal remains in `packages/client-core/src`.
- [ ] Desktop e2e is blocked by sandbox `listen EPERM`; user QA handoff is recorded in the final migration audit.

## Progress

- [x] Slice 1 — consumer map (append table here)
- [x] Slices 2..N — per-export moves
- [x] Final — file deleted, roots shrunk

Completed 2026-08-08. The ledger's consumers now use the following ownership seams:

| Former ledger item | Shell consumer | New owner/seam |
| --- | --- | --- |
| repos/pins query keys and options | `App.tsx`, `WorkspaceRepoAssignments.tsx`, HTTP settings/browse | `SourceContribution.repository` → core generic query wrappers |
| repo refresh | `RepoPicker.tsx` | `SourceRepository.refreshRepos()` |
| pin mutation | `workspaces/mutations.ts` and `RepoPicker.tsx` | `SourceRepository.setPin()` |
| pull-check query | `TabRail.tsx` | `SourceRepository.pullChecks()` → core generic query wrapper |
| repo shape | startup restore and `RepoPicker.tsx` | `SourceRepo` structural contract in the source registry |
| GitHub device flow | `IntegrationsSettings.tsx` | `integrationFlowRegistry`, registered by plugins/github |

The GitHub plugin owns all provider routes and wire reads in `repositoryContribution.ts` and
`integrationFlow.ts`; `githubShellReads.ts` is deleted. `CORE_IMPORT_ROOTS` remains unchanged:
`@acorn/client-core/queries.ts` and `@acorn/client-core/registries` still have legitimate imports,
so no exact-set root disappeared. Linear/Rollbar provider routes were already absent from core.

Validation: `pnpm --filter @acorn/client-core test`, `pnpm --filter @acorn/plugin-github test`,
`pnpm --filter @acorn/arch-tests test`, and `pnpm lint` pass. The desktop persisted-state
conformance test passes (24 tests). The full desktop package test remains blocked by sandbox
`listen EPERM` failures in pre-existing broker/tunnel tests; no renderer test failed. Manual QA is
recorded in the final migration audit.
