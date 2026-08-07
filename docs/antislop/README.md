# Antislop program — operating manual

This folder is the execution layer for a maintainability pass over the whole repo. Each `WP-*.md`
file is a self-contained work package an agent can pick up cold and execute. This README carries the
rules that apply to every package; `BASELINE.md` carries the frozen metrics that prove progress.

The repo is already in good structural shape — strict TypeScript with four `any` in total, an
enforced architecture-boundary suite, roughly 30% test LOC. This program is not a rescue. It drains
the *remaining, known* pressure: the open findings in `docs/analysis.md`, the shrinking baselines in
`tools/arch/boundaries.test.ts`, a handful of oversized files, thin test spots, and stale docs.

## Relationship to docs/analysis.md

`docs/analysis.md` is the canonical **finding registry**. Its finding numbers (F1–F12) are
load-bearing: `tools/arch/boundaries.test.ts` cites them in comments (lines 285 and 434 reference
finding 10). Never renumber or supersede that document. These work packages cite finding IDs and
execute them; WP-01 adds a status ledger to `analysis.md` so the registry itself stays honest.

Verified status at the time of writing (commit `279fa860`): findings 2, 3, 4, 5, 7, 11, 12 have
**landed**. Findings 6, 8, 9, 10 are **open** (8 and 10 partially drained). The work packages below
cover the open remainder plus mechanical hygiene the analysis does not track.

## Work package index

| Doc | Goal | Finding | Effort | Depends on |
|---|---|---|---|---|
| [WP-01](WP-01-doc-truth.md) | Fix 10 stale/contradictory doc items; add status ledger to analysis.md | — | S | none — do first |
| [WP-02](WP-02-characterization-tests.md) | Characterization tests for thin packages and test-free directories | — | M | none — do early |
| [WP-03](WP-03-shell-source-registry.md) | Shell stops naming `'github'`; source registry supplies defaults/fallbacks | F10a | M–L | none |
| [WP-04](WP-04-shell-github-reads.md) | Convert `githubShellReads.ts` reads to plugin contributions, delete the file | F10b | M | WP-03 |
| [WP-05](WP-05-shell-routes.md) | Provider-shaped routes (`/:owner/:repo/:number`) become plugin-contributed | F10c | M | WP-03 |
| [WP-06](WP-06-shell-css-migration.md) | Move github-named CSS out of client-core into plugins/github | F10d | S–M | none (parallel-safe) |
| [WP-07](WP-07-core-plugin-data.md) | Core stops owning plugin-shaped data (cascade, issues, sections, notes namespace) | F8 | M | not concurrent with WP-08 |
| [WP-08](WP-08-late-binding-unification.md) | One late-binding mechanism; drain BROADCAST + APP_DEEP_IMPORT baselines | F6 | L | none |
| [WP-09](WP-09-composition-root-parity.md) | Deduplicate the two composition roots; structural parity test | F9 | M | WP-08 |
| [WP-10](WP-10-big-files.md) | Decompose files over ~500 lines; regroup `node-core/src/main/core/` | — | M | per slice group |
| [WP-11](WP-11-mutation-validation.md) | Schemas for external/persisted `JSON.parse` sites (triaged, scoped) | — | S–M | none |

## Pick-up protocol

1. Read this README, then `BASELINE.md`, then your work package doc. Nothing else is required.
2. Run the **Pre-flight** command block in your WP doc. This repo actively drains its own findings —
   three items drifted between the audit that produced these docs and the docs being written. If
   pre-flight shows the world has moved, **amend the WP doc first** (commit that separately), then
   execute against reality.
3. Execute the slices in order. One slice = one commit, made only at green.
4. When done, tick the Progress checklist in your WP doc and update the Status column in the index
   above, in the final commit of the package.

One agent owns one work package at a time. Progress lives inside each WP doc — there is no shared
status file, so parallel agents never contend on writes.

## Operating rules

- **Behavior-preserving.** This program changes structure, not product behavior. If a slice cannot
  be done without a behavior change, stop and surface it — do not smuggle it in.
- **One slice = one commit at green.** Never batch slices into one commit. A slice that cannot go
  green reverts cleanly precisely because it is small.
- **Gates.** Before every commit: `pnpm lint` (oxlint + `tsc --noEmit` in every package) and the
  vitest suite of each touched package (`pnpm --filter <pkg> test`). Before finishing a package that
  touched imports or package structure: `pnpm --filter @acorn/arch-tests test`. Desktop e2e
  (`pnpm --filter @acorn/desktop test:e2e` — rebuilds the bundled Node artifact first) only when a
  package's Gates section says so.
- **Known-red test.** `agentSend.test.ts` can fail with a live-PTY `posix_spawnp` error. It is
  environmental and pre-existing. Confirm it is red on a clean tree before blaming your diff; do not
  chase it.
- **No live-app verification from a worktree.** Worktrees have no `.env`, and port 4317 is the
  user's live instance. UI-affecting packages end with a written **user QA note** (what to click,
  what to expect) instead of a screenshot.
- **Docs move with contracts.** When a slice changes a contract, update the owning topic doc under
  `docs/` in the same commit (CLAUDE.md rule).
- **Baselines shrink in the same commit.** When a slice removes the reason for an entry in
  `BROADCAST_BASELINE`, `APP_DEEP_IMPORT_BASELINE`, or `PLUGIN_NAMED_BASELINE`
  (`tools/arch/boundaries.test.ts:352/381/424`), delete the entry in that commit. The shrunk array
  is the proof the slice worked.
- **`docs/legacy/**` is a completed historical record. No touch.**

## Parallelization map

Safe concurrent sets (disjoint file territories):

```
{WP-01} ∥ {WP-02} ∥ {WP-03 → WP-04, WP-05; WP-06 anytime} ∥ {WP-08 → WP-09} ∥ {WP-11}

WP-07 and WP-08 both live in packages/node-core — run them sequentially (either order).
WP-10 slice groups wait on their listed predecessors (see WP-10).
```

Single-agent order: 01, 02, 03, 04, 05, 06, 08, 09, 07, 10, 11.

## Out of scope

- HTTP outbound allowlist / central egress guard (`docs/http-client.md` names it; it is a security
  program, not this one), observability/logging programs, compliance, SLOs.
- Read-path response validation — the stated contract (`docs/architecture-overview.md` § Wire
  validation) is Zod at **mutation** boundaries; reads are deliberately unvalidated.
- The 16 lateral plugin→plugin imports through `contract/` — legal by design, not debt.
- The four remaining `any` and two suppressions — below the noise floor; fix only if a slice passes
  through them anyway.
- Widening the oxlint rule set — its narrowness is a recorded product decision (CLAUDE.md).
- Rewriting or renumbering `docs/analysis.md`.

## Closing act (optional)

After the last package lands, refresh the migration-audit artifact at
`test-results/migration-audit/` with before/after numbers from `BASELINE.md`. Nice to have, not a
gate.
