# Search and agent outputs

This page covers what the public site in `apps/site` gives a reader looking for something and an
agent reading the docs: search, each page's title, description, and social card, the Markdown copy of
each docs page, `llms.txt`, and the agent guide. Every one is written at build time, and none loads
anything from another origin. [The public site](../site.md) covers building and checking the site.

## Search

The header's **Search** opens a palette on every page, marketing pages included. Command+K or Control+K
opens it anywhere, and `/` does when focus isn't in a text field. It searches the docs, through the
Pagefind index Starlight writes at the end of `astro build`. `astro dev` writes no index, so check search
in a build served by `astro preview`.

`apps/site/src/components/Search.astro` draws the palette with the command palette's own markup: the
kit's overlay, bare field, and rows. `SITE_KIT` in `apps/site/scripts/acornUi.mjs` keeps those rules in
the specimen stylesheet whether or not a snapshot uses them. `site.css` marks the selected row with an
accent rule instead of the app's fill, which fails contrast as text in some themes.

Results are grouped by the sidebar group each page sits in, in the order of each group's best result.
`PageTitle.astro` writes the group into the index as Pagefind metadata, from `docsSection` in
`apps/site/src/nav.ts`. Both halves have a Reference group, so a Build plugins group's label starts
with "Build plugins".

What the index holds and how it ranks:

| Rule | Where |
| --- | --- |
| Only docs pages. Drafts on a preview build and the lab's Starlight pages set `pagefind: false`. | `content.config.ts`, and each lab page's frontmatter |
| A command's heading on the command line reference weighs 10, a heading's most. | `CliReference.astro` |
| The first column of a table, which names the setting, field, or variable a row describes, weighs 5. | `ReferenceTable.astro`, and `rehypeWeightTableKeys` in `astro.config.mjs` for Markdown tables |
| A word in a page's title weighs 1, as much as a heading. Pagefind's default ranks it far higher, which put "Workspaces and projects" ahead of the General settings page for "Show workspace rail". | `RANKING` in `Search.astro` |
| For a query of more than one word, pages holding the exact phrase come first, so `acorn task list` finds the command line reference ahead of every page about tasks. | `Search.astro` |

## Page metadata

| Page | Title | Head |
| --- | --- | --- |
| Docs | `<Page> · acorn docs`, or `<Page> · <Group> · acorn docs` when another docs page has the same title, such as Settings > Agents and the Agents plugin | Starlight writes the description, canonical URL, and `og:` and `twitter:` tags. `apps/site/src/routeData.ts` names the group and adds the social card. |
| Marketing | `<Page> · acorn`. A feature page's is `<Feature> · Features · acorn`. | `Marketing.astro` writes the same tags. |

The landing page and the download page also carry a schema.org `SoftwareApplication`
(`SoftwareApplication.astro`), with the release's page as its download once there's a release.
`apps/site/public/robots.txt` allows everything. A preview deploy sends `X-Robots-Tag: noindex`.

## Social cards

A social card is the 1200 by 630 picture a shared link shows. A marketing page has one of its own,
named for its path, such as `features-agents`, and every docs page uses its sidebar group's card,
such as `docs-agents`. The cards are PNG files in `apps/site/public/og/`, committed, because the site's
build never runs a browser. `apps/site/src/og.ts` lists each card's eyebrow, title, and sentence, and
`/lab/og/<card>/` draws one with the `SocialCard` component.

Redraw the cards after a page's headline, a sidebar group's title, or a card's sentence changes:

```sh
pnpm --filter @acorn/site og                     # every card
pnpm --filter @acorn/site og home docs-agents    # the cards you name
```

It starts `astro dev`, screenshots each card in the installed Chrome, in the Light theme and the
Terminal style pack, and takes about 20 seconds. Look at the pictures before you commit them. A new
marketing page or sidebar group needs an entry in `og.ts`, and the site's tests fail until its card is
drawn.

## Markdown copies and `llms.txt`

Every published docs page is also Markdown at its URL plus `.md`, such as `/docs/start/install.md`.
`starlight-llms-txt` writes `/llms.txt`, `/llms-small.txt`, and `/llms-full.txt`. Its options are in
`apps/site/astro.config.mjs`:

- The Markdown is rendered, not read from the source. The plugin renders each page and converts the
  HTML back, so the facts the generated reference and component pages draw with components come
  through. `apps/site/src/pages/[...slug].md.ts` serves the same Markdown for one page, through the
  plugin's own renderer, which the config reaches by file path because the plugin doesn't export it.
- A picture of acorn keeps only its caption, and heading anchors are dropped.
- Start here leads. `/llms-small.txt` leaves out the generated component pages. The changelog isn't a
  docs page, so neither file holds it.
- **Notes for agents** in `/llms.txt` holds only rules no page states. A fact a page owns would be a
  copy there that goes stale unseen.

The plugin pads every Markdown table's columns to line up, which is about a third of
`/llms-full.txt`'s 1.9 MB.

## The agent guide

`apps/site/public/agent-guide.md` is hand-written, served as-is at `/agent-guide.md`. It tells an agent
how to help a person install acorn, pair a device, and open their first task, and links the page that
owns each step. It states nothing those pages don't, so read it again when one of them changes. The docs
home offers a one-line prompt that points an agent at it, and cites the guide in its `sources`.

## Checks

The Playwright suite in `apps/site/tests/site.spec.ts` covers all of this, on both builds:

- Every published page has a title and a description no other page has, and an `og:image` the build
  wrote.
- Every docs page answers at its URL plus `.md`, and `/llms-full.txt` holds the same Markdown.
- Search indexes every published docs page and nothing else. A contribution key, a component, a setting's
  label, and a command each put the page that documents it first.
- The palette opens from the keyboard, groups its results, passes axe, and goes to the selected page.
- Every `getacorn.dev` link in the agent guide goes to a file the build wrote.
