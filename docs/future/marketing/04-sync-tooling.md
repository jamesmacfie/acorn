# Phase 4: make drift visible

Date: October 15, 2026. Status: proposed. Needs phase 2. Do it before the docs phases start.

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
