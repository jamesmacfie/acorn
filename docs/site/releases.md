# Releases and the changelog on the public site

This page covers what the public site reads from GitHub when it builds, how the download page sorts a
release's files, and the changelog's data file. [The public site](../site.md) covers running and
deploying it.

## What a build reads from GitHub

A build asks the GitHub API for the repository's star count and its newest release that isn't a draft
(`apps/site/src/lib/github.ts`). `.github/workflows/site.yml` rebuilds production once a day and on each
published release, so the count and the links stay current. The download page, the footer, the star button, and the landing and
feature pages' primary action read the answer. The visitor's browser asks GitHub for nothing. Set
`GITHUB_TOKEN` to lift GitHub's anonymous limit of 60 requests an hour.

When GitHub doesn't answer, the build uses the committed copy in `apps/site/src/data/github.json` and
prints a warning, so a build never fails because GitHub is down. `SITE_OFFLINE=1` uses the copy without
asking. Refresh the copy by hand now and then, and commit it:

```sh
pnpm --filter @acorn/site github:refresh
```

The download page sorts a release's files into downloads by name, with the patterns in
`apps/site/src/lib/releaseAssets.ts`. When release file names change, update those patterns and the
fixture releases in `releaseFixtures.ts` together. `/lab/download/none/`, `/lab/download/macos-only/`,
and `/lab/download/every-platform/` draw the page with each fixture.

## The changelog

`/changelog/` and its feed, `/changelog/rss.xml`, read `apps/site/src/data/changelog.ts`, a list of
entries written by hand, newest first. Each has a date, an optional version, a title, a summary, its
changes tagged added, changed, fixed, or removed, and an optional note for plugin authors. Text in
backticks shows as code. Zod checks the list when the site builds, so a malformed entry, or one out of
order, fails the build. Write an entry for a person using acorn, from `docs/release-notes.md`.

## Tests

`apps/site/src/lib/releaseAssets.test.ts` sorts the three fixture releases. On a preview build, the
Playwright tests check the download page with each fixture, the order it shows a Linux visitor, and the
star button in the design gallery at 99 and 100 stars. On either build, they check that the feed has an
item for every changelog entry.
