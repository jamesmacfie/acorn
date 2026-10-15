# Phase 10: build the download page, the changelog, and the star count

Date: October 15, 2026. Status: done. Needs phase 6.

## Completion note

October 16, 2026. `/download/` and `/changelog/` are written and built. The changelog has an RSS feed
at `/changelog/rss.xml`. The header and the footer show **Star on GitHub**. A build reads the star count
and the newest release from GitHub, and falls back to a committed copy.
[Releases and the changelog](../../site/releases.md) is the reference.

What landed:

- `apps/site/src/lib/github.ts` asks GitHub for the repository and its releases, using
  `GITHUB_TOKEN` when it's set. Every page shares one answer. When GitHub doesn't answer, or
  `SITE_OFFLINE=1` is set, the build uses `apps/site/src/data/github.json` and prints a warning.
  `pnpm --filter @acorn/site github:refresh` rewrites the copy. On October 16, 2026, it holds 6 stars
  and no release.
- `apps/site/src/lib/releaseAssets.ts` holds the file name patterns, and `releaseFixtures.ts` holds
  three releases: none, macOS only, and every platform. `releaseAssets.test.ts` runs under `node --test`
  in the site's `test` script.
- The download page is a layout, `apps/site/src/layouts/DownloadPage.astro`, so `/lab/download/<fixture>/`
  can draw it with each fixture release. `src/scripts/platform.ts` moves the visitor's platform first.
- `apps/site/src/data/changelog.ts` holds three entries, checked by Zod when the site builds. The
  changelog page and the feed endpoint both read it.
- `GitHubStars.astro` shows its count from `SHOW_COUNT_FROM = 100`, formatted like `1.2k`. The design
  gallery shows it at 99, 100, and 1,234 stars.
- `site.yml` rebuilds and deploys production once a day and on each published release. It always
  builds `main`, and it passes the workflow's token to the build.
- `docs/site/releases.md` is new. `docs/site.md` and `docs/site/design.md` point to it and list the new
  components.

The acceptance checks: the release asset test passes for all three fixtures. On a preview build,
Playwright checks the no-release fixture, the every-platform fixture, the Linux order, and the star
count at 99 and 100. A preview build passes all 256 Playwright tests. A production build passes its
38, with 24 skipped because they need lab pages. `SITE_OFFLINE=1` builds. The W3C feed validator
calls the feed valid, with one warning that the self link doesn't match, which only happens because
the feed was pasted in rather than fetched from `acorn.sh`. axe finds nothing serious on `/download/`,
`/changelog/`, or the every-platform fixture. The budget check passes. The download page's HTML is
4.1 KB compressed, with 2.4 KB of script, and the changelog's HTML is 3.9 KB. Neither page scrolls
sideways at 375 pixels.

### Decisions

- **Newest first, one entry per day.** An entry's anchor is its date, so the schema refuses entries out
  of order or on the same day. Phase 21 replaces the file, so a separate ID field isn't worth having.
- **The seed entries are merged by day.** October 12 holds both plugin API removals. October 2 holds
  the memory library, the import, and the move to Markdown files. Release notes give the `acorn-1`
  baseline no date, so its entry uses September 24, 2026, the date of commit `b147a5d35`, which
  established it.
- **With no release, sections 2 and 3 also give the from-checkout steps** under the no-release line:
  build the command line and the terminal client, and `pnpm pack:node`. Owner decision 7 offers
  building from source and the tarball first, and phase 8 asked for the tarball's origin.
- **The notarization steps show for every release**, behind a `shortcut:` comment. The API can't say
  whether a build is notarized, and the desktop build is signed ad hoc.
- **The steps for opening the app cover two macOS versions.** `docs/shell/packaging.md` says to use
  Gatekeeper's right-click **Open**. macOS 15 removed that, so the page also gives **Open Anyway** in
  System Settings. Whoever owns `packaging.md` should update that line.
- **The newest release counts prereleases**, as this file asks: it's the newest one that isn't a draft.
- **The star button reads Star on GitHub**, not phase 6's **Star**. Between 50rem and 72rem it shrinks
  to its icon and the count, as phase 6's button did.
- **The footer shows the newest release's tag**, or nothing when there's none. The source version is
  gone, along with its `shortcut:` comment.
- **The primary action on the landing page and the feature pages reads Download once a release
  exists**, and **Get acorn** until then. Both `shortcut:` comments are gone.

### Deviations

- **The changelog's `sources` sit on the page's `meta`, not in the data file.** `stale.mjs` reads
  docs pages, marketing pages, and snapshots, so a citation in the data file would never reach the
  report. `/changelog/` cites `docs/release-notes.md`, which flags the same change.
- **The star count tests are Playwright tests on the design gallery**, not unit tests. The count lives
  in an Astro component, and the site has no runner for components outside a build.
- **The tarball commands were wrong.** `scripts/pack-node.mjs` writes `acorn-node-<version>.tar.gz`, which
  unpacks into `acorn-node/`. `apps/site/src/install.ts` and `docs/node-distribution.md` said
  `acorn-node-*.tgz` and `cd acorn-node-*`. Both are fixed, so the landing page's standalone tab changed
  too.
- **The install block's commands are focusable**, so a keyboard can scroll a command wider than the
  block. axe flagged it on the download page.
- **The changelog isn't in the link check.** Its only internal link is the feed, which isn't a page,
  and the feed test covers it.

### What later phases need to know

- Phase 20: confirm that the daily and release runs of `site.yml` build `main` and deploy. They need
  the Cloudflare secrets, and nothing has run.
- Phase 20: refresh `apps/site/src/data/github.json` before launch.
- Phase 21: `apps/site/src/data/changelog.ts` is the file to replace. The page and the feed read only
  `changelog`, `textToHtml`, and `escapeHtml` from it.
- Phases 11 and 14: the download page links to `/docs/nodes/run-a-standalone-node/` and
  `/docs/browser-extension/set-up-the-extension/`, both drafts on this commit. The link test covers
  `/download/` on preview builds only.
- When the bundle plan settles release file names, update the patterns in `releaseAssets.ts` and the
  fixtures in `releaseFixtures.ts` together.
- In `.astro` markup, a line break right before an inline tag such as `<code>` or `<b>` drops the space
  before it. Break the line between two words instead.
- The architecture checks fail on this base as earlier phases recorded, and the format check still fails
  on `packages/protocol/src/plugin/handoffs.ts` and `apps/site/src/features.ts`. None of the failures
  come from this change.

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
release, so the star count and the download links stay current. Put it in `.github/workflows/site.yml`
beside the existing deploy job. It can't run until the Cloudflare secrets exist, so writing it is the
whole job here. Phase 20 confirms it runs.

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
**Star on GitHub**, and shows the count formatted as `1.2k` only when the repository has 100 stars or
more ([owner decision 4](./README.md#what-the-owner-decides)). Keep the 100 as a named constant in the
component. It's a plain link with no script and no request from
the visitor's browser.

## Out of scope

Signing, notarization, building release assets, and an update feed. Those belong to the bundle plan.

## Acceptance

- The release-asset test passes for all three fixtures.
- The download page shows the honest no-release state today, and shows platform links when a fixture
  release is swapped in.
- `SITE_OFFLINE=1 pnpm --filter @acorn/site build` succeeds using the committed GitHub data.
- The changelog page lists the seeded entries, and the RSS feed validates with the W3C feed validator.
- The scheduled rebuild is written in `site.yml`. Confirming it runs and deploys is left for phase 20.
- `<GitHubStars />` hides the count at 99 stars and shows it at 100, with a test for each.
- The download page passes the budget and axe.
