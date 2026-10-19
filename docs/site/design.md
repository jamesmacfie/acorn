# The public site's design

This page covers how `apps/site` looks and why: the stylesheet, the mark, the light and dark
themes, the components, Starlight's replaced parts, and the checks that hold the design to the app.
Read it before you style a page or add a component. [The public site](../site.md) covers running and
deploying it, and [marketing copy](./marketing-copy.md) covers how the marketing pages read.

Two topics have pages of their own:

- [Fonts](./design/fonts.md): the faces, the JetBrains Mono subsets, and the preloads.
- [Lighthouse](./design/lighthouse.md): the landing page's target, the command, and its scores.

The site is built from acorn's own design tokens. The only color on a page is the color acorn draws:
the site's chrome uses the theme's text, background, border, and accent tokens, so in Catppuccin Latte
it's slate on pale grey with a blue accent. The light and dark switch restyles the site and every
specimen at once, because both read the same tokens. A marketing page's header, hero, and footer are
the exception: they always draw in the dark theme, as the [stage](#the-stage).

## The stylesheets

Every page loads two sheets, in this order:

1. `virtual:acorn-ui.css`, which `apps/site/scripts/acornUi.mjs` builds from the app's own sheets. Its
   token blocks set the tokens on `<html>`, and its other rules style specimens inside `.acorn-ui`
   ([specimens](./specimens.md#the-specimen-stylesheet)). It ends with the `.site-dark` token block
   ([the stage](#the-stage)).
2. `apps/site/src/styles/site.css`, the site's own sheet.

Starlight loads both through `customCss` in `apps/site/astro.config.mjs`. A marketing page loads them in
`apps/site/src/layouts/Marketing.astro`.

`site.css` uses the app's tokens for every color, font, space, size, radius, border, shadow, and
duration. A marketing page doesn't always load the two sheets in that order, so the few app tokens
`site.css` overrides, such as `--font-mono`, sit on `html:root`, which beats the app's `:root`. A value the app has no token for is a `--site-*` token at the top of the file, such as the
hero headline size, the header bar's height, and the width of a docs page's table of contents. The sheet also points Starlight's own
`--sl-*` palette and type at acorn's tokens, so Starlight's parts follow the theme too.

The document defaults, such as the body's font and link color, sit in a cascade layer called
`site-base`. That layer loads before Starlight's, so on a docs page Starlight's component rules still
beat them. Element rules skip anything inside `.acorn-ui`, so a specimen draws exactly as the app draws
it.

Components with their own look keep it in a `<style>` block beside their markup, written to the same
rules.

## Text is never muted

Every piece of text on the site is `--text`, on `--bg` or `--bg-subtle`. The app's muted text, tone
colors, and hover and selection fills fail contrast as text in some of the 12 themes. For example,
`--text-muted` is 2.93:1 in Solarized Light. So the site sets secondary text apart by size and case,
shows a callout's or a badge's tone in its border beside a word that names it, and marks the current
or hovered row with an accent rule. A primary button is `--bg` on `--text`, not the accent, for the
same reason.

## The mark

`apps/site/src/components/Mark.astro` draws the wordmark: the ASCII acorn from the app's empty states,
set as text beside `acorn`. It reads the drawing from
`packages/client-core/src/kit/components/content/Acorn.tsx`, so the two can't differ.
`apps/site/public/favicon.svg` is the same drawing as vector strokes, one path per row of its grid,
so it stays sharp at 16 pixels.

## Appearance

The site draws in two of the app's themes, Catppuccin Latte for light and Catppuccin Mocha for dark,
always in the Terminal style pack. The header's light and dark switch (`ThemeToggle.astro`) flips
between them. The site never sets `data-style`, so every page and specimen draws in Terminal, the
default. `SITE_THEMES` in `apps/site/scripts/acornUi.mjs` names the two, and `AppearanceScript` reads
them from there.

`apps/site/src/components/AppearanceScript.astro` runs inline in `<head>`. It reads the saved choice
from `localStorage` under `acorn-scheme`, or follows the system's light or dark mode when there's
none, and sets `data-theme` and `data-color-scheme` on `<html>` before the first frame, so a reload
never flashes the other theme. The build fails if either theme id is missing from the app. Code blocks
read `data-color-scheme` to pick github-light or github-dark (`apps/site/ec.config.mjs`).

## The stage

A marketing page opens and closes on a dark band, the _stage_: the header and the hero at the top, and
the footer at the foot, with the landing page's and every feature page's closing call to action
running into it. The stage draws in Catppuccin Mocha in both schemes. In light mode the page reads
dark, light, dark. In dark mode the stage is Mocha's darker `--bg-subtle`, a step below the page's
`--bg`.

An element with the `.site-dark` class takes the dark theme. `darkScope()` in `acornUi.mjs` builds the
class's token block from the app's own: Mocha's colors, and every token the plain `:root` blocks
derive from another, such as `--card-bg: var(--bg)`. A derived token takes its value where it's
declared, so without restating it a dark element would inherit the light page's value. Everything
inside, specimens and snapshots included, draws in Mocha. Code colors follow too, because they're
`light-dark()` pairs and `.site-dark` sets `color-scheme: dark`.

`.stage` paints its own background, and a border image's outset carries the band out to the window's
edges without widening the page. Keep the background on the element itself: axe reads text contrast
against an element's background, and it can't see paint from a pseudo-element or a border image. A
hero's picture ends in a negative margin of `--site-overhang`, so the window hangs over the stage's
edge onto the page, and whatever follows the hero starts that far down.

## Components

The components are in `apps/site/src/components/`. Each has a comment that says what it draws.

| Component | What it is |
| --- | --- |
| `SiteHeader`, `SiteFooter` | The header and the footer on every page. Below 50rem the header's links fold into a menu. |
| `GitHubStars` | **Star on GitHub**, a plain link to the repository. It shows the star count, read at build time, from 100 stars. |
| `Hero` | The stage at the top of a page: headline, paragraph, and an optional eyebrow, actions, and picture. `highlight` sets the end of the headline in the accent. The landing page leaves the eyebrow out. A marketing page puts it in the layout's `hero` slot, and the layout draws one with the page's title when there's none. With `split`, the paragraph and actions sit beside the headline on a wide screen, so the picture starts higher. |
| `InstallBlock` | A tab per install method, its commands after a prompt, and **Copy**. |
| `Specimen`, `SnapshotFrame` | A picture of acorn in a frame drawn like a pane, or a whole window with a title bar, its three buttons, a centered title, rounder corners, and a deeper shadow. A specimen switches between its desktop and terminal views with tabs, or shows them side by side with `both`. Either takes a `caption` that replaces its own. Under the hero, a window's caption is for screen readers only. |
| `Snapshot`, `Cells` | A [shell snapshot](./snapshots.md) in its frame, and a terminal's cells, which specimens and snapshots share. |
| `Feature`, `Tour`, `Card` | A numbered feature section, the landing page's tour, and a card. `Feature` takes `level={3}` under a section's own heading. A `Feature` with no picture keeps to the reading measure. The tour's tabs run down the side on a wide screen, beside the selected tab's words and window. On a marketing page a card is rounder and lifts under the pointer. |
| `DownloadPage`, `BuildFromSource` | The download page, in `apps/site/src/layouts/`, for a release or for none, and its Build from source section. `src/scripts/platform.ts` moves the visitor's platform first. |
| `FeaturePage` | The layout of a feature page, in `apps/site/src/layouts/`: the title and sentence from `apps/site/src/features.ts`, a picture, the page's sections, **In the terminal**, related features, and **Get started**. A new feature page needs an entry in `features.ts`, which the features index reads too. |
| `Badge`, `Keys` | The kit's own `Badge` and `Kbd` markup, with the text kept in `--text`. |
| `ReferenceTable`, `Checkpoint` | A table with a sticky header and an anchor per row, and a step's check. |
| `SocialCard` | The 1200 by 630 picture a shared link shows ([social cards](./agent-outputs.md#social-cards)). |
| `Search` | The header's search, drawn with the command palette's markup ([search](./agent-outputs.md#search)). |

A primary button is `--bg` on `--text`, and `data-size="lg"` makes it a page's main action. An arrow
after its label leans toward where it goes on hover. `.segmented` turns a tab strip into buttons in a
tray, the selected one inverse, as the hero's desktop and terminal switch does. A display heading may
end in `.accent`: display sizes are large text, where Latte's accent clears 3:1.

Callouts are Starlight's asides, restyled in `site.css` as the kit's banner `Alert`. A marketing page
writes `class="callout"` for the same look. Steps are
Starlight's `<Steps>`. Tabs and copy buttons share two small scripts in `apps/site/src/scripts/`.

## Motion

Nothing moves under reduced motion: `site.css` sets the duration tokens to zero there, and every
animation sits inside `@media (prefers-reduced-motion: no-preference)`.

A marketing page's hero comes in as the page loads, each part rising a little after the one before.
Further down, the landing page's chapter heads, steps, tour, windows, and grids, a feature page's
sections, and the cards rise the same way as they scroll into view. They finish before they're a third
of the way in, so nothing is still faint where you'd read it, and a browser without scroll timelines
shows them in place. A primary button lifts and an arrow leans on hover, a card lifts, and an FAQ
answer slides open where the browser can animate to `height: auto` (`interpolate-size`).

The Playwright accessibility tests run with reduced motion, so axe reads each block where it settles
rather than partway through rising in.

The landing page has two scroll-linked animations, CSS scroll-driven animations with no script. The
track over the three steps of a task fills left to right as they scroll up the screen, and the
plugins chapter's window outlines what plugins draw as it comes into view. Each sits inside
`@media (prefers-reduced-motion: no-preference)` and `@supports (animation-timeline: view())`, and
the static styles are the finished state, so a browser without scroll timelines shows the full track
and every outline.

The outlined window is the hero's snapshot again. Its selectors name each part by what the capture
calls it, such as the Git pane's `Git list` region, so a new capture keeps the outlines in place. If a
capture renames a pane, its outline and name disappear rather than land on the wrong part.

## Starlight's replaced parts

`apps/site/src/components/starlight/` replaces Starlight's `Header`, `Sidebar`, `PageTitle`, `Footer`,
`ThemeProvider`, and `ThemeSelect`. The `Footer` draws previous and next with the site's own
`Pagination`. The table of contents and the prose column keep Starlight's markup and take the site's
look from `site.css`. The prose column fills the space between the sidebars, and the table of contents
keeps a fixed width beside it. Search is the site's own `Search` component.

There are two sidebars. A page under `/docs/build-plugins/` or `/docs/components/` sees the Build
plugins groups, and every other docs page sees the rest (`isBuildPath` in `apps/site/src/nav.ts`).
Previous and next stay inside the page's own sidebar.

## Checks

| Check | What it fails on |
| --- | --- |
| `apps/site/scripts/siteCss.test.mjs` | A color written into the site's styles, as hex, a function, or a name, and text set in a token that fails contrast in some theme. The wireframes are left out. |
| `apps/site/scripts/contrast.test.mjs` | A pair of tokens the site sets text or a meaningful rule in that falls under 4.5:1 for text, or 3:1 for a rule, in any of the 12 themes. Add a pair here when a style uses a new one. |
| `apps/site/tests/site.spec.ts` | A theme pick that doesn't restyle the page, a saved theme missing from the first frame, and an axe finding on the design gallery. |
| `apps/site/scripts/acornUi.test.mjs` | A rule in the specimen stylesheet that reaches outside `.acorn-ui` other than a token block, and a `.site-dark` block that misses the dark theme's colors or a derived token. |

## The design lab

These pages build in `pnpm dev:site` and in preview builds only:

| Page | What it shows |
| --- | --- |
| `/lab/design/` | Every marketing component. |
| `/lab/design/docs/` | Every docs component, inside Starlight's chrome. |
| `/lab/design/landing/` | The landing page wireframe, restyled with the components. |
| `/lab/og/<card>/` | One social card alone, at 1200 by 630, for a screenshot. |

Switch between light and dark in the header on any of them.
