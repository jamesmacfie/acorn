# Phase 02: history and diffs

Date: October 7, 2026. Status: planned; implementation not started.
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
