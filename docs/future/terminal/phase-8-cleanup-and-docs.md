# Phase 8: cleanup and docs

Status: not started. Waits on phase 7.

## Goal

Every behaviour this folder describes lives in an owning doc under `docs/`, `docs/tui.md` (new) owns
the terminal client the way `docs/shell.md` owns the desktop, and this folder is deleted with
`git log --follow` as the record.

## Why this phase, and why now

`docs/future/` describes work not yet built. Once the TUI ships, this folder is a history of how it
was decided, and history belongs in git. The layout and client-plugins programmes end the same way.

## Scope

In:

- `docs/tui.md` (new): the process model, the config directory, the kit on OpenTUI, the chrome,
  the keys, custody, the deployables, and the plugin table from [01-why.md](./01-why.md) as a
  reference table. Written for someone maintaining the TUI, not for someone deciding whether to
  build it.
- Every "docs owed" line in phases 0 to 7 checked as done.
- `docs/architecture-overview.md`: the terminal as a third client beside desktop and (planned) web.
- `docs/security.md`: the terminal column complete (phase 5 wrote it; this phase reads it once more
  against what shipped).
- `docs/testing.md`: the `tui` project, the TUI boot test, and the pane snapshots as tiers.
- `docs/future/README.md`: the `terminal/` row removed; the folder added to the retired list with
  where its behaviour moved.
- `docs/future/bundle.md`: any claim this folder changed and phase 7 did not already fix.
- `docs/future/remote.md`: the terminal client is shipped; its auth and custody notes point at
  `docs/tui.md` (new).
- `docs/future/client-plugins/`: "waits on a terminal host" is satisfied; `07-hosts.md § The
  terminal` points at `docs/tui.md` (new).
- Every inbound link to this folder repointed. `tools/arch/docPaths.test.ts` fails on any that is
  missed.
- Delete `docs/future/terminal/`.

Out: anything that is still design. If a phase left a door open that is now being walked through,
that is a new file under `docs/future/`, not a reason to keep this folder.

## Design detail

Follow [docs-migration.md](./docs-migration.md) row by row. Each row names the owning doc, the
section, and what it says afterwards. Where the owning doc and this folder disagree about what
shipped, the code is right, the owning doc is fixed to match the code, and this folder is deleted
without correction.

## Code touched

None. Docs only, plus the deletion.

## Tests

- `tools/arch/docPaths.test.ts` passes after the deletion: no backticked path and no relative link
  points into `docs/future/terminal/`.
- `tools/arch/kitTable.test.ts` still reads `docs/ui-design.md`, which this phase does not move.

## Docs owed

This phase is the docs owed.

## Doors left open

Recorded in `docs/tui.md § Doors left open`, one line each, from every phase's section of the same
name: the loopback token mint, the pairing-window command, mouse, graphics protocols, the container
image with `acorn`, the node half out of process.

## Done when

`ls docs/future/terminal` fails, `docs/tui.md` (new) exists, `pnpm test` passes, and a reader of
`docs/future/README.md` finds the folder in the retired list with a sentence saying where each piece
went.

## Verify before building

- Phases 0 to 7 are marked shipped in this folder's README.
- Every "docs owed" list has been executed; grep each owning doc for the sentence it was owed.
