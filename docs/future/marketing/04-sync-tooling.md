# Phase 4: make drift visible

Date: October 15, 2026. Status: done. Needs phase 2. Do it before the docs phases start.

## Completion note

October 15, 2026. `pnpm --filter @acorn/site stale` lists every page whose sources changed since its
`checked` commit, `--touching <paths…>` lists the pages that cite given files, and `--mark <page>`
clears a page. [Keep pages in sync](../../site.md#keep-pages-in-sync) is the reference.

What landed:

- `apps/site/scripts/stale.mjs`. It reads docs frontmatter, each marketing page's `meta` export, and
  shell snapshots, then runs one `git log` per page. A full report over 183 pages takes about 6 seconds.
  `--json` works with both reports, and both exit 0.
- `apps/site/scripts/stale.test.mjs`, run by `node --test` in the site's `test` script. It fails when a
  page cites a path that doesn't exist, cites nothing, or has a `checked` commit that isn't in the
  history of `HEAD`. It also covers both header formats, the snapshot commit format, and folder matching
  in `--touching`.
- The `site` job in `site.yml` checks out full history and writes both reports to the job summary. The
  step runs before the other checks and can't fail the job.
- A "When the public site cites your doc" section in `docs/writing-docs.md`, a line in `AGENTS.md`
  pointing to it, and a "Keep pages in sync" section in `docs/site.md`.

Decisions:

- The script reads `sources` and `checked` with a few regular expressions, not a YAML parser. The site
  doesn't depend on one, and both header shapes are simple. The test fails on a page that yields no
  sources, so a parsing miss can't hide a page.
- `--touching` matches a changed file against a source that names it, or a folder that holds it.
- `--mark` takes a page's file or its URL, and writes `git rev-parse --short HEAD`.
- The test checks that `checked` is an ancestor of `HEAD`, not just a commit that exists. `main` takes
  branches as merge commits, so a hash marked on a branch stays in its history. A squash or rebase
  merge would orphan it, and the test would catch that.
- CI calls `node apps/site/scripts/stale.mjs` directly, so pnpm's banner stays out of the summary. On a
  pull request, `--touching` gets `git diff --name-only <base>...HEAD`.
- Snapshots: phase 7 hasn't run, so this phase sets their format. A `.html` snapshot names its commit near
  the top as `<!-- commit 3f9a2c1, captured 2026-10-20 -->`. A `.cells.json` snapshot has a top-level
  `"commit"` field. Their sources are in `SNAPSHOT_SOURCES` in `stale.mjs`: the desktop shell's chrome,
  layouts, and stylesheets for HTML, and the terminal client's chrome and paint folders for cells.
  `--mark` refuses a snapshot, because recapturing it clears it.

The acceptance checks pass locally. `--touching docs/database.md` lists the Database plugin page and
`/features/task-tools/`. `--mark` clears a listed page, and a planted missing source or unknown commit
fails the test. The job summary on a real pull request is unchecked, which is left for phase 20.

What later phases need to know:

- The report lists two pages on this commit: `/404/` cites `docs/site.md`, which phases 2 to 4 edited,
  and `/docs/help/faq/` cites `voice.md`, which phase 1 edited. Both stay listed. Whoever writes those
  pages clears them with `--mark`.
- When you write a page, narrow its `sources` to the docs that own its claims, then run `--mark` on it.
- Phase 7 must write the snapshot commit in the format above, or the test fails on the snapshot.
- Phase 20 can use `pnpm --filter @acorn/site stale` as the release check. An empty report prints
  "No page's sources changed since it was checked."
- The architecture doc checks still fail on this base exactly as phase 2 recorded. None of the failures
  come from this change.

## Goal

Every written page names the internal docs and source files it explains, and one command lists the
pages whose sources changed since someone last checked them. Contributors, human or agent, see the
pages their change affects before they merge. [Keeping the site in sync](./sync.md) explains why.

## Starting point

- Phase 2's frontmatter schema already requires `sources` and `checked` on docs pages, and the marketing
  pages carry the same fields in a `meta` export.
- [The site map](./site-map.md) lists each docs page's starting sources.
- `tools/arch/docPaths.test.ts` is the model for checking that cited paths exist.
- CI checks out the repository shallowly by default, so `git log` across history needs the full
  history in the `site` job.

## Changes

1. Add `apps/site/scripts/stale.mjs` (new), run as `pnpm --filter @acorn/site stale`. For every page,
   it reads `sources` and `checked`, runs `git log --format='%h %s' <checked>..HEAD -- <sources>`, and
   prints each page with commits in that range, newest first. `--json` prints the same data for tools.
   Exit code 0 either way.
2. Add `--touching <paths…>`. Given a list of changed files, it prints the pages that cite any of them.
   CI passes the pull request's changed files, so the summary names the public pages a change affects
   even when `checked` is current.
3. Add `--mark <page>`, which sets that page's `checked` to the current commit. It's the one supported
   way to clear a page, so nobody hand-types a hash.
4. Add a test that fails when a `sources` path doesn't exist, or when `checked` names a commit that
   isn't in the history.
5. In the `site` CI job, fetch full history and write both reports to the job summary. They don't fail
   the build.
6. Treat shell snapshots as pages. Each snapshot from [phase 7](./07-shell-snapshots.md) records the
   commit it was captured at, and its sources are the shell's folders and the stylesheets. The report
   lists old snapshots the same way it lists pages.
7. Add a section to [Write and maintain docs](../../writing-docs.md) called "When the public site cites
   your doc": run `pnpm --filter @acorn/site stale --touching` with your changed files, then update each
   page it lists or say in the pull request why it doesn't need it. Add one line to `AGENTS.md` that
   points to that section.

## Out of scope

Failing the build on stale pages. A source edit that changes no behavior shouldn't block a merge.
[Phase 20](./20-launch.md) makes an empty report part of the release checklist instead.

## Acceptance

- Edit a doc that a stub page cites, commit, and run the report: the page appears with that commit.
  Run `--mark` on it, and it disappears.
- `--touching docs/database.md` lists the Database plugin page and the task tools feature page.
- A page that cites a missing file fails the test.
- The job summary on a pull request shows both reports.

## Risks

A report nobody reads is noise. Keep the output short: the page, its URL, and one line per commit. If it
regularly lists more than ten pages, the sources lists are too broad. Narrow them to the topic pages
that own each claim.
