# Phase 21: read the changelog from GitHub releases

Date: October 15, 2026. Status: proposed. After launch, and after the first tagged release.

## Goal

Publishing a release on GitHub updates `/changelog/` on the next build, with nothing copied by hand.
The hand-written data file from phase 10 becomes a small set of overrides on top of the releases, not
the source.

## Starting point

- Phase 10's `apps/site/src/data/changelog.ts` (new in phase 10) holds the entries by hand.
- Phase 10's GitHub client already reads the releases API at build, with a committed fallback.
- `docs/release-notes.md` is the internal record of changes that matter to plugin authors.
- `references/hunk/scripts/generate/generate-changelog.ts` projects a changelog into committed pages,
  keeps release dates in a committed file so a date never changes once recorded, and merges a
  hand-written overlay of headlines. `references/hunk/website/releases/` holds those files.
- acorn's history is mostly direct commits to `main`, not pull requests, so GitHub's generated release
  notes, which list merged pull requests, would say little.

## Decisions to make first

1. **Where a release's notes are written.** Recommendation: in the GitHub release body, as Markdown with
   **Added**, **Changed**, **Fixed**, and **Removed** sections. The site parses that. A release
   operator writes it with help from step 2 below.
2. **What happens to `docs/release-notes.md`.** Recommendation: it keeps the plugin author notes for the
   build on `main`. When a release is cut, its plugin notes go into the release body under **Plugin
   authors**, and the internal page starts its next list.

Record both answers in this file before building.

## Changes

1. Add `apps/site/scripts/draft-release-notes.mjs` (new). Given two tags, it lists the commit subjects
   between them, grouped by the folder each commit touched most, such as a plugin or a client, as a draft
   for the release operator to edit. It never publishes anything.
2. Parse release bodies at build into the changelog entry type from phase 10. A release whose body
   doesn't parse still shows, with its body as plain Markdown and a warning in the build log.
3. Merge the hand-written data from phase 10 on top, keyed by version, for a headline or a summary the
   release body doesn't have. Entries from before the first release stay in that file as they are.
4. Add a page per release at `/changelog/<version>/`, and keep the list page. Give each release page a
   social card using phase 19's template.
5. Keep every release's date in `apps/site/src/data/release-dates.json` (new) once recorded, so a
   re-edited release can't move in the list.
6. The RSS feed reads the merged list.

## Acceptance

- Publishing a test release on a fork, then building, shows it on `/changelog/` with its sections and
  its own page.
- An offline build uses the committed fallback and still lists every release.
- The draft script produces a usable first draft for the gap between two real tags.
