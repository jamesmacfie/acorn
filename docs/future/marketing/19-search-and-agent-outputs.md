# Phase 19: add search, agent outputs, and page metadata

Date: October 15, 2026. Status: proposed. Run it once most pages have content.

## Goal

A reader finds any page or reference field from the keyboard in a second or two. Every page has a
correct title, description, canonical URL, and social card. An agent helping someone use acorn can read
the docs as Markdown. All of it is generated at build, and none of it loads anything from another
origin.

## Starting point

- Starlight builds a Pagefind index at build time, with no server.
- hunk's config, in `references/hunk/website/astro.config.mjs`, sets up `starlight-dot-md` and
  `starlight-llms-txt` with comments on each choice, and hunk draws its social cards with Playwright as a
  maintainer task.
- herdr's docs home offers a prompt that points an agent at `/agent-guide.md`.
- Phase 2's frontmatter requires a one-sentence `description` on every page.

## Changes

### 1. Search

- Style Pagefind's results as acorn's command palette, using phase 6's design. Open it with
  Command+K or Control+K, and with `/` when focus isn't in a text field.
- Group results by sidebar section, so "Settings" results don't bury "Build plugins" results.
- Weight generated reference headings higher, so searching `contentLinks` lands on its contribution
  page first.
- Leave `/lab/` and drafts out of the index.

### 2. Markdown copies and `llms.txt`

Add `starlight-dot-md` and `starlight-llms-txt`, configured like hunk's:

- Every docs page is also served as Markdown at its URL plus `.md`.
- `/llms.txt`, `/llms-small.txt`, and `/llms-full.txt` list and bundle the docs. Lead with Start here,
  and leave the generated component pages and the changelog out of the small version.
- The "Notes for agents" block holds only rules no page states, such as: use the `plugin_authoring` tool
  on the person's own Node for the exact plugin vocabulary of the build they run, because the site
  describes the newest release.

### 3. The agent guide

Write `/agent-guide.md` by hand: how an agent helps a person install acorn, pair a device, and open their
first task, and where the docs for each step are. Keep it to facts that other pages own, with links.
On the docs home, under the two doors, add one line with a prompt the reader can paste into their agent
to have it read the guide. The docs are written for people. This is one line for the people who'd rather
ask.

### 4. Page metadata

- Titles as `<Page> · acorn docs` for docs and `<Page> · acorn` for marketing pages.
- `description` from frontmatter, canonical URLs, and `og:` and `twitter:` tags.
- Structured data on `/` and `/download/`: `SoftwareApplication` with the operating systems, the
  license once decided, and the download URL when a release exists.
- `robots.txt` allows everything on production. Previews already send `noindex` from phase 2.

### 5. Social cards

Add `apps/site/scripts/og.mjs` (new), a maintainer task like hunk's: it renders an Astro route at
`/lab/og/<slug>` with phase 6's card template and screenshots it with Playwright at 1200 by 630 into
`apps/site/public/og/` (new folder). Draw one card per marketing page and one per docs section, and use
the section's card for every page in it. Commit the images. The site build never runs a browser.

Record in the site's internal page when to redraw cards: after a headline or section title changes.

## Out of scope

Analytics beyond [owner decision 5](./README.md#what-the-owner-decides). Translated pages.

## Acceptance

- Searching a contribution key, a component name, a setting label, and a command name each puts the
  right page first.
- Every docs page answers at its URL plus `.md` with clean Markdown.
- `/llms-full.txt` contains every docs page out of draft.
- Every page has a unique title and description. A test fails on a duplicate.
- A link to any page pasted into a chat app shows its card.
