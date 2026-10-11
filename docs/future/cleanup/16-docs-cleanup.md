# 16: Docs cleanup

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
