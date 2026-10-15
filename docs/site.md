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

```sh
pnpm --filter @acorn/site build
```

The build writes the static site to `apps/site/dist`. There are two kinds of build:

| Build | Command | Drafts and `/lab/` |
| --- | --- | --- |
| Production | `pnpm --filter @acorn/site build` | Left out. |
| Preview | `ACORN_SITE_PREVIEW=1 pnpm --filter @acorn/site build` | Built. Each draft page carries a banner that says it isn't published. |

Starlight drops drafts from any production build, and fails on a sidebar entry whose page it can't
find. So `apps/site/astro.config.mjs` leaves draft pages out of the sidebar in a production build,
and `apps/site/src/content.config.ts` publishes drafts with a banner in a preview build.

Every build runs `starlight-links-validator`, so a broken link between pages fails the build.

## Check it

| Command | What it checks |
| --- | --- |
| `pnpm --filter @acorn/site lint` | `astro check`: types in the `.astro` pages, the content config, and the tests. Root `pnpm lint` runs it too. |
| `pnpm --filter @acorn/site test` | The budget check's own tests, the budget check, then the Playwright tests. Run a build first. |

The budget check, `apps/site/scripts/budget.mjs`, reads `dist`. For each page it adds up the Brotli-compressed
size of the HTML and of every stylesheet and script the page loads, following static imports between
scripts. Images and fonts don't count. A page fails when it goes over its budget, or when it loads
anything from another origin:

| Page | Budget |
| --- | --- |
| The landing page | 10 KB of JavaScript, 150 KB in total |
| Any other marketing page | 10 KB of JavaScript |
| A docs page, and the 404 page | 100 KB in total |

The Playwright tests in `apps/site/tests/` load every page the build wrote and fail on a console error. They run
axe on the landing page, the docs home, and the 404 page, one page for each template, and check that
drafts and `/lab/` appear only in a preview build. They use the Chrome installed on the machine, so
install Chrome before you run them. `ACORN_SITE_PREVIEW` must match the build you're testing.

## Formatting

oxfmt doesn't read `.astro` or Markdown files, and the repository's oxfmt config formats only
TypeScript. The site's `.ts` files follow the formatter. Its `.astro`, `.md`, and `.mjs` files are
formatted by hand, to the same style.

## Deploy it

The site is a Cloudflare Worker with static assets and no script, configured in `apps/site/wrangler.jsonc`.
`.github/workflows/site.yml` deploys it. The workflow runs on a pull request or a push to `main` that
touches the site or anything it reads from, such as `docs/`, `packages/protocol/`, or the kit. It
type-checks the site, then builds and tests the production build and the preview build.

- On a pull request, it uploads the preview build as a Worker version with the alias `pr-<number>`,
  and writes the preview URL to the job summary. Preview responses carry `X-Robots-Tag: noindex`. A
  pull request from a fork gets no preview, because it gets no secrets.
- On a push to `main`, it deploys the production build.

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
| `covers` | Optional. The Settings page IDs the page documents. |

To add a marketing page, create an Astro file under `apps/site/src/pages/`. It exports a `meta` object
with the same `description`, `sources`, and `checked`, typed as `PageMeta` from `apps/site/src/meta.ts`,
and renders inside `apps/site/src/layouts/Marketing.astro`. The layout validates `meta`, so a page with a missing
field fails the build.

To add a lab page, create an Astro file under `apps/site/src/lab/`. The `lab` integration in
`apps/site/astro.config.mjs` serves it under `/lab/` in development and preview builds only.
