# Phase 08: three-way conflict resolution

Date: October 7, 2026. Status: planned; implementation not started.
Depends on [phase 07](./07-operations.md).
Read the [full implementation context](./README.md), especially
[conflict handling](./README.md#operations-and-conflict-handling),
[mutation contracts](./README.md#mutation-contracts), and
[verification](./README.md#verification-strategy).

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
