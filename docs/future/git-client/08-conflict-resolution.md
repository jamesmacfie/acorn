# Phase 08: three-way conflict resolution

Date: October 7, 2026. Status: implemented October 11, 2026. Shipped behavior is in
[Git conflict resolution](../../git-client/conflicts.md).
Depends on [phase 07](./07-operations.md).
Read the [full implementation context](./README.md), especially
[conflict handling](./README.md#operations-and-conflict-handling),
[mutation contracts](./README.md#mutation-contracts), and
[verification](./README.md#verification-strategy).

## Acceptance evidence: October 11, 2026

The desktop fixture was `/tmp/acorn-conflict-fixture/repo`: a merge that stops on a text conflict
(`shared`), a modify/delete conflict (`gone`), and a binary conflict (`bin`). The terminal fixture
was `/tmp/acorn-conflict-fixture/tui`, the same three files stopped in a rebase. Each session's task
was a null-branch `tasks` row inserted into the session's `core.sqlite`.

- `plugins/git/src/server/conflicts.test.ts` uses real repositories for merge, rebase, cherry-pick,
  revert, and stash conflicts, add/add and modify/delete, an absent working file, a name with
  glob characters, a symbolic link, path escape, binary, and oversized input. It changes the
  working file and the index after a read and checks that the save refuses and the newer content
  stays. It covers a staging failure after a save, the retry, a busy checkout, and a cancelled read.
- `plugins/git/src/client/ConflictResolver.test.tsx` uses the real custody owner. It covers taking a
  side, the save request and acknowledgement, typing in Editor between edits, an Editor draft made
  against another version, the saved-but-unstaged retry, a confirmed deletion, and unsupported input.
- Desktop, `pnpm dev:agent -- --session git-resolve --project <fixture>`: saving the untouched
  result was refused with `unresolved_markers`. After **Use theirs**, the file was changed outside
  Acorn and the save was refused as stale with the outside text intact. **Reload** then reported the
  leftover draft as made against another version, and Editor showed the same draft with its own
  **Changed on disk** warning. **Discard draft**, **Use theirs**, and **Save and stage** staged
  `shared`. **Take deletion** removed and staged `gone`. `bin` showed the terminal recipe, was
  finished with `git checkout --theirs` and `git add`, and **Continue** created the merge commit.
- Terminal, `pnpm dev:tui:agent -- --session git-resolve-tui --project <fixture> --cols 120 --rows 60`:
  the rebase labels read **Rebased so far onto** for ours and **Task commit being replayed** for
  theirs. Keyboard presses took theirs and saved and staged `shared`, confirmed **Take deletion** on
  `gone`, opened the `bin` guidance, and **Continue** finished the rebase.

The terminal run found one defect, fixed before the evidence above. Down wraps inside a kit list and
Tab leaves the region, so a stop placed after a list can't be reached by keyboard. The first layout
put a side picker list and the banner's conflict list above the resolver's buttons. The resolver
replaces the banner while it's open and draws every side as plain stops.

Gates: `pnpm test --filter=@acorn/plugin-git` passes, 122 tests. The full `pnpm test` and
`pnpm lint` reds all predate this phase: the 15 dead doc links, `CoreServices` lacking
`checkoutAdmission` in lint, the Editor pane, terminal chrome, and Workflows tests, the plugin-disable
golden, and worker tests that need the patched Node. `apps/node/test/integration/routeRegistry.snapshot.json`
was regenerated. It gained the conflict routes, phase 07's operation routes, and a Workflows route
that was already missing.

Cache and lifetime: a conflict read is one query keyed by Node, task, and path, with no refetch timer
and no retry. Its response holds at most four texts of 512 KiB each. The read is cancelled when the
view unmounts. The resolver holds the file's custody only while mounted. A dirty draft stays in
memory and device recovery after it closes, the same as an Editor draft.

## Deliverable

A person inspects base, ours, and theirs, edits a result through Acorn's document surface, and
explicitly saves/stages a supported text resolution. Stale index/file revisions and dirty-buffer
conflicts are refused without overwriting another actor's work.

## Steps

1. Add bounded, confined reads of unmerged index stages and the working result. Return immutable
   stage identities, operation-aware labels, absence/deletion metadata, capability limits, and a
   revision fingerprint covering the index and result. Refuse unsupported binary/large inputs
   with Editor/terminal guidance rather than pretending they are empty text.
2. Compose the shared document/editor surface for three read-only source sides and an editable
   result. Reuse Editor's draft, dirty-buffer, save, and recovery ownership through a narrow public
   contract. Use kit/host layouts and provide the terminal's usable source/result navigation.
3. Provide explicit take-side actions and result editing for supported text and deletion cases.
   Represent add/add and modify/delete conflicts accurately; taking a missing side is a deliberate
   deletion, not an empty-file substitute. Show rebase stage roles with meaningful labels.
4. Save/stage under task admission with fresh stage/result and ownership checks. Refuse unresolved
   markers, path escape, stale revisions, and conflicting unsaved buffers. Report save success
   followed by stage failure as a partial result with retry; refresh state before retrying.
5. Keep operation continuation separate. Dispose source reads and draft bindings on task/Node
   changes without silently losing unsaved work. Update shipped documentation and record the
   complete eight-phase acceptance evidence.

## Acceptance

- Real repositories cover merge, rebase, cherry-pick, revert, and stash text conflicts; add/add and
  modify/delete; absent stages; unusual filenames; symlink/path escape; binary and oversized data.
- Change the index or result after reading it. Save/stage refuses the stale request and preserves
  newer content. Test unsaved Editor buffers, save failure, stage failure after save, safe retry,
  activity races, and cancellation during read.
- Desktop and terminal resolve a supported conflict, deliberately choose a deletion, encounter an
  unsupported case, and continue the operation only through an explicit action.
- Run affected package/consumer suites, `pnpm lint`, architecture gates, and full `pnpm test`.
  Record both-host evidence and measured cache/lifetime behavior for the completed client.

## Verify before building

- Recheck Editor document/revision contracts and dirty-buffer arbitration before exposing writes.
- Verify unmerged stage semantics for each supported operation, including rebase role reversal.
- Confirm operating-system path confinement and safe deletion behavior in the selected baseline.
