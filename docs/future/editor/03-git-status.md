# Phase 03: show Git status beside files

> **Completion note — October 8, 2026.** Editor shows one Changes-owned Git status
> snapshot per task in file rows, folder counts, and open tabs. The public
> `editor:file-status` Node point returns only paths, status, scope, and rename source.
> Changes reuses its porcelain parser and the shared worktree status cache; Editor
> groups distinct paths and gives conflicts priority. A Solid memo projects each
> snapshot once. File actions and successful saves refresh it directly, alongside
> worktree events, reconnects, and focus. Plugin roster changes clear marks before
> rereading. A missing provider or non-Git folder has no marks; transient failures
> retain the last snapshot with a stale explanation. Node, task, provider, and read
> revisions fence late results. Disk revision reads still decide whether a deleted
> document can save.
>
> **Decisions and limits.** A deleted open tab can show `D`; the tree does not add
> an absent file row. The status-only read runs no numstats, patches, or per-file
> Git commands. Worktree status reads use canonical checkout paths so aliases share
> one cache entry, and invalidation drops a pending entry. The kit owns tab badge
> styling; Editor owns Git grouping. The proposed `editor:file` annotation point
> has not shipped, so this phase keeps its narrow status point. The terminal's
> three-column 120×40 layout clips long inline tree status explanations, while
> retaining the letter, folder count, and file controls. The active document tab
> prints its full status text. Provider disablement through Settings takes effect
> after a Node restart, as Settings states; the reader also handles a live roster
> change immediately. Later UI work can give a focused tree row a wider detail
> line without changing the Git provider contract. The Node service build is
> 3,149,676 bytes against a 3,150,000-byte ceiling; later phases should keep
> optional work lazy rather than adding it to service startup.
>
> **Verification.** Temporary Git repositories covered staged addition, both
> modification scopes, untracked files, rename source, deletion, unresolved
> conflict, and a non-Git folder. Reader and route tests covered transient failure,
> provider retirement, late responses, and Node switches. Two readers of 10,000
> untracked files used one status subprocess in 73 ms; 500 map lookups took 4 ms
> without reprojection. The 10,000-row virtual tree stayed under 100 mounted rows;
> the shared Rows scroller stayed under 40 after a scroll. The isolated desktop
> fixture showed file and folder marks and an open tab in light and dark captures
> (`.acorn/agent-dev/phase03-status-desktop/screenshots/editor-light-open.png` and
> `editor-dark-open.png`). After Changes was disabled and the isolated Node
> restarted, Editor still listed files with no Git marks. Live terminal snapshots
> at 80×24 and 120×40 showed counts and file letters; at 80×24 the modified row
> showed its full unstaged label. The terminal host tab contract has a separate
> status-and-dirty-dot test. Editor passed 152 tests (1 skipped), Changes 271
> (1 skipped), Node core 1,636, plugin API 14, protocol 294, and TUI 679
> (2 skipped). Lint passed 37 tasks and architecture passed 87 tests. Client core
> had 2,467 passes and the two failures previously reproduced on untouched
> `bf1143d08` (workspace route classification and CSS shadow-token count).
> Desktop had 171 passes and the 11 activation snapshot failures previously
> reproduced on that untouched parent. Those are parent-commit checks, not a
> claim about main. No unfiltered repository suite ran in this phase.

Date: October 7, 2026. Status: proposed product requirements; implementation not started.
Source baseline: `47f7431e72c9f239736ce63fb6774aed4f61180c`.
Dependency: [phase 02](./02-file-management.md).

This PRD adds Git status to Editor's file tree and open tabs, with folder summaries and batched reads.
Implement status through the Changes owner while keeping Editor usable when that provider is absent.

## Problem and outcome

The tree lists names and directories without Git metadata. Acorn draws line provenance in open text,
but a person cannot identify changed files before opening them. Files with uncommitted edits and
conflicts must be recognizable in the tree and tab strip without opening Changes.

## Starting points and owners

Inspect these files and their tests:

- `plugins/editor/src/client/FileTree.tsx` and `EditorPane.tsx` own tree rows and document tabs.
- `plugins/editor/src/contract/lineMarkers.ts` and `plugins/editor/src/node/index.ts` demonstrate an
  optional provider contract. File status must not be added to the line-range contract.
- `plugins/changes/src/server/localDiff.ts`, `shared/api.ts`, and `client/ChangesPane.tsx` own status
  production and display. Reuse parsing/status semantics without importing the client pane model.
- `packages/protocol/src/projects/localGit.ts` defines staged and unstaged file statuses.
- `packages/client-core/src/kit/components/layout/TreeRow.tsx` and `DocumentTabs.tsx` own row/tab presentation.

Read [line markers](../../editor/line-markers.md), [Changes](../../diff-rendering/changes-pane.md),
[plugin boundaries](../../architecture/packages.md), and
[planned annotations](../ui-extension/07-file-annotations.md).

## Required presentation

Use existing appearance tokens for subtle filename tint and a small badge. Tooltips and accessible
labels name the status; color alone is insufficient. Keep the dirty-buffer dot separate from disk status.
Preview italics, selection, close buttons, focus, and menu hit targets remain readable.

| Status | File indication |
| --- | --- |
| Modified | Modified tone and `M` badge |
| Added | Added tone and `A` badge |
| Untracked | Added tone and `?` badge |
| Renamed | Renamed tone and `R` badge; tooltip includes the old path |
| Conflicted | Danger tone and `!` badge |
| Clean | Ordinary filename; no badge |

Name staging state in the tooltip: **Staged**, **Unstaged**, or **Staged and unstaged**. Aggregate two
entries for the same path into one indication. Conflict takes precedence, followed by renamed, added,
and modified. Use the shared Git owner vocabulary where its semantics require a different mapping;
document the resulting table instead of inventing a second parser.

A folder indicates changed descendants, including deleted paths absent from the filesystem tree.
Its tooltip gives counts of distinct changed paths and conflicts; a path changed in both scopes counts
once. A conflict dominates the folder color. Folder badges are summaries, not file status letters.
No phantom deleted-file row is required. Deleted files remain inspectable through Changes.

Open deleted documents from phase 01 keep their **Deleted on disk** state. Git deletion and external
disk deletion need not be identical, so do not use Git status to determine whether a buffer can save.
The terminal draws the same letters and accessible status text; decorative color is optional.

## Provider and refresh contract

Changes supplies a narrow read-only status projection through a declared Node capability or extension
point. Editor serves that projection on its own task-addressed route. The provider owns Git execution,
staging semantics, and shared status cache. Editor owns grouping for its display and stale-response checks.

Keep full-diff bodies and line-count computation out of the status-only path. Reuse the coalesced
worktree status read rather than requesting Changes' complete diff model. If a narrow public read is
missing, add it beside its owner. Do not deep-import private server logic across plugin packages.

Fetch one task status snapshot for the owner, then project it onto visible rows and open tabs.
Compute folder aggregates from paths in that snapshot; do not scan directories or spawn Git per row.
Deduplicate shared reads for aliases of one checkout and coalesce worktree invalidations.

Refresh after save/create/rename/trash, worktree events, reconnect, and window focus. Retain a useful
last snapshot on a transient error with a stale-state explanation. A missing/disabled provider clears
its marks, and a non-Git checkout is an ordinary tree. A stale snapshot cannot cross Node/task identity.
Status loading never blocks listing, opening, or editing text.

If `editor:file` annotations from the separate UI extension programme have shipped, reuse that
delivery for file marks where it preserves Git semantics. Folder summaries remain owner behavior:
that proposed annotation key excludes directories. Keep external annotations, disk provenance bars,
and the editor's dirty indicator distinguishable. Do not ship a second generic annotation framework.

## Boundaries and implementation order

Exclude staging, discard, commit, pull, Git history, inline blame, and hunk controls. Those remain
Changes/Git responsibilities. Ignored-file visibility belongs to phase 06.

Implement the narrow provider and grouping with realistic Git fixtures, then tree/tab presentation,
then invalidation and provider lifecycle. Update the editor-pane and Changes/plugin contract docs
with the shipped status vocabulary and cache ownership.

## Acceptance and verification

Prove these behaviors in temporary Git repositories:

- Modified, staged addition, untracked, rename, deletion, and unresolved conflict receive distinct marks.
  A file modified in both staging scopes produces one row badge with accurate tooltip text.
- Parent folders summarize nested changes, including deletions, without expanding or loading children.
  Counts deduplicate paths, and conflict priority is deterministic.
- Typing changes the unsaved dot without falsely asserting disk status. Save updates status; commit
  clears marks; rename/trash refresh folder summaries and tabs.
- Non-Git checkouts, Changes disabled/unloaded, provider failure, late responses, and Node switches
  retain the specified usable tree and fail independently of line markers.
- A large fixture with 10,000 entries produces bounded task-level status calls. Report subprocess
  count, status latency, and scroll behavior; expanding rows does not produce one call per file.
- Desktop light/dark appearances and terminal 80-by-24/120-by-40 displays preserve selection, menu
  controls, long names, status labels, and file accessibility.

Run `pnpm lint`, full suites for `@acorn/plugin-editor`, `@acorn/plugin-changes`,
`@acorn/client-core`, `@acorn/node-core`, `@acorn/plugin-api`, `@acorn/tui`, touched contracts,
and their consumers. Run `pnpm --filter @acorn/arch-tests test`.
Verify status and provider disablement with the [isolated drivers](../../local-development/agent-drivers.md).
Record screenshots, terminal snapshots, fixture counts, and measured status calls.

## Verify before building

- Recheck Git status parsing, optional provider lifetimes, cache sharing, and aliases.
- Confirm status-only reads do not compute per-file patches or cross private plugin boundaries.
- Inspect row/tab slots, role tokens, and whether the annotation programme has shipped.
- Preserve phase 01's disk identity checks and phase 02's captured menu targets when marks refresh.
