# Phase 19: add search, agent outputs, and page metadata

Date: October 15, 2026. Status: done. Run it once most pages have content.

## Completion note

October 16, 2026. Search, page metadata, social cards, the Markdown copies, `llms.txt`, and the agent
guide are built. [Search and agent outputs](../../site/agent-outputs.md) is the reference for each.

What landed:

- **Search.** `apps/site/src/components/Search.astro` replaces Starlight's search in the header on
  every page. It opens with Command+K or Control+K, and with `/` outside a text field. It draws with the
  command palette's own markup, kept in the specimen stylesheet by `SITE_KIT` in `acornUi.mjs`, and
  queries Pagefind's index directly. Results are grouped by sidebar group, which `PageTitle.astro`
  writes into the index from `docsSection` in `nav.ts`. Preview drafts and the lab's Starlight pages
  set `pagefind: false`.
- **Metadata.** Docs titles read `<Page> · acorn docs`, and marketing titles `<Page> · acorn`.
  `apps/site/src/routeData.ts`, Starlight's route middleware, adds each docs page's social card.
  `Marketing.astro` writes the canonical URL and the `og:` and `twitter:` tags. The landing and
  download pages carry a schema.org `SoftwareApplication`. `robots.txt` already allowed everything.
- **Social cards.** `apps/site/src/og.ts` lists 31 cards: 15 marketing pages and 16 sidebar groups.
  `/lab/og/<card>/` draws one, and `pnpm --filter @acorn/site og` screenshots them into
  `apps/site/public/og/`, about 950 KB in all. The lab page `/lab/design/social-card/` is gone, because
  `/lab/og/home/` replaces it.
- **Markdown and `llms.txt`.** `starlight-llms-txt` 0.12 writes the three files. The 277 published docs
  pages each answer at their URL plus `.md`, from `apps/site/src/pages/[...slug].md.ts`.
- **The agent guide**, at `apps/site/public/agent-guide.md`, and a one-line prompt under the docs home's
  two doors. The docs home cites the guide in its `sources` and is marked checked.
- **Tests**, in `apps/site/tests/site.spec.ts`: unique titles and descriptions, an `og:image` the build
  wrote, a `.md` copy of every docs page that matches `/llms-full.txt`, the small file's exclusions, the
  agent guide's links, the index's page count, the four acceptance searches, the palette's keys and
  axe, and the structured data. A production build passes 334 Playwright tests, with 24 skipped, and a
  preview build passes 422. `astro check`, knip, and the budget check pass.

### Decisions

- **No `starlight-dot-md`.** It serves each page's source file, and the reference and component pages
  draw their facts with components, so their sources hold no facts. The `.md` route calls
  `starlight-llms-txt`'s own renderer instead, so a page's `.md` copy and its part of `/llms-full.txt`
  are the same Markdown. The plugin doesn't export the renderer, so `astro.config.mjs` reaches it by
  file path, behind a `shortcut:` comment.
- **A picture keeps only its caption** in every Markdown output. The window's labels read as noise.
- **Phrase first.** Pagefind ranks words, so `acorn task list` ranked every page about tasks above the
  command line reference. For a query of more than one word, pages holding the exact phrase come first,
  each group in Pagefind's order.
- **A title word weighs 1.** Pagefind's default put "Workspaces and projects" ahead of Settings >
  General for "Show workspace rail", because one word matched a title. Across 25 test queries, this
  changed only that one.
- **Which headings weigh more.** A command's heading on the command line reference weighs 10, and the
  first column of any table, which names a setting, field, or variable, weighs 5. A weight on the
  generated contribution and component titles changed no result, because those names already rank
  first, so there isn't one.
- **Duplicate titles name their group.** Six pairs of pages share a title, such as Settings > Agents
  and the Agents plugin. Rather than renaming other phases' pages, a docs page whose title another page
  shares gets `<Page> · <Group> · acorn docs`, and a feature page gets `<Feature> · Features · acorn`.
- **Search covers the docs only.** Starlight marks only docs bodies for Pagefind, and each feature page
  links to the docs page that owns its detail.

### Deviations

- **No generated-heading weight on reference pages**, as the decision above explains. `contentLinks`
  lands on its contribution page first without one.
- **`/llms-full.txt` is 1.9 MB, and `/llms-small.txt` 1.1 MB.** About a third of each is padding the
  plugin's converter adds to line up table columns. It has no option to turn that off.
- **Preview builds put drafts in `/llms-full.txt` and the `.md` copies**, because a preview publishes
  drafts. Production holds no draft.

### What later phases need to know

- Phase 20: check that a pasted `acorn.sh` link shows its card in a chat app, which needs the live
  site. Read the 31 cards and the agent guide in the content review.
- Redraw the cards after a page's headline, a sidebar group's title, or a card's sentence changes. A
  new marketing page or sidebar group needs an entry in `og.ts`, and the tests fail until its card is
  drawn.
- A new docs page whose title matches another's gets its group in its `<title>` with no edit.
- When Install, the quick start, Desktop and terminal, or the pairing pages change, read the agent
  guide again. `stale` lists the docs home when the guide changes, not the other way round.
- The architecture suite fails the same six checks phase 18 recorded, none on a file this phase
  touched. `docs/site.md` stays at 201 lines, as on the base commit.

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
- Structured data on `/` and `/download/`: `SoftwareApplication` with the operating systems, the MIT
  license, and the download URL when a release exists.
- `robots.txt` allows everything on production. Previews already send `noindex` from phase 2.

### 5. Social cards

Add `apps/site/scripts/og.mjs` (new), a maintainer task like hunk's: it renders an Astro route at
`/lab/og/<slug>` with phase 6's card template and screenshots it with Playwright at 1200 by 630 into
`apps/site/public/og/` (new folder). Draw one card per marketing page and one per docs section, and use
the section's card for every page in it. Commit the images. The site build never runs a browser.

Record in the site's internal page when to redraw cards: after a headline or section title changes.

## Out of scope

Analytics: there are none at launch ([owner decision 5](./README.md#what-the-owner-decides)). Translated
pages.

## Acceptance

- Searching a contribution key, a component name, a setting label, and a command name each puts the
  right page first.
- Every docs page answers at its URL plus `.md` with clean Markdown.
- `/llms-full.txt` contains every docs page out of draft.
- Every page has a unique title and description. A test fails on a duplicate.
- Every page's `og:image` points at a file that exists in the build. Checking that a pasted link shows
  its card in a chat app needs a live URL, so it's left for phase 20.

This is the last phase the agent run covers. Phase 20 and phase 21 wait for James.
