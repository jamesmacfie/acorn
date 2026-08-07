# WP-01 — Documentation truth pass

**Effort:** S · **Depends on:** nothing · **Do this first** — every later package's agent reads the
docs; stale docs actively mislead them (proven: three findings drifted between audit and handoff).

## Context

Ten stale or contradictory documentation items, enumerated with file:line in
[BASELINE.md](BASELINE.md) § Doc-staleness ledger. All are prose fixes; zero code risk. The largest
piece is adding a status ledger to `docs/analysis.md` so its 12 findings state what has landed.

## Pre-flight

```sh
grep -n 'docs/vNext' README.md docs/release-notes-vnext.md
grep -n 'allowlist' docs/integrations.md docs/http-client.md
grep -n '330 lines\|13 rules\|ESLint' docs/analysis.md
grep -n 'profile plugin\|profile package' docs/terminal-and-agents.md docs/architecture-overview.md
grep -n 'spawn' docs/terminal-and-agents.md
grep -n 'adoption' docs/ui-design.md   # expect no hits
grep -rn 'CONVERTED' packages/client-core/src/ui/adoption.test.ts | head -2
```

If any item is already fixed, strike it from the slice list and note it in Progress.

## End state

All ten ledger items resolved; `docs/analysis.md` opens with a dated status ledger; every doc claim
about enforcement matches `tools/arch/boundaries.test.ts` as it exists at execution time.

## Non-goals

- No rewrite or renumbering of `docs/analysis.md` — its finding numbers are cited by
  `tools/arch/boundaries.test.ts` comments.
- No fixing the notes-under-memory namespace here (that is WP-07's contract change; its doc update
  travels with the code).
- No new architecture documentation beyond the listed items.

## Slices (one commit each)

1. **Broken links.** `README.md:95` and `docs/release-notes-vnext.md:37`: `./docs/vNext` →
   `./docs/legacy/vNext` (adjust relative form per file location).
2. **Allowlist contradiction.** Rewrite `docs/integrations.md:49` to match reality as stated in
   `docs/http-client.md:21-25`: there is no host allowlist or central outbound guard; each
   provider's own validation is the control. Keep the "bounded timeouts" half only if verifiable in
   provider code (check `plugins/{rollbar,linear,github}/src/server/provider.ts`).
3. **analysis.md status ledger.** Add a short dated section at the top: findings 2, 3, 4, 5, 7, 11,
   12 landed (one line each naming the enforcement that proves it — e.g. F2: open WS envelope in
   `packages/protocol/src/ws.ts` + prefix registry in `packages/client-core/src/wsChannels.ts`;
   F4: `CORE_IMPORT_ROOTS`; F12: `CHILD_PROCESS_OK`); findings 6, 8, 9, 10 open, each pointing at its
   work package (F6 → WP-08, F8 → WP-07, F9 → WP-09, F10 → WP-03 through WP-06). Fix `:36` (603 lines, 22 rules at pin time —
   re-measure) and `:313` (oxlint exists, deliberately narrow per CLAUDE.md). Do not edit the
   finding bodies.
4. **Profile plugins folded in.** `docs/terminal-and-agents.md:28` and
   `docs/architecture-overview.md:118`: drivers are registered by literal in
   `plugins/agents/src/node/index.ts`; the profile packages no longer exist (commit `5d983af5`
   folded them in).
5. **Spawn claim.** `docs/terminal-and-agents.md:20`: replace the universal "plugins do not call
   spawn/execFile directly" with the actual contract — direct child-process use is limited to the
   reviewed `CHILD_PROCESS_OK` allowlist (`tools/arch/boundaries.test.ts:221`), as
   `docs/security.md` § Process controls already states.
6. **Adoption ratchet.** Add a short subsection to `docs/ui-design.md` documenting
   `packages/client-core/src/ui/adoption.test.ts`: the `CONVERTED` list of converted `.tsx` files
   may only grow, the retired-class regex must stay clean, and new components must use the ui
   primitives.

## Gates

`pnpm lint` after slice 3 and 6 (markdown-only slices don't need it, but it is cheap — run it once
at the end regardless). No package tests apply.

## Risks & rollback

Prose-only; each slice reverts independently. The only correctness risk is asserting something
*else* stale while fixing an item — every claim you write must be verified against code in the same
sitting.

## Doc updates

This package *is* the doc update.

## Done criteria

- [ ] All pre-flight greps return the corrected state.
- [ ] analysis.md ledger present, dated, and cross-links to `docs/antislop/`.
- [ ] No edits outside `README.md` and `docs/`.

## Progress

- [ ] Slice 1 — links
- [ ] Slice 2 — allowlist claim
- [ ] Slice 3 — analysis.md ledger + stale counts
- [ ] Slice 4 — profile plugins
- [ ] Slice 5 — spawn claim
- [ ] Slice 6 — adoption ratchet documented
