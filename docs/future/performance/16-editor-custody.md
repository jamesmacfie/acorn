# Editor saves, document custody, reloads, and text fidelity

Date: October 1, 2026. Status: pending implementation; unit 16.
Assignment: one specialist, run sequentially after coordinator review of the preceding unit.
Prerequisite: Units 01–15, implemented and reviewed in sequence. Paths and findings describe the audit snapshot, not guaranteed merged source.

## Read first

Read [the programme](./README.md), [the implementation contract](./contract.md), and
[the deferred work](./refused.md). Follow the repository engineering guide and the owning runtime
documentation. Trace source, Node API, protocol, broker, cache, and renderer where this assignment
crosses them. Review Git changes since the audit before capturing a fresh cumulative baseline.

The preserved investigations contain the reproducible probes, measured workloads, source paths,
proposed improvements, rejected alternatives, and limits:

- [Investigation 12](../../../plans/performance/12-editor.md).

The original [unit brief](../../../plans/performance/implementation-16-review-brief.md) and
[implementation sequence](../../../plans/performance/implementation-plan.md) retain provenance.
The sections below reproduce the detailed assignment so this handoff carries its review concerns.
No application fix for this unit is included in the units 01–08 commit.

## Detailed assignment

Source review on October 1, 2026. Read report 12 and reviewed units 04, 05, and 15. Start after
preceding units pass coordinator review. Return the editor/document custody proposal before editing.

## File editor ownership and acknowledgements

`EditorPane` shares a task pool through paneModel but its file API uses the ambient Node. Capture
QueryClient ownership at API construction, including prefetch paths. Give each complete document
address one write owner: acknowledged text/revision, one active write, and a coalesced latest edit.
Avoid retaining a full-string closure for each repeated flush. Independent documents must remain
independent. Failed/rejected/vetoed writes preserve full dirty text, undo, cursor, and scroll beyond
pane/model retirement. Scope bookkeeping to the captured Node/task/document generation so a late
write cannot mark a replacement clean or recreate its closed entry.

Close must await acknowledgement of the intended current edit and retain the tab/recovery state if
the write fails or the person changes it while awaiting. Clean saves skip network/hook/invalidation
work and join a matching pending write rather than acknowledge it early. Retiring a UI owner cannot
drop the last write or redirect it through the incoming Node. Reuse the ownership policy from unit 05
without importing Notes' feature-specific draft module. Keep transient CodeMirror state separate
from recoverable dirty document custody; do not introduce arbitrary dirty-text or undo eviction caps.

The Node before-save hook can transform text but `EditorWriteResult` only says ok. An acknowledgement
of submitted text is incorrect when a formatter writes different text. Return a compatibility-safe
proposal for exact acknowledged body/revision, old peers, and edits during formatting. Do not simply
reread after save and assume an unrelated later external write is the formatter acknowledgement.
Preserve veto/timeout/environment/path and ordinary worktree invalidation semantics.

## Host document flush

`DocumentSurface.save` advances saved before the request and catches its error. Consequently a second
flush returns early and a command can run after failed persistence. The document bridge already
awaits the handle and can propagate failure. Repair the host owner once, not each loaded plugin:
flush joins or queues the captured current revision and rejects failure; autosave and retirement
handle that failure without unhandled rejections and retain exact dirty text/recovery. Surface actions
and frame requests may execute only after the intended write acknowledges. Keep Node/scope/URI and
document grant identity distinct from the DOM surface lifetime. Revoked authority cannot be kept alive
just to retry through a replacement slot; explain the durable recovery/reacquisition policy at the
host seam. Preserve read-only documents, lazy grammars, completions, and the existing 2 MiB UTF-8
document wire ceiling. SQL oversized recovery is unit 21 and must build on this owner.

## Reloads, markers, and preview lifetime

Focus reload must capture document identity/read generation/current text and recheck all of them plus
dirty status after the read. A later edit wins. An acknowledged reload is not a user edit and must not
schedule an unnecessary save. Show usable file text independently of optional marker work; consume
unit 15's exact marker/body identity rather than inventing another provenance cache. Held marker or
grammar completions must not construct or annotate a discarded document generation.

Canonical open tabs determine retained clean preview membership. `remember` must not reinsert a clean
preview removed from the tab set, and held reads must not repopulate it. Keep promoted/dirty/kept tabs
and their undo/view state across same-task pane toggles. Clean preview retirement is selected; LRU
eviction of open/dirty tabs is not. The generic host document view-state map currently evicts a scope
across all Node prefixes. Check colliding IDs against the originating-Node eviction contract rather
than treating an archive in one independent Node as authority over another Node's state.

## Honest text loads

The file pane converts rejected reads to an editable empty saved document. Preserve a truthful load
error and prevent saving that fabricated body. The server reads arbitrary bytes with readFile utf8,
so invalid UTF-8 becomes replacement characters that are later written back. Read/decode with an
explicit lossless supported-text policy; preserve valid Unicode, genuine U+FFFD, BOM, and complete
supported large files. Refuse unsupported binary/invalid UTF-8 visibly rather than trim, repair,
or replace bytes silently. The file editor's demonstrated 17 MiB read policy and host document's
2 MiB UTF-8 wire ceiling are different boundaries; do not apply the host cap to every file as an
unmeasured performance shortcut.

## Evidence

Use fresh cumulative before fixtures under a verified single ESM Solid runtime. Exercise actual
EditorPane, document handle/bridge, Node formatter/write API, and migrated source contracts. Cover
held writes/second flush, latest edits, undo to acknowledged content, ordered failure/retry, veto,
formatter replacement, failed close, Node switch, same-ID return, model retirement, reload while
typing, disposal during read, stale markers, 24 superseded previews, promoted preview, failed loads,
large complete text, invalid UTF-8, valid replacement characters, and BOM. Count writes/hooks/marker
refreshes and retained clean-preview text/state; measure relevant CPU separately. Verify execute
does not run on pending/failed flush and every retained dirty document stays recoverable. Native
screenshots and interactions are coordinator work after staging; no paid calls are needed.

## Completion and handoff

Implement only the reproduced issues within this assignment. Return any explicitly requested
compatibility, migration, or custody proposal to the coordinator before changing that contract.
Use current production owners for paired evidence; preserve historical fixtures and label superseded
baselines. Write an implementation record with changed files, exact commands and outcomes, before
and after comparisons, costs, and concrete remaining limitations. Update the owning shipped docs
when behavior changes. Retire all disposable resources before review. Do not start the next unit.

## Verify before building

- Re-read the merged source and applicable engineering instructions; the audit predates the main merge.
- Confirm prior units' contracts and actual callers still match this proposal.
- Resolve the listed owner, capability, data model, migration, and compatibility decisions before editing.
- Verify a single Solid runtime and normal QueryClient provider for browser measurements.
- Capture fresh source/probe hashes and the same supported workload on both sides of the change.
- Preserve canonical content, offline rows, unsent drafts, and independent Node authority.
- Run relevant tests and types, then coordinate cumulative lint, bounded tests, and real UI checks.
