# Unit 21 coordinator review brief

Source review on October 1, 2026. Read area 13, docs/database.md and docs/editor.md, reviewed unit
16 host document custody and unit 06 scoped bridge construction. This unit completes the SQL
scratch-specific byte/recovery contract rather than replacing those owners.

## Established byte bound

Database scratch and completion validators currently cap JavaScript characters while the shared
MAX_DOCUMENT_BYTES and host document bridge cap UTF-8 bytes. Exactly 2 Mi characters of é therefore
creates a 4 MiB stored document the host refuses to draw. Use the existing shared constant and a
Node UTF-8 byte check for scratch, completions and generated scratch writes. Trace writeScratch:
the palette Generate SQL route currently bypasses scratchBody entirely. Keep checks at the owning
input/commit boundary; reject before durable replacement and never silently truncate SQL. Saved
query/prompt/token bounds are distinct contracts, not reasons to widen the document cap.

Prove ASCII, multibyte, emoji, combining text, empty, exact cap and one-byte-over behavior through
the actual loaded portable routes. A refused input must preserve the prior stored row and full
unsent host text. Generation must not report success or focus a document whose commit was refused.
No paid provider call is needed: use a synthetic provider at its existing seam.

## Already stored oversized rows

Do not change validators and strand existing rows. Preserve complete stored SQL and provide a
documented compatible recovery/export path under the existing task/Node/document grant. Propose
the exact host/tree/route flow before editing. A read-only oversized state with explicit full-text
export or an authorized recovery surface can preserve data; converting it to an editable empty
document, truncating it, automatically overwriting it with a smaller buffer or raising every host
document bound is unacceptable. Keep any recovery authority tied to the original task and Node,
not a general file/network escape. Existing rows stay readable through their authorized storage
route and remain untouched until an explicit valid replacement succeeds.

## Flush, execution and retirement

Unit 16 should already make host flush reject on failed persistence and retain dirty text/undo
outside the view. Verify both Database Execute paths against that adopted owner: surface keybinding
dispatch after flush and button document.read/execute. The implementation must not execute stale
Node scratch while claiming current editor text was committed. Define whether the button explicitly
flushes first and preserve its documented SQL semantics; do not swallow rejection as empty text.
Failed/oversized edits must survive view close, Node switch, document remount and recovery admission
through a newly granted equivalent slot. A retired bridge must not retain document authority.

Palette/saved-query/table selection can replace host text. Guard held reads and selection generations
and honor current dirty-text replacement behavior instead of overwriting edits after an await.
Keep SQL execution, row write authorization, connection state, result caps and saved-query project
scope intact. This unit does not change database driver streaming or execute automatic retries.

## Evidence

Disposable plugin SQLite routes with existing oversize Unicode rows; valid/refused generated writes;
actual host editor + loaded bridge document flush/recovery, both Execute entry points, held failures
and same-ID Nodes. Compare accepted bytes and complete recovered/exported text, not shortened
fixtures. Run focused route/host/tree suites/types/lint and owning docs. Coordinate native composed
Database pane error/reopen/recovery screenshots and cleanup with the coordinator, using no normal
database, credential, provider or profile. Operation/recovery correctness is distinct from CPU or
native timing; do not claim a speed gain from rejecting previously stored content.
