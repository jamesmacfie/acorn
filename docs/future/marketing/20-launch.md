# Phase 20: launch

Date: October 15, 2026. Status: proposed. Phases 1 to 19 are done. Their plans were removed on
October 16, 2026, and are in Git history at commit `c91b95809`, under `docs/future/marketing/`. This
file holds everything they left for launch.

## Goal

`acorn.sh` serves the finished site, every page on it is true for the current build, and there's a
written routine that keeps it true release after release.

## Steps

### 1. Content

1. Every page is out of draft. A production build fails if one isn't.
2. `pnpm --filter @acorn/site stale` prints "No page's sources changed since it was checked."
3. Refresh `apps/site/src/data/github.json`.
4. James reads every marketing page and one page from each docs section, and approves them. Include
   the 31 social cards and the agent guide. For each page:
   1. Read only the headings. Do they tell the story on their own?
   2. Read each paragraph's first sentence. Does each one say something specific?
   3. Read it aloud. Rewrite anything you wouldn't say to a colleague at your desk.
   4. Ask what makes the page sound machine-written, and fix that.
5. The FAQ and every mention of the license say MIT, the root `LICENSE` file. The FAQ answers "What
   does it cost?" with "Nothing. acorn is open source under the MIT license."
6. Search the built site for em dashes, for the words in
   [Write and maintain docs](../../writing-docs.md#voice), and for these. Fix what turns up.
   - AI-powered, AI-native, agentic, supercharge, unleash, unlock, elevate, empower.
   - Seamless, effortless, frictionless, blazing fast, lightning fast.
   - Next-generation, revolutionary, game-changing, leverage, utilize.
   - Robust, powerful, flexible, solution, platform, ecosystem, simply, just, easily.
   - "Workflow" for the way someone works. Keep it for acorn's Workflows feature.
   - "TUI" in prose. Write "the terminal client".
   - "Not just X, but Y", groups of three for rhythm, and a closing line that sums up a section.
7. Add a dashboard scene to the shell snapshots, so the Dashboards page gets a picture.

### 2. Facts

1. Walk the install page and the quick start on a machine that has never run acorn, then in the
   terminal client.
2. Publish `create-acorn-plugin`, `acorn-plugin-types`, and `acorn-plugin-sdk` to npm. The tutorial's
   first step runs `npm create acorn-plugin`.
3. Walk the plugin tutorial on a machine with no acorn source checkout, using only the published
   packages, including its terminal step.
4. Walk the Node and agent plugin guides the same way, with the harness and model steps against a real
   agent and key. They were walked only with `dev:agent` and a scratch folder.
5. Walk the Linear, Rollbar, GitHub, and Sentry setup steps against real accounts. They follow the code
   and the connection forms, and nobody has tried them.
6. Walk the browser extension pages in Chrome and Firefox.
7. Scaffold a plugin, open its `acorn-plugin.json` in VS Code, and check that completion and the field
   descriptions on hover come from `https://acorn.sh/schemas/acorn-plugin.schema.json`.

### 3. Quality

1. Playwright smoke tests and axe pass on every route.
2. The internal link check passes. Run an external link check once and fix what it finds.
3. The budget check passes on every page.
4. Lighthouse on `/`, `/download/`, one guide, one reference page, and one component page, on mobile and
   desktop. Record the numbers and the date in the site's internal page.
5. Check the site in Safari, Firefox, and Chrome, at 375 pixels wide and at 1440.
6. Use the landing page and one docs page with the keyboard alone, and with VoiceOver.
7. Switch through all 12 themes and 4 style packs on the landing page and a component page.
8. Paste an `acorn.sh` link into a chat app and check that its card shows.
9. Check the staleness report's job summary on a real pull request.

### 4. Infrastructure

1. Turn on the Cloudflare account's `workers.dev` subdomain and add the Cloudflare secrets that
   `site.yml` needs. Nothing has run yet.
2. Deploy production from `main` first. Wrangler can't upload a version to a Worker that doesn't exist,
   so no pull request gets a preview until then. Production is on `workers.dev` until the next step.
3. Point `acorn.sh` at Cloudflare and add the route, with HTTPS, HSTS, and `www` redirecting to the
   bare domain.
4. Confirm the headers with `curl -I`: caching, the Content Security Policy, `Referrer-Policy`, and the
   JSON content type and open CORS header on `/schemas/`.
5. Confirm the daily and release runs of `site.yml` build `main` and deploy to production.

### 5. The repository

1. Link the site from the root `README.md` and from `docs/README.md`.
2. Set the GitHub repository's website to `https://acorn.sh` and replace its description, which reads
   "My personal development tool", with the site's headline.
3. Add a release checklist to the site's internal page, run before every release:
   - Add the release to the changelog data.
   - Run the staleness report and clear it.
   - Recapture any snapshot the report lists.
   - Rebuild and deploy.

### 6. Close the programme

Delete this folder, remove its row from [the future index](../README.md), and say there that
`docs/site.md` documents the site.

## After launch

Reading the changelog from GitHub releases, so a published release updates `/changelog/` with nothing
copied by hand, was phase 21. Its plan is the phase 21 file in this folder at commit `c91b95809`.

## Acceptance

- Every step above is done, and the Lighthouse numbers are recorded with their date.
- The site at `acorn.sh` matches `main`.
- The release checklist is in the site's internal page.
