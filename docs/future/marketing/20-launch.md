# Phase 20: launch

Date: October 15, 2026. Status: proposed. Last. Needs phases 1 to 19.

## Goal

`acorn.sh` serves the finished site, every page on it is true for the current build, and there's a
written routine that keeps it true release after release.

## Steps

### 1. Content

1. Every page is out of draft. A production build fails if one isn't.
2. Phase 4's staleness report is empty.
3. James reads every marketing page and one page from each docs section against
   [the review steps in voice](./voice.md#how-to-review-a-page), and approves them.
4. The FAQ and every mention of the license match [owner decision 1](./README.md#what-the-owner-decides).
5. Search the built site for every word in [voice's list](./voice.md#words-the-site-doesnt-use) and for
   em dashes. Fix what turns up.

### 2. Facts

1. Walk the install page and the quick start on a machine that has never run acorn, then in the
   terminal client.
2. Walk the plugin tutorial on a machine with no acorn source checkout, using only the published
   packages.
3. Scaffold a plugin, open its `acorn-plugin.json` in VS Code, and check that completion and hover help
   come from `https://acorn.sh/schemas/acorn-plugin.schema.json`.

### 3. Quality

1. Playwright smoke tests and axe pass on every route.
2. The internal link check passes. Run an external link check once and fix what it finds.
3. The budget check passes on every page.
4. Lighthouse on `/`, `/download/`, one guide, one reference page, and one component page, on mobile and
   desktop. Record the numbers and the date in the site's internal page.
5. Check the site in Safari, Firefox, and Chrome, at 375 pixels wide and at 1440.
6. Use the landing page and one docs page with the keyboard alone, and with VoiceOver.
7. Switch through all 12 themes and 4 style packs on the landing page and a component page.

### 4. Infrastructure

1. Point `acorn.sh` at Cloudflare, with HTTPS, HSTS, and `www` redirecting to the bare domain.
2. Confirm the headers: caching, the Content Security Policy, `Referrer-Policy`, and the JSON content
   type and open CORS header on `/schemas/`.
3. Confirm the daily rebuild from phase 10 runs on production.

### 5. The repository

1. Link the site from the root `README.md` and from `docs/README.md`.
2. Set the GitHub repository's website to `https://acorn.sh` and replace its description, which reads
   "My personal development tool", with the line from phase 1.
3. Add a release checklist to the site's internal page, run before every release:
   - Add the release to the changelog data.
   - Run the staleness report and clear it.
   - Recapture any snapshot the report lists.
   - Rebuild and deploy.

### 6. Close the programme

Update [the future index](../README.md) row for this folder. Phase 21 can stay open. If nothing else
does, delete every file here except `21-changelog-from-github.md` and a short README that points at
it, and say in the future index where the site's behavior is documented.

## Acceptance

- Every step above is done, and the Lighthouse numbers are recorded with their date.
- The site at `acorn.sh` matches `main`.
- The release checklist is in the site's internal page.
