# 16: Docs cleanup

> **Completion note, October 12, 2026.** `pnpm --filter @acorn/arch-tests test` passes, and the
> anchor scan finds no `<a id>` anchors left in the docs. `oxlint` and the format check pass on the
> changed source files, whose changes are comments only. The full suite wasn't run.
>
> What landed:
>
> - `docs/future/ui-extension/` and `docs/future/git-client/` keep only a `README.md`, each a short
>   checklist of open acceptance. The phase files, the design page, and both refused-alternatives
>   pages are deleted. UI extensions keep five open checks, the same ones the dated acceptance record
>   lists. The Git client keeps two terminal checks from the phase 07 evidence: the terminal Changes
>   pane read "No changes" during a conflict, and the terminal refusal-and-retry flow wasn't driven.
> - The four implemented single-file plans and `docs/loaded-plugin-migration.md` are deleted. Two
>   open items moved to their owners. The Agent pane not showing a workflow session's goal is now a
>   sentence in `docs/workflows/agent-steps.md`. The open both-host acceptance for the workflow tools
>   is in `docs/future/workflows-gaps.md`. `docs/future/README.md` lists each removed plan with its
>   reference owner.
> - `docs/README.md` loses the Editor, UI extension, and Git client handoff sections. The Subfolders
>   list links `docs/future/README.md` and the two remaining checklists. The Editor completion records
>   row moved to the testing table.
> - `changes` is gone from the compiled plugin lists in `docs/architecture-overview.md` and
>   `docs/first-party-plugins.md`, and from `docs/api-reference.md`, `docs/plugins/data-ownership.md`,
>   and a plugin routes heading. The Git row in the first-party table takes over the Changes tab.
> - All 586 anchors are gone, including the 42 that something still targeted. Those links and 15
>   source citations now name the topic page that owns the section, and nothing needed an anchor
>   after that. `docs/writing-docs.md` step 4 says to update links, and step 5 allows an anchor only
>   for a link in the repository that can't be updated.
>
> Decisions and deviations:
>
> - The deferred dynamic App hook from the UI extension refused page moved into
>   `docs/future/dynamic-ui/README.md`, since that programme owns any later App work. The other
>   refusals are in the reference pages' limits or in git history.
> - Phase 15 flagged `docs/plugin-authoring/the-manifest.md` as saying API major 3. Commit
>   `4b44479d0` already set it to 5. This phase set `events-and-capabilities.md` to 5 as well, and
>   added the browser rules removal to `docs/plugins/publishing.md` and `docs/release-notes.md`. No
>   other doc describes browser rules.
> - A handful of paragraphs that a link rewrite pushed past 100 columns were rewrapped. Nothing else
>   was restyled.
>
> For later phases: a heading rename or a page split should update the links and citations that
> name it. A new `<a id>` needs a link in the repository that can't change.

This proposal retires plans for work that has shipped, fixes reference text that has gone stale, and
removes redirect anchors that nothing points at.

Date: October 11, 2026. Status: proposed. Depends on: [01: green the gate](./01-green-the-gate.md),
which fixes the 15 dead links. Part of the [cleanup programme](./README.md).

## Problem

The docs run to about 55,700 lines in 475 Markdown files. `docs/future/` alone is about 15,200 lines
in 110 files, and much of it describes work that has shipped:

- The `ui-extension/` programme: all 15 phases done by October 10, 2026, with some acceptance open.
- The `git-client/` programme: phases 01 to 08 implemented by October 11, 2026.
- The single files `lazy-plugin-code.md`, `task-deletion.md`, `workflow-agent-goals.md`, and
  `workflow-agent-tools.md`, each marked implemented in `docs/future/README.md`.

`docs/writing-docs.md` says shipped behavior belongs in an owning reference page, and
`docs/README.md` repeats the rule for `docs/future/`. Even so, `docs/README.md` carries sections for
the Editor acceptance handoff, the UI extension programme records, and the Git client handoff. The
Editor section links into the deleted `docs/future/editor/` folder, which is where several of the
15 dead links come from. A shipped plan beside its reference page gives a reader two descriptions,
and the plan stops being updated.

Reference pages have gone stale too. `docs/architecture-overview.md` lists `changes` among the
compiled plugins, but Changes became part of the Git plugin on October 11, 2026.
[09: remove the preview tunnel](./09-remove-preview-tunnel.md) and
[10: pre-baseline compatibility](./10-pre-baseline-compatibility.md) each update the pages their
deletions affect.

Page splits leave `<a id>` anchors on landing pages, so old section links still land, as
`docs/writing-docs.md` instructs. 585 such anchors sit in 46 files. No link or source citation in
the repository targets 553 of them. `docs/plugins.md` alone carries 57 unused anchors,
`docs/ui-design.md` 36, and `docs/plugin-authoring.md` and `docs/telemetry.md` 31 each.

`docs/loaded-plugin-migration.md` is a page whose only content says it was deleted and where its
topics went.

## Goal

`docs/future/` holds only unshipped work and open acceptance. Every reference page matches the code.
Every anchor has a reason to exist.

## Requirements

1. For each shipped programme, move any open acceptance into one short checklist in the programme's
   `README.md`. Delete the phase files and the refused-alternatives pages. Git history keeps them.
   Delete the programme folder when its checklist is empty.
2. Delete the four implemented single-file plans and their rows in `docs/future/README.md`. Their
   reference pages already own the behavior.
3. In `docs/README.md`, replace the programme handoff sections with one link to
   `docs/future/README.md`. Keep a row for every doc, as `docs/writing-docs.md` requires.
4. Remove `changes` from the compiled plugin list in `docs/architecture-overview.md`, and grep the
   reference pages for other mentions of a separate Changes plugin.
5. Remove every `<a id>` anchor that no link or citation targets. Then change step 4 of "Split a long
   page" in `docs/writing-docs.md`: keep an anchor only when something in the repository still
   links to the old slug, and update those links instead where you can.
6. Delete `docs/loaded-plugin-migration.md` and its row in `docs/README.md`.
7. Leave dated evidence as written: `docs/testing/` records and `docs/security/review-*.md` pages.

## Out of scope

Source comments are [15: comment cleanup](./15-comment-cleanup.md). Rewriting reference pages for
style is not part of this proposal.

## Risks

Removing anchors breaks bookmarks and links from outside the repository, such as old chat transcripts
or issues. They land at the top of the right page instead of the right section.

## Acceptance

- `docs/future/README.md` lists no implemented plan without open acceptance.
- `pnpm --filter @acorn/arch-tests test` passes, including the doc path and citation checks.
- A rerun of the anchor scan reports no untargeted anchors.
