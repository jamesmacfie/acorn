# The public site

This page covers `apps/site`, the static site for `acorn.sh`: how to run it, build it, check it, deploy
it, and add a page. The site is Astro with Starlight. Marketing pages are hand-written Astro pages, and
the docs are a Starlight content collection served under `/docs/`.

## Run it

```sh
pnpm dev:site
```

The dev server runs at `http://localhost:4321`. It shows every draft page and the `/lab/` pages.

## Build it

The build writes the static site to `apps/site/dist`. There are two kinds of build:

| Build | Command | Drafts and `/lab/` |
| --- | --- | --- |
| Production | `pnpm --filter @acorn/site build` | Left out. |
| Preview | `ACORN_SITE_PREVIEW=1 pnpm --filter @acorn/site build` | Built. Each draft page carries a banner that says it isn't published. |

Starlight drops drafts from any production build, and fails on a sidebar entry whose page it can't
find. So `apps/site/astro.config.mjs` leaves draft pages out of the sidebar in a production build,
and `apps/site/src/content.config.ts` publishes drafts with a banner in a preview build.

Every build runs `starlight-links-validator`, so a broken link between pages fails the build. It can't
see marketing pages, so its `exclude` in `astro.config.mjs` lists those a docs page may link to.
A build reads GitHub too, and the changelog reads a data file: see [releases](./site/releases.md).

## Check it

| Command | What it checks |
| --- | --- |
| `pnpm --filter @acorn/site lint` | Builds the [plugin reference and component pages](./site/references.md), then `astro check`: types in the `.astro` pages, the content config, and the tests. Then `tsc` on the specimens, which use Solid's JSX. Root `pnpm lint` runs it too. |
| `pnpm --filter @acorn/site specimens` | Regenerates every [specimen](./site/specimens.md) on both hosts and fails when a committed file differs. |
| `pnpm --filter @acorn/site test` | The script tests, the tests in `src/lib/`, the manifest example check, the budget check, then the Playwright tests. Run a build first. |
| `pnpm --filter @acorn/site reference` | Rebuilds the generated reference and component pages. `dev`, `build`, and `lint` run it first. |
| `pnpm --filter @acorn/site og` | Redraws the [social cards](./site/agent-outputs.md). It checks nothing. |
| `pnpm --filter @acorn/site snapshots` | Recaptures the [shell snapshots](#shell-snapshots) from the running apps. It checks nothing, so nothing in CI runs it. |

The budget check, `apps/site/scripts/budget.mjs`, reads `dist`. For each page it adds up the Brotli-compressed
size of the HTML and of every stylesheet and script the page loads, following static imports between
scripts. Images and fonts don't count. A page fails when it goes over its budget, or when it loads
anything from another origin:

| Page | Budget |
| --- | --- |
| The landing page | 10 KB of JavaScript, 150 KB in total |
| Any other marketing page | 10 KB of JavaScript |
| A docs page, and the 404 page | 100 KB in total |

The Playwright tests in `apps/site/tests/` load every page the build wrote and fail on a console error.
They run axe on one page of each template, every feature page, the download page, and the changelog, and
check that drafts and `/lab/` appear only in a preview build. A preview build also checks that the
specimen gallery draws the site's header, sidebar, and text as `/docs/` does, runs axe around its
specimens and shell snapshots, and checks every link on the landing, feature, and download pages, because
most docs pages they link to are drafts. The tests use the installed Chrome. `ACORN_SITE_PREVIEW` must
match the build you're testing.

The landing page also has a Lighthouse target, checked by hand. [The landing page's Lighthouse scores](./site/design/lighthouse.md)
has the command and the scores.

## Specimens

Pictures of plugin UI and of the browser extension's panel are _specimens_, committed and checked on every
change ([specimens](./site/specimens.md)). Reference pages that list commands, shortcuts, files, variables,
and the plugin API read them from the code at build ([generated references](./site/references.md)). The
plugin guides show code and pictures from tested example plugins ([plugin guides](./site/plugin-guides.md)).
[Search and agent outputs](./site/agent-outputs.md) covers search, page metadata, social cards, the Markdown
copies, and `llms.txt`.

## Shell snapshots

Pictures of whole acorn windows are _shell snapshots_: HTML and terminal cells captured from the
running desktop app, terminal client, and browser extension on an invented fixture. Recapture them
after a change to the shell, to a pane a scene shows, or to the app's stylesheets. The staleness
report below lists snapshots older than their sources.

```sh
pnpm --filter @acorn/site snapshots              # every scene
pnpm --filter @acorn/site snapshots hero review  # the scenes you name
```

Recapturing every scene takes about a minute and a half once the desktop app, the Node, and the
terminal client are built. A first run builds them, which takes a few minutes more. The capture needs
a graphical session, Chrome, `openssl`, and PostgreSQL's `initdb`, `pg_ctl`, `createdb`, and `psql`
on `PATH`. It writes `apps/site/src/generated/snapshots/`. Look at the result on `/lab/snapshots/` in
`pnpm dev:site` before you commit it, in a light and a dark theme.

`apps/site/scripts/snapshotPrivacy.test.mjs` fails when a committed snapshot holds a home folder path,
an email address outside `example.com`, something shaped like a token, or a host outside
`example.com`, `localhost`, `127.0.0.1`, `github.com`, and `acorn.sh`. Fix the fixture or the capture,
never the test. [Shell snapshots](./site/snapshots.md) covers the fixture, the scenes, how the capture
works, and adding a scene.

## Design

The site is styled from acorn's own design tokens, fonts, and mark, in a light and a dark theme, and
each marketing page opens and closes on a band that's always dark. [The site's design](./site/design.md) covers the stylesheet, the
components, Starlight's replaced parts, the contrast check, and the design gallery at `/lab/design/`.

## Keep pages in sync

Every written page names the internal docs and source files it was written from in `sources`, and the
commit at which someone last confirmed it matched them in `checked`. `apps/site/scripts/stale.mjs`
reads both, from docs frontmatter and from each marketing page's `meta` export. A generated page is
traced back to the written half it was built from, through `BOOKS`:

| Command | What it prints |
| --- | --- |
| `pnpm --filter @acorn/site stale` | Each page with commits to its sources since `checked`, newest first. |
| `pnpm --filter @acorn/site stale --touching <paths…>` | Each page that cites one of the given repository paths, or a folder that holds one. |
| `pnpm --filter @acorn/site stale --mark <page>` | Nothing to review. It sets the page's `checked` to the current commit. Name the page by its file or its URL. |

Add `--json` to either report for the same data as JSON. Both reports exit 0 whatever they find.

To clear a page, read the commits the report lists. Update the page if the behavior it describes
changed, commit, then run `--mark` on it and commit that. `--mark` is the only supported way to change
`checked`, so nobody types a hash by hand.

`apps/site/scripts/stale.test.mjs` fails when a page cites a path that doesn't exist, or when `checked` isn't a
commit in the history of `HEAD`. It runs with the other script tests in `pnpm --filter @acorn/site test`.

Shell snapshots in `apps/site/src/generated/snapshots/` count as pages. A snapshot names the commit it
was captured at near the top of the file: `<!-- commit 3f9a2c1, captured 2026-10-20 -->` in a `.html`
snapshot, and a top-level `"commit": "3f9a2c1"` in a `.cells.json` snapshot. Its sources are the
shell's folders and stylesheets, listed in `SNAPSHOT_SOURCES` in `stale.mjs`. Recapture a snapshot to
clear it. `--mark` doesn't take one.

In CI, the `site` job checks out the full history and writes both reports to the job summary. On a
pull request, `--touching` gets every file the pull request changes. Neither report fails the job.

## Formatting

oxfmt doesn't read `.astro` or Markdown files, and the repository's oxfmt config formats only
TypeScript. The site's `.ts` files follow the formatter. Its `.astro`, `.md`, and `.mjs` files are
formatted by hand, to the same style.

## Deploy it

The site is a Cloudflare Worker with static assets, configured in `apps/site/wrangler.jsonc`. Its one
script, `apps/site/src/worker.ts`, runs only for download links. It counts each download and redirects
it to GitHub ([counting downloads](site/releases.md#counting-downloads)).
`.github/workflows/site.yml` deploys it. The workflow runs on a pull request or a push to `main` that
touches the site or anything it reads from, such as `docs/`, `packages/protocol/`, or the kit. It
type-checks the site, then builds and tests the production and preview builds side by side.

- On a pull request, it uploads the preview build as a Worker version with the alias `pr-<number>`,
  and writes the preview URL to the job summary. Preview responses carry `X-Robots-Tag: noindex`. A
  pull request from a fork gets no preview, because it gets no secrets.
- On a push to `main`, once a day, and on each published release, it deploys the production build.

The workflow needs two repository secrets:

| Secret | What it holds |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | An API token with the **Workers Scripts: Edit** permission on the account. |
| `CLOUDFLARE_ACCOUNT_ID` | The Cloudflare account ID. |

Wrangler runs through `pnpm dlx` at the version the workflow pins, so a normal install doesn't
download the Workers runtime.

`apps/site/public/_headers` sets the response headers: a Content Security Policy that allows only the
site's own origin, and a year of caching for the hashed files in `/_astro/`. HTML keeps Cloudflare's
default of revalidating on every request. The policy allows inline scripts and styles, because
Starlight writes its theme script and code block styles inline. `astro preview` ignores `_headers`, so
the Playwright tests don't exercise the policy.

## Add a page

To add a docs page:

1. Create a Markdown file under `apps/site/src/content/docs/docs/`, in the folder for its sidebar group.
   Its path is its URL, so `apps/site/src/content/docs/docs/agents/skills.md` serves
   `/docs/agents/skills/`.
2. Fill in the frontmatter. The build fails when a required field is missing.
3. Add its slug to the sidebar in `apps/site/astro.config.mjs`, in the group and position the site map
   gives it.

Every docs page takes these frontmatter fields, on top of Starlight's own:

| Field | Rule |
| --- | --- |
| `description` | Required. One sentence. It becomes the meta description and the search summary. |
| `sources` | Required. At least one repository path the page was written from. |
| `checked` | Required. The commit at which the page last matched its sources. |
| `draft` | Optional, `false` by default. A draft builds in development and on preview deploys, never in production. |
| `covers` | Optional. The Settings page IDs the page documents. `apps/site/scripts/settingsPages.test.mjs` fails when a Settings page that ships is in no page's `covers`, or `covers` names one that doesn't ship. |

To add a marketing page, create an Astro file under `apps/site/src/pages/`. It exports a `meta` object
with the same `description`, `sources`, and `checked`, typed as `PageMeta` from `apps/site/src/meta.ts`,
and renders inside `apps/site/src/layouts/Marketing.astro`. The layout validates `meta`, so a page with a missing
field fails the build. A plugin acorn ships also needs [an entry and a docs page](./site/built-in-plugins.md).

To add a lab page, create an Astro file under `apps/site/src/lab/`. The `lab` integration in
`apps/site/astro.config.mjs` serves it under `/lab/` in development and preview builds only. A file
whose name starts with `_` is a component the lab pages import, not a page, as in `src/pages/`.

The page wireframes are in `apps/site/src/lab/wireframes/`, at `/lab/wireframes/`. `/lab/wireframes/narrow/`
shows every template at 375 pixels wide, side by side.
