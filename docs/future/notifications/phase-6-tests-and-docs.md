# Phase 6: the invariants as tests, the owning doc, and deleting this folder

Design, 2026-09-02. Not started. Depends on every other phase.

## Goal

The eight invariants in [model.md](./model.md) are tests that fail when the model is broken. One
document under `docs/` owns notifications and every other mention points at it. This folder is gone.

## Why

Today no document owns notifications ([analysis.md](./analysis.md) § What is sound and stays names
five that mention it). `docs/README.md` says a fact has exactly one owning document. Once phases 1
to 5 have shipped there is enough behaviour to deserve one file, and enough places pointing at it
that the pointers need a target.

## Requirements

1. `packages/client-core/src/features/notifications/invariants.test.ts` (new) holds the eight
   invariants as property-style tests over generated snapshot sequences: every pair of the five
   states through `edgesBetween`, random focus and active-task contexts through `deliver`, random
   settings, both adapters producing the same kind for equivalent states. Fixed seeds, no
   fast-check dependency unless one is already installed.
2. `docs/notifications.md` (new) owns: the five states and two adapters, the three edges, the gate
   and its seen rule, acknowledge on view, the channels and the `notify` seam group, the settings
   schema and the terminal client's environment variable, the two chimes, the terminal OSC recipe,
   and the notice-versus-attention distinction moved from `docs/frontend.md`. Written from
   [model.md](./model.md) with the code as the check, not the other way round.
3. `docs/README.md` lists the new file in the group it belongs to, on the same commit.
4. Pointers: `docs/plugin-map.md` § Notifications keeps its decision table and points at the new doc
   for the model; `docs/frontend.md` § Shell state shrinks to a paragraph and a link;
   `docs/shell.md` § The renderer bridge names the `notify` group and links; `docs/tui.md` § Chrome
   names the count and overlay and links; `docs/features.md` § Settings and fleet names the page;
   `docs/state-ownership.md` § Scope rules lists notification settings as device state;
   `docs/contribution-kinds.md` row "Attention sources" gains `attentionReason`.
5. `docs/future/README.md` moves this folder to § Retired folders with a paragraph saying which doc
   took what, and the row in § The programmes goes.
6. `git rm -r docs/future/notifications`.

## Design notes

**Why a new doc and not a bigger `plugin-map.md` section.** `plugin-map.md` answers "which call do I
make from a plugin". The model, the gate, the seam group, and the settings are the host's, and a
plugin author needs one row of them. `docs/README.md` puts the count under 60, so a new flat file is
inside the rule.

**Why property tests here and unit tests in the phases.** Each phase pins its own requirements with
tables. The invariants are about the whole: that no future adapter or sink can make a seen edge
noisy or a badge disagree with a pill. A generated sequence finds the case a table forgot.

## Files

- `packages/client-core/src/features/notifications/invariants.test.ts` (new).
- `docs/notifications.md` (new), `docs/README.md`, and the six docs in requirement 4.
- `docs/future/README.md`.

## Tests

- The invariants file itself.
- `tools/arch/docPaths.test.ts` passes after the moves.

## Acceptance

- Requirements 1 to 6 hold.
- `pnpm lint` and `pnpm test` pass.
- `grep -r "docs/future/notifications" docs` returns only the retired-folders paragraph.

## Doc moves, done

This file is deleted with the folder.
