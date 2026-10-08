# Phase 02: history and diffs

## Final review closure, October 9, 2026

**Status:** Complete on `phase-2-history-and-diffs`. Historical diff scopes now pass the
actual optional task ID to the shared viewer. Its public scope key uses the
`task:<id>:` prefix, so archiving evicts task view position while repository browsing
remains separate. A source whose target lifetime or viewport has ended rejects patch,
search, and gap operations before starting transport. Explicit or event-driven history
refresh clears pending pagination and its error after aborting the old request; a late
page cannot enter the refreshed window, and Load more works again.

**Focused verification:** Git history model, revision source, and task pane model tests
passed (three files, six tests), including the existing Node/filter cancellation checks,
a controlled late continuation, and public task/browse scope keys. The shared diff
view-state eviction tests passed (three tests).
Git plugin type check, touched-source oxlint, and diff whitespace check passed. The
desktop/terminal screenshots, architecture checks, and measured bounds in the prior
note remain applicable; no host or broad build gate was rerun. The unrelated unchanged
`docs/api-reference/plugin-routes.md` doc-citation length failure remains.

## Review follow-up, October 9, 2026

**Status:** Corrected and verified on `phase-2-history-and-diffs`. The first desktop
capture showed separate history marks. The shared kit now projects per-row incoming,
outgoing, pass-through, and continuation edges into the host row's actual height. A
disposable branch/merge fixture shows a connected divergence and convergence, and the
root ends at its dot. Filtered results show marks without inferred edges. More than
eight active lanes display a `+N` count instead of folding unrelated paths onto one
coordinate. A dashed incoming edge marks a client window after earlier pages are
evicted. The Git rows use a subject and one parent/ID line, with a refs line only
where needed; terminal rows retain every parent in text.

Unfiltered cursors can advance beyond the 5,000-commit search window. Search still
examines at most 5,000 reachable commits, and both modes keep 100-commit pages, a
1,000-row client window, and 32 ten-minute Node snapshots. Revision diff identity now
includes Node, project, optional task, commit, and base. The viewer's viewport signal
and the captured target lifetime abort late segments, search, and gap reads. The Node
propagates cancellation through repository resolution, ref reads, parent resolution,
cache-miss re-reads, patch reads, and blob reads; cancelled patches cannot become a
normal omission or a cached revision. Root comparisons ask Git for the repository's
empty tree, supporting SHA-1 and SHA-256. A task pane retries its recorded branch on
refresh and reinitializes that scope on Node or task changes.

**Focused checks:** Seven Git test files passed (21 tests), including a forged cursor
past offset 5,000, a real SHA-256 repository, cache-miss and gap aborts, and delayed
client segment/search/gap responses. Shared history geometry and mark tests passed
(five tests); terminal kit passed (135 tests, two skipped). Type checks passed in the
Git plugin, client core, Node, desktop, and terminal packages. Touched-source oxlint,
Git diff whitespace, and five relevant architecture files passed (65 tests). The
unchanged `docs/api-reference/plugin-routes.md` one-line doc-citation failure remains
outside this phase; root lint and full test were not run.

**Both-host evidence:** The reproducible fixture is `/private/tmp/acorn-phase02-branch-fixture`:
three main commits, two topic commits, a main divergence, a `--no-ff` merge, and one
post-merge commit. Desktop session `git-phase02-review` showed connected lanes and
root termination in `.acorn/agent-dev/git-phase02-review/screenshots/screenshot-1791490921798.png`.
A search for `Topic` showed three disconnected marks in
`screenshot-1791490934195.png`. Terminal session `git-phase02-review-tui` selected
the merge with `j` at 80×24, then at 120×40 showed both parent IDs, both parent buttons,
comparison selection, and the patch. Both sessions were stopped.

**Measured bounds:** On the existing 2,401-commit disposable repository, a cold first
page took 53.57 ms/four Git subprocesses for 100 rows; the next took 57.97 ms/four.
Revision topology took 39.02 ms/four for one file and the first segment took
17.75 ms/two for four rows. The parsed cache held one document, one entry, 183 bytes.
The neutral connected geometry serialized to 22,052 bytes for 100 linear slots and
222,752 bytes for 1,000; both stayed at one lane. The production Node service held at
3,186,368/3,187,000 bytes, and terminal startup at 729,585/730,000 bytes. The
measurement harness is `.acorn/agent-dev/phase02-review-measure.mjs` (ignored test
artifact). The eight-lane display cap does not cap neutral relationships or parent
actions; the visible mark names the hidden lane count.

**Next phase:** Use the Node/task-qualified revision source identity and immutable
comparison base. Keep the task branch retry and the separate worktree navigation IDs.

## Completion note, October 9, 2026

**Status:** Implemented on `phase-2-history-and-diffs`. The Git source opens on
history, keeps Worktrees as a section, and the task Git pane starts on its recorded branch. A
missing task branch produces a named warning and falls back to repository history. Changes remains
the working-file, staging, and commit surface; historical files have read-only diff actions.

The Node returns immutable commit IDs, every parent, author and committer metadata, messages, dates,
current ref labels, and 100-commit topological pages. A cursor pins the selected tip IDs. The Node
keeps 32 cursors for 10 minutes and returns an expiration error after eviction, restart, or missing
objects. Search uses a case-insensitive substring of the full message, author name and email, or full
object ID among the newest 5,000 reachable commits. The query limit is 128 characters. The client
keeps at most 10 pages. The history mark lives in the shared kit; terminal rows state parent IDs and
refs in text. Filtered rows show no inferred edges.

Revision detail validates the selected commit and comparison parent. Roots use the empty tree;
merges default to the first parent and permit an explicit parent. NUL-delimited topology preserves
renames, deletion, modes, binary labels, and unusual names. A revision returns topology and segment
descriptors before `DiffPane` requests visible patch rows. The same source supplies bounded search
and gap expansion. The Node caps one topology at 500 files, one patch read at 8 MiB, parsed rows at
32 MiB, and held documents at 16. An omission carries an explanation instead of empty patch content.
All routes require a paired device. A two-active-read gate with a 32-request queue bounds concurrent
Git reads. Node, task, filter, and selection changes reset the applicable client scope; late page
responses are aborted and discarded.

**Decisions:** The cursor pins tip IDs in a bounded Node map instead of encoding a potentially large
ref set in the URL. Repository paths stay server-mapped. Revision files use the shared diff document
and a kit split with a scrolling metadata column, which leaves the patch visible in a narrow terminal.
The file list folds when it exceeds five entries. The external worktree manager stays installed for
Phase 04 acceptance. Phase 02 adds no work from later phases.

**Focused checks, October 9, 2026:** Git server/client and Phase 01 roster tests passed (six files,
16 tests after the detached/unborn and merge-base additions); history layout and kit support passed
(two files, seven tests); terminal kit passed (135 tests, two skipped). Type checks passed for the Git
plugin, Node, desktop, and terminal packages. Touched-source oxlint and the boundaries, source-field,
kit-table, public-plugin-surface, and doc-path checks passed (65 architecture tests). Node service
build measured 3,186,368 of 3,187,000 bytes; terminal startup closure measured 729,585 of 730,000
bytes. The root lint and full test gates were intentionally left to the coordinator.

**Both-host acceptance, October 9, 2026:** A disposable `tui-navigation` repository was extended
to 2,401 commits, with 22 files in its root. The desktop production bundle displayed 100 connected
history rows, full parent actions, ref labels, file topology, and an on-demand patch. The first
screenshot, `.acorn/agent-dev/git-phase02fresh/screenshots/history-final.png`, exposed
disconnected marks; the review follow-up above records the corrected rendering. Earlier desktop
driver checks selected the root, moved a ref during pagination, refreshed while retaining a valid
selection, searched `HISTORY 2300` to one result, and navigated to a parent. The terminal driver used
`git-phase02final` at 80×24 and 120×40. Both sizes showed parent IDs, refs, keyboard-selected
history, comparison controls, and the patch; the 80×24 view kept the patch on screen. Both sessions
were stopped. The disposable repository is `.acorn/agent-dev/git-phase02d/fixture/repo`.

On that repository, a cold first page took 49.18 ms and four Git subprocesses for 100 commits; the
next page took 44.36 ms and four subprocesses. Revision topology took 38.01 ms and four subprocesses
for one changed file and one segment. The first segment took 17.63 ms and two subprocesses. The
resident parsed-document cache held one document, one entry, and 183 bytes after the read. Kit
projection produced 100 slots in 13,100 JSON bytes and 1,000 slots in 131,000 bytes; this linear
fixture used one lane and one continuation at either boundary. Client paging is capped at 1,000 rows,
and the Node cache budgets above bound resident history and revision data. A client test confirmed
that switching Node or filter aborts and discards a late continuation.

**Unrelated failure:** The unchanged `docs/api-reference/plugin-routes.md` exceeds the
`docCitations.test.ts` 200-line limit by one line. The focused architecture checks above passed; this
phase did not edit that reference page. A fresh offline install also lacked a cached `drizzle-kit`
tarball, so local dependency links were repaired against installed packages before checks. That is
an environment prerequisite, not a product failure.

**Phase 03 guidance:** Use the Git plugin's public history and revision routes and the shared diff
source contract. Keep worktree navigation IDs separate from mutable cleanup observations. Preserve
the task checkout versus inspected checkout labels and the Changes link when adding later actions.

Date: October 7, 2026. Status: completed October 9, 2026.
Depends on [phase 01](./01-plugin-and-worktrees.md).
Read the [full implementation context](./README.md), especially
[read contracts](./README.md#read-contracts) and [both hosts](./README.md#both-hosts).

## Deliverable

A person browses recent commits across the selected repository or within a task branch, filters by
ref, searches, follows parent relationships, selects a commit, and inspects its files and diff.

## Steps

1. Add bounded history and ref reads with immutable object IDs, all parents, author/committer,
   message, dates, labels, observation revision, and a continuation cursor. Pin or expire the
   cursor when its source ref set moves. Specify text/author/hash search semantics and limits.
2. Serve revision detail and file topology. Default normal commits to their first parent, roots
   to an empty-tree comparison, and offer explicit parent comparison for merges. Validate selected
   objects and handle missing objects without substituting another commit.
3. Build a historical diff source over the public segmented document API. Load topology first and
   patch segments on demand; support bounded search and gap expansion. Keep Node parsed-document
   and client segment caches bounded and keyed by immutable revisions and comparison base.
4. Add the shared kit's compact history geometry and desktop rendering. Accept neutral IDs,
   parents, labels, and row slots; preserve stable lanes across loaded pages, show continuation
   edges for unloaded parents, and avoid drawing false edges after filtering. Add the terminal
   relationship-row projection and update the kit vocabulary/support inventory.
5. Wire the repository history section and task-pane default filter. Use collection selection,
   ref labels, metadata, changed-file list, and the shared diff viewer. Add copy-ID and parent
   navigation actions. Keep historical files read-only and link WIP to Changes.
6. Cancel stale reads on route/filter/Node changes, preserve valid selection across refreshes,
   and render named states for no commits, no matches, failed reads, and bounded omissions.

## Acceptance

- Temporary repositories prove roots, two-parent merges, ref movement during paging, hash search,
  author/message filtering, detached/unborn HEAD, renames, deletion, modes, binary data, and unusual
  filenames. Verify relationship behavior at a page boundary and after filtering.
- Client tests prove a revision selection requests only its topology and visible diff segments,
  then discards a late response after a Node or selection change.
- Desktop shows compact connected history without plugin SVG/DOM; terminal exposes the same
  parents, refs, selections, and keyboard actions at 80×24 and 120×40.
- Measure the [large-repository checks](./README.md#verification-strategy) and run affected package,
  consumer, facade, and architecture gates. Record results before phase 03.

## Verify before building

- Recheck the diff source port, root/merge semantics, and supported Git log formats.
- Confirm the kit component admission and terminal support rules before adding history geometry.
