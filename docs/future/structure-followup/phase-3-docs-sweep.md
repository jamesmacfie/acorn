# Phase 3: docs sweep and retirement

Status: not started. Waits on phase 2.

## Goal

Every path and link in `docs/` and `docs/future/` is true against the tree phases 0 to 2 left, the
owning docs say the new true things listed in [docs-migration.md](./docs-migration.md), and this
folder is deleted with `docs/future/README.md` saying where its behaviour went.

## Why this phase, and why now

Same reason as the 2026-08-30 reorganisation's own closing sweep: the path checker
catches rooted paths and relative links, and nothing catches prose that names a package by its old
name, a verb by its old spelling, or an origin enum that no longer exists. One pass at the end is
cheaper than three partial ones.

## Scope

1. Run `tools/arch/docPaths.test.ts`. Fix every red.
2. Grep the retired words and check each hit by hand: `desktop-helper`, `@acorn/desktop-helper`,
   `github-pr` outside the github plugin's own docs, `extensionPoints.open`, `.contribute(`,
   `.entries(`, `AgentFlavour`, and the four origin names in one list in
   `docs/architecture-overview.md` § Product model.
3. Re-read, not grep: `docs/architecture-overview.md` §§ Runtime topology, Package boundaries,
   Product model; `docs/plugins.md` §§ The plugin API, Loaded plugins, Node providers;
   `docs/first-party-plugins.md` § What a loaded plugin cannot have (reason E's "no manifest form
   yet" rows should still be true); `docs/contribution-kinds.md` in full.
4. `docs/future/terminal/` and `docs/future/client-plugins/` cite the custody package by its phase 0
   name.
5. Move the `structure-followup/` row in `docs/future/README.md` to the retired list with one
   sentence per finding saying which owning doc section holds it. Delete this folder.

## Out of scope

Prose truth outside the sections named above. Each owning doc's author is still the check.

## Done when

- `tools/arch` is green.
- The grep list in step 2 returns nothing outside git history and the github plugin's own docs.
- `docs/future/README.md` lists this folder under retired and `docs/future/structure-followup/` does
  not exist.

## Verify before building

- Phases 0 to 2 have shipped; each phase's own "Done when" holds.
- `docs/future/README.md` still carries this folder's row in the programmes table.
