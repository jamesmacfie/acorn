# Phase 2: scaffold the site

Date: October 15, 2026. Status: done. Every later phase depends on it.

## Completion note

October 15, 2026. `apps/site` (`@acorn/site`) builds with Astro 7.3 and Starlight 0.42. It holds every
page in the site map as a stub: 167 docs pages and 15 marketing routes, plus a 404 page and `/lab/`.
[The public site](../../site.md) is the reference for running, checking, and deploying it.

What landed:

- The docs collection schema in `apps/site/src/content.config.ts`. `description`, `sources`, and
  `checked` are required, and `covers` is optional. A docs page without `sources` fails the build,
  draft or not. Marketing pages export `meta`, typed `PageMeta`, and `Marketing.astro` validates it
  with the same Zod schema in `apps/site/src/meta.ts`.
- Every docs stub is a draft except the docs home, with `checked: 1e0ef8b80`. The sidebar in
  `astro.config.mjs` lists every slug in site map order.
- `ACORN_SITE_PREVIEW=1` makes a preview build. Drafts and `/lab/` build in `astro dev` and on
  previews, never in production. A production build writes 17 pages, and a preview build writes 184.
- `apps/site/scripts/budget.mjs`, with `node:test` tests that prove a 50 KB script and a script from
  another origin both fail. Playwright tests load every built page, run axe on each template, and
  check the draft and lab rule for whichever build they're given.
- `.github/workflows/site.yml` checks both builds, uploads a preview per pull request, and deploys
  production from `main`. `apps/site/wrangler.jsonc` and `apps/site/public/_headers` configure
  Cloudflare. Nothing has been deployed.

Secrets the deploy needs: `CLOUDFLARE_API_TOKEN`, with **Workers Scripts: Edit** on the account, and
`CLOUDFLARE_ACCOUNT_ID`. The account's `workers.dev` subdomain must be on for preview URLs. Wrangler
fails to upload a version to a Worker that doesn't exist, so the first production deploy from `main`
has to land before any pull request gets a preview. Production goes to `workers.dev` until phase 20
adds the `acorn.sh` route.

Decisions and deviations:

- The checks and deploys live in their own workflow, `site.yml`, not a `site` job in `ci.yml`. Only a
  workflow can filter by path, and [sync](./sync.md#where-each-check-runs) wants the job to run only
  for the paths it lists. `ci.yml`'s check job skips the site's tests so they don't run twice.
- There's no separate `check` script. `lint` runs `astro check`, so root `pnpm lint` covers the site.
- No `@astrojs/sitemap` dependency. Starlight adds that integration itself when `site` is set.
- No `knip.jsonc` change. knip's Astro and Playwright plugins find the entry files. A probe export
  in `apps/site/src/meta.ts` was reported, so the site is checked.
- oxfmt doesn't read `.astro` files, and the repository's config formats TypeScript only. The site's
  `.ts` files pass the format check, and nothing else changed.
- `/docs/` is "What is acorn", and it's published, not a draft. The 404 page links to it, and the
  link validator fails a production build that links to a page it didn't write.
- Starlight fails a production build on a sidebar slug whose page is a draft. `astro.config.mjs`
  leaves drafts out of the sidebar by reading `draft: true` from each file with a regex, and drops
  groups left empty. A page that writes `draft` in another form would slip past it.
- Lab pages live in `apps/site/src/lab/`, and a small integration injects them, because Astro has no
  way to leave a `src/pages` file out of one kind of build.
- Starlight draws code with Expressive Code, so the Shiki themes are set in `expressiveCode.themes`.
- Wrangler runs through `pnpm dlx` at a pinned version, not as a dependency, so a normal install
  doesn't download the Workers runtime. Previews use `wrangler versions upload --preview-alias pr-<n>`.
- Playwright uses the installed Chrome, which GitHub's Ubuntu runners have, so nobody downloads a
  browser. `astro preview` runs with `--ignore-lock`, because Astro 7 moves it to the background when
  it detects a coding agent.
- The Content Security Policy allows only the site's origin, but it needs `'unsafe-inline'` for
  scripts and styles, because Starlight writes them inline. `astro preview` ignores `_headers`, so no
  test exercises the policy.
- Slugs follow the site map's title rule literally, so some are long, such as
  `quick-start-first-project-first-task-first-agent`.
- The per-component pages in phase 18 and the per-key contribution pages in phase 15 are generated, so
  they have no stubs. Each of those sections has one stub page for now.
- The favicon is a copy of the extension's 128-pixel icon.
- Astro 7.3 needs zod 4.6 and Vite 8.3. The lockfile gains zod 4.6.7 beside the catalog's 4.4.3, and
  the vitest suites that had resolved Vite 8.0.16 resolve 8.3.4. `@acorn/protocol`'s suite passes on
  it. The catalog is unchanged.

What later phases need to know:

- To publish a docs page, delete its `draft: true` line.
- Add CI checks to the `site` job in `site.yml`, and run them for both builds when output differs.
- Phase 4 reads `sources` and `checked` from docs frontmatter and from each marketing page's `meta`
  export.
- The FAQ stub cites `docs/future/marketing/voice.md`, which goes when this folder is deleted.
- `pnpm dev` starts the site's dev server along with the desktop app, the same way it starts the
  extension and the terminal client.
- Two architecture checks fail on the base commit before this change too: the console baseline and
  library entrypoints in `boundaries.test.ts`. So do the doc length, doc path, and citation checks.

## Goal

`apps/site` builds a static site, deploys a preview for every pull request, and holds every page in
[the site map](./site-map.md) as a stub. The sidebar and navigation are complete from the first deploy,
so every later phase fills pages in rather than inventing structure. The CI job, the page-weight budget,
and the frontmatter rules exist before any content does.

## Starting point

- `pnpm-workspace.yaml` includes `apps/*`, so a package in `apps/site` joins the workspace with no
  config change. pnpm installs a version only after it has been on the registry for seven days.
- Turborepo runs `build`, `lint`, and `test` per package (`turbo.json` at the root).
- `tools/arch/boundaries.test.ts` classifies a package by its folder. An app may import packages and
  never another app.
- oxfmt formats TypeScript, and knip fails on unused exports (`knip.jsonc` at the root).
- `references/hunk/website/astro.config.mjs` is a working Astro and Starlight config for a site with the
  same shape, with comments explaining each choice.
- The root `package.json` pins Node to 22.23, 24.18, or 26.5 and up within each major.

## Changes

### 1. Create the package

Add `apps/site/package.json` (new) as the private package `@acorn/site`, with `astro`,
`@astrojs/starlight`, and `@astrojs/sitemap`. Add later dependencies in the phase that needs them.

Write `apps/site/astro.config.mjs` (new) from hunk's config:

- `site: 'https://acorn.sh'` and `output: 'static'`.
- `markdown.processor` with `smartypants: false`, because the docs are full of `--flags` that smart
  typography turns into dashes.
- Shiki with `github-light` and `github-dark`, the two themes `packages/client-core/src/infra/highlight/shiki.ts`
  loads, so code on the site matches code in the app.
- `editLink` to the file on GitHub, `lastUpdated`, and `pagination`.
- Leave out `llms.txt` and Markdown copies. [Phase 19](./19-search-and-agent-outputs.md) adds both.

Lay the package out like this:

```text
apps/site/
  astro.config.mjs
  src/
    content.config.ts     the docs collection and its frontmatter schema
    content/docs/docs/    Starlight pages, one folder per sidebar group, served under /docs/
    pages/                marketing pages, /download, /changelog, /plugins, /lab
    components/           site components; components/docs/ holds the Starlight overrides
    layouts/
    data/                 hand-written data, such as the changelog
    generated/            committed generator output: specimens and snapshots
    styles/
  scripts/                the budget check, the staleness report, and the generators
  tests/                  Playwright smoke and accessibility tests
```

Starlight routes a page by its path under `src/content/docs/`, so the extra `docs/` folder puts the
docs under `/docs/` and leaves `/` for the landing page.

### 2. Define the frontmatter

In `apps/site/src/content.config.ts` (new), extend Starlight's `docsSchema` with:

| Field | Rule |
| --- | --- |
| `description` | Required. One sentence. It becomes the meta description and the search summary. |
| `sources` | Required, at least one repository path. See [sync](./sync.md#rule-3-written-pages-name-their-sources). |
| `checked` | Required. The commit at which the page last matched its sources. |
| `draft` | Optional, default `false`. A draft builds on preview deploys with a banner, and never in production. |
| `covers` | Optional. Settings page IDs the page documents, for [phase 12](./12-docs-agents-security-settings.md)'s coverage check. |

Marketing pages are Astro files, not collection entries. Give each a typed `meta` export with the same
`description`, `sources`, and `checked`, so phase 4's report reads both kinds of page the same way.

### 3. Stub every page

Create every docs page in the site map as a draft with its title, a one-line description, and its
`sources` filled from the site map. Create every marketing route as an Astro page that says what will
go there. Build the sidebar in `astro.config.mjs` from the site map's groups, in its order.

Add a 404 page that offers the docs home and the search box. Add `/lab/` as a folder whose pages build
only when `import.meta.env.PROD` is false or the build is a preview.

### 4. Wire it into the repository

- Add `build`, `dev`, `check` (`astro check`), `test`, and `lint` scripts, and their Turborepo tasks.
  Add `pnpm dev:site` at the root.
- Add the site's entry files to `knip.jsonc`, with the reason.
- Check whether oxfmt formats `.astro` and `.mdx` files. If it doesn't, leave them out of the format
  check and say so in `docs/site.md` (new). Don't add Prettier for one package.
- Confirm `tools/arch/boundaries.test.ts` treats `apps/site` as an app.

### 5. Add the checks

- `apps/site/scripts/budget.mjs` (new) walks the built `dist/` folder. For each HTML page it adds up
  the Brotli-compressed size of the HTML and every stylesheet and script the page loads, leaving out
  images and fonts. It fails when a page exceeds its budget, and when any page references another
  origin in a `src` or `href` it loads. Start with these budgets, then tighten them once real pages
  exist: 10 KB of JavaScript on any marketing page, 150 KB in total for the landing page, and 100 KB
  for a docs page.
- Install `starlight-links-validator` so a broken internal link fails the build.
- Add Playwright tests in `apps/site/tests/` (new folder) that load every route, fail on a console error,
  and run axe on one page of each template. hunk's `website/tests/` folder is the model.

### 6. Deploy

The site imports workspace packages, so it has to build inside the monorepo. Build it in GitHub
Actions with the frozen lockfile, then upload `apps/site/dist` to Cloudflare with `wrangler`.
Cloudflare Workers with static assets is the default choice. Pages works the same way if the owner
prefers it.

- Every pull request that touches the paths in [sync](./sync.md#where-each-check-runs) gets a preview
  URL in the job summary. Previews send `X-Robots-Tag: noindex`.
- A push to `main` deploys production.
- Add `apps/site/public/_headers` (new): long-lived caching for hashed assets, short caching for
  HTML, and a Content Security Policy that allows only the site's own origin.

Add a `site` job to `.github/workflows/ci.yml` that runs `check`, `build`, the budget, the link
validator, and the Playwright tests. Later phases add their checks to this job.

### 7. Write the internal page

Create `docs/site.md` (new) as the reference page for the site: how to run it, build it, deploy it,
regenerate each artifact, and add a page. List it in `docs/README.md`. Each later phase adds its
section. This page outlives the programme.

## Out of scope

Design, real content, specimens, and search styling. Starlight's default look is fine until phase 6.

## Acceptance

- `pnpm --filter @acorn/site build` writes a static site to `apps/site/dist`.
- A pull request gets a working preview URL. A merge to `main` updates production.
- Every page in the site map is reachable from the navigation or the sidebar on the preview.
- A production build contains no draft page and no `/lab/` page.
- Adding a 50 KB script to the landing page fails the budget check, which proves the check isn't
  vacuous. Adding a script from another origin fails it too.
- A docs page without `sources` fails the build.

## Risks

Starlight's defaults assume the docs are the whole site. Serving them under `/docs/` beside hand-written
pages is what hunk does, so copy its approach rather than fighting the router.
