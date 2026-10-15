# Phase 10: build the download page, the changelog, and the star count

Date: October 15, 2026. Status: proposed. Needs phase 6.

## Goal

`/download/` offers every way to get acorn, read from GitHub releases at build time, and says plainly
when no signed build exists. `/changelog/` lists what changed, from a hand-written data file, with an
RSS feed. The site shows the GitHub star button and count, fetched at build time. Nothing on these pages
asks a third party for anything in the visitor's browser.

## Starting point

- The repository is `jamesmacfie/acorn`, public, with no tagged release on October 15, 2026.
- `docs/release-notes.md` says the macOS disk image, the Windows installer, and the standalone tarball
  build, the desktop build is ad-hoc signed, and notarization is a release operator task.
  [The bundle plan](../bundle.md) owns signing and release delivery.
- `pnpm pack:node` builds the standalone Node tarball (`scripts/pack-node.mjs`). Its install steps are in
  `docs/node-distribution.md`.
- The browser extension's development builds and native bridge install steps are in
  `docs/browser-extension/setup.md`. The extension isn't in a browser store.
- `docs/release-notes.md` holds the changes worth telling plugin authors about, dated.
- `references/t3code/apps/marketing/src/lib/releases.ts` reads the GitHub releases API for its download
  page. `references/hunk/scripts/generate/generate-changelog.ts` shows a changelog that keeps dates in
  a committed file so the build needs neither Git nor the network.

## Changes

### 1. Read GitHub at build time

Add `apps/site/src/lib/github.ts` (new). At build, it asks the GitHub API for the repository and its
releases, with `GITHUB_TOKEN` in CI so the rate limit isn't a problem. It returns the star count and the
newest non-draft release with its assets.

When the request fails, it falls back to `apps/site/src/data/github.json` (new), a committed copy of the
last answer. `pnpm --filter @acorn/site github:refresh` rewrites it. The copy only matters when the API
is down or the build is offline, so refreshing it by hand from time to time is enough, and nothing commits it
automatically. A build never fails because GitHub is down.

Add a scheduled workflow that rebuilds and deploys production once a day, and on every published
release, so the star count and the download links stay current.

### 2. Match assets to platforms

Add `apps/site/src/lib/releaseAssets.ts` (new), which sorts a release's assets into platforms by name:
macOS by architecture, Windows, the standalone Node tarball, and checksums. Keep the name patterns in
one table in that file, beside a test with three fixture releases: none, macOS only, and every
platform. When [the bundle plan](../bundle.md) settles asset names, update the table and the fixtures
together.

### 3. Build the download page

The page has a section per way of getting acorn, in this order:

1. **Desktop app**: macOS and Windows, with the system requirements and the first run. If the release
   isn't notarized, say how to open it on macOS, and say why.
2. **Terminal client and command line**: how to get `acorn` on your `PATH`, from the desktop app or
   the standalone tarball, whichever the release provides.
3. **Standalone Node**: the tarball, with the steps from `docs/node-distribution.md`.
4. **Browser extension**: the steps from `docs/browser-extension/setup.md`.
5. **Build from source**: the steps from the root `README.md`.

With no release, sections 1 to 3 say "acorn has no signed release. Build from source, or watch the
repository for the first release," with a link to the releases page, and the build-from-source section
moves to the top. That's honest, and it's the state on the day this plan was written.

A small script reorders the sections so the visitor's platform comes first, using
`navigator.userAgentData` where the browser has it. With scripting off, the page shows every section in
the default order.

### 4. Write the changelog data

Add `apps/site/src/data/changelog.ts` (new): a typed array, newest first. Each entry has a date, an
optional version, a title, a one-paragraph summary, a list of changes tagged as added, changed, fixed,
or removed, and an optional plugin API note. Validate it with Zod at build, so a malformed entry fails
the build.

Seed it from `docs/release-notes.md`: the October 12, 2026 removals, the memory library and import, and
the `acorn-1` baseline. Rewrite each for a person using acorn, not a person maintaining it, and keep the
plugin API notes as a callout for plugin authors. Give the data file `sources` that cite
`docs/release-notes.md`, so phase 4's report flags it when the internal notes change.

This is the hand-written first version the owner asked for. [Phase 21](./21-changelog-from-github.md)
reads GitHub releases instead, after launch.

### 5. Build the changelog page and feed

`/changelog/` lists every entry, newest first, with an anchor per entry and a **Plugin authors** callout
where an entry changes the plugin API. `/changelog/rss.xml` is an Astro endpoint that writes the feed by
hand. It's about 20 lines and needs no dependency.

### 6. Draw the star button

Add a `<GitHubStars />` component for the header and the footer. It links to the repository, says
**Star on GitHub**, and shows the count formatted as `1.2k` above the threshold the owner sets in
[decision 4](./README.md#what-the-owner-decides). It's a plain link with no script and no request from
the visitor's browser.

## Out of scope

Signing, notarization, building release assets, and an update feed. Those belong to the bundle plan.

## Acceptance

- The release-asset test passes for all three fixtures.
- The download page shows the honest no-release state today, and shows platform links when a fixture
  release is swapped in.
- `SITE_OFFLINE=1 pnpm --filter @acorn/site build` succeeds using the committed GitHub data.
- The changelog page lists the seeded entries, and the RSS feed validates with the W3C feed validator.
- The scheduled rebuild runs and deploys.
- The download page passes the budget and axe.
