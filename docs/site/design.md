# The public site's design

This page covers how `apps/site` looks and why: the stylesheet, the mark, the light and dark
themes, Starlight's replaced parts, and the checks that hold the design to the app.
Read it before you style a page or add a component. [The public site](../site.md) covers running and
deploying it, and [marketing copy](./marketing-copy.md) covers how the marketing pages read.

Four topics have pages of their own:

- [Components](./design/components.md): each component, and the conventions for buttons, labels, and callouts.
- [Fonts](./design/fonts.md): the faces, the JetBrains Mono subsets, and the preloads.
- [Lighthouse](./design/lighthouse.md): the landing page's target, the command, and its scores.
- [Motion](./design/motion.md): what moves, when, and how reduced motion stops it.

The site is built from acorn's own design tokens, under the app's token names, with colors of its
own. The page draws in the site's palette, the colors of an oak wood: a green-black night with cream
ink, a squirrel's orange as the accent, and a leaf green for what's running. By day the page turns
cream with forest ink, and the orange deepens so it reads on the light ground. The orange is also a
ground of its own, the _blaze_, for the landing page's loudest bands. A picture of acorn, a specimen
or a snapshot, draws in the app's own theme instead, Catppuccin Latte or Mocha, so it shows the colors
acorn draws. The light and dark switch restyles the page and every picture at once. A marketing
page's header, hero, and footer always draw at night, as the [stage](#the-stage).

## The stylesheets

Every page loads two sheets, in this order:

1. `virtual:acorn-ui.css`, which `apps/site/scripts/acornUi.mjs` builds from the app's own sheets. Its
   token blocks set the tokens on `<html>`, and its other rules style specimens inside `.acorn-ui`
   ([specimens](./specimens.md#the-specimen-stylesheet)). It ends with the `.site-dark` token block
   ([the stage](#the-stage)) and the picture blocks, which restate Latte or Mocha on every specimen
   and snapshot ([the palette](#the-palette)).
2. `apps/site/src/styles/site.css`, the site's own sheet. It imports `tokens.css`, the site's palette.

Starlight loads both through `customCss` in `apps/site/astro.config.mjs`. A marketing page loads them in
`apps/site/src/layouts/Marketing.astro`.

`site.css` uses the app's tokens for every color, font, space, size, radius, border, shadow, and
duration. `tokens.css` is the one file that writes a color, as the values of those tokens. A marketing page doesn't always load the two sheets in that order, so the few app tokens
`site.css` overrides, such as `--font-mono`, sit on `html:root`, which beats the app's `:root`. A value the app has no token for is a `--site-*` token at the top of the file, such as the
hero headline size, the header bar's height, and the width of a docs page's table of contents. The sheet also points Starlight's own
`--sl-*` palette and type at acorn's tokens, so Starlight's parts follow the theme too.

The document defaults, such as the body's font and link color, sit in a cascade layer called
`site-base`. That layer loads before Starlight's, so on a docs page Starlight's component rules still
beat them. Element rules skip anything inside `.acorn-ui`, so a specimen draws exactly as the app draws it.

Components with their own look keep it in a `<style>` block beside their markup, written to the same
rules.

## The palette

`apps/site/src/styles/tokens.css` sets the site's colors under the app's token names, such as `--bg`,
`--text`, and `--accent`, so `site.css` and Starlight's mapping read them as they always have. Its
day block sits on `<html>`. Its night block sits on `<html>` in dark mode and on every `.site-dark`
element. `html:root:root` outweighs the app's `:root[data-theme="…"]` blocks whichever sheet loads
first. Four more groups of its tokens are the site's alone:

| Token | What it colors |
| --- | --- |
| `--site-accent`, `--site-accent-ink` | Marks the site draws over a picture, such as the outlines and names on the parts of the plugins scene's window. A picture keeps these when it takes the app's theme. |
| `--site-leaf` | What an agent is doing, on the landing page's board of lanes. |
| `--site-blaze`, `--site-blaze-ink` | The blaze and the ink that reads on it: the bands of running type, the plugin wall's own tile, and the closing band. Both are the same by day and by night. |
| `--site-shade` | The shadow a lifted part of the window casts. |

A picture of acorn is a picture, so it shows acorn's own colors. `pictureScopes()` in
`apps/site/scripts/acornUi.mjs` restates Catppuccin Latte on every specimen and snapshot on a light
page, and Mocha on a dark page and on the stage, with every token derived from them. Inside a picture,
`--accent` is the app's blue again. The site's own marks over a picture use `--site-accent`.

## Text is never muted

Every piece of text on the site is `--text`, on `--bg` or `--bg-subtle`. Inside a picture, the app's
muted text, tone colors, and hover and selection fills fail contrast as text in some of the 12 themes.
For example, `--text-muted` is 2.93:1 in Solarized Light. So the site sets secondary text apart by size,
shows a callout's or a badge's tone in its border beside a word that names it, and marks the current
or hovered row with an accent rule. A primary button is the accent, with `--bg` as its ink, which the
palette pairs at 5.1:1 by day and 8.0:1 by night. On the blaze, every word is `--site-blaze-ink`, at
7.6:1.

## Type sizes

Each kind of text on a marketing page has one size, so two things that do the same job never differ:

| Size | What it sets |
| --- | --- |
| `--site-fs-hero`, `--site-fs-display` | The hero's headline, and a chapter's or the closing band's heading. |
| `--site-fs-h2`, `--fs-xl` | A section's heading, and a step's, a card's, or a list's heading. |
| `--site-fs-lede` | The paragraph under a display heading, the hero's included. |
| `--site-fs-body` | Paragraphs, and the tour's tabs. |
| `--fs-lg` | A card's text, and the controls and links in the header, the buttons, and the footer. |
| `--fs-md` | Mono controls: segmented switches and a frame's tabs. |
| `--fs` | Labels: a footer column's name, a specimen's bar and caption. |

A marketing page's headings draw in Anybody, wide and heavy, and its paragraphs in Hanken Grotesk
([fonts](./design/fonts.md)). A display heading takes `--site-wdth-display` and `--site-wght-display`
on the face's width and weight axes, and `--site-track-display`. The rules name the two faces
themselves and leave the app's font tokens alone, because a picture inside the page reads those
tokens. A docs page's headings stay mono, which runs wide, so they pull in with `--site-track-heading`
and `--site-words-heading`. A frame's title is semibold in sentence case, as a snapshot's is, not the
app's tracked capitals.

## The mark

`apps/site/src/components/Mark.astro` draws the wordmark: the ASCII acorn from the app's empty states,
set as text beside `acorn`. It reads the drawing from
`packages/client-core/src/kit/components/content/Acorn.tsx`, so the two can't differ.
`apps/site/public/favicon.svg` is the same drawing as vector strokes, one path per row of its grid,
so it stays sharp at 16 pixels.

## Appearance

The site picks two of the app's themes, Catppuccin Latte for light and Catppuccin Mocha for dark,
always in the Terminal style pack. The page draws in the site's palette over them, and the pictures in
the themes themselves ([the palette](#the-palette)). The header's light and dark switch (`ThemeToggle.astro`) flips
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
running into it. The stage draws in the site's night colors in both schemes. In light mode the page
reads dark, light, dark. In dark mode the stage is the night's darkest step, `--bg-subtle`, a step
below the page's `--bg`.

An element with the `.site-dark` class takes the dark theme. `darkScope()` in `acornUi.mjs` builds the
class's token block from the app's own: Mocha's colors, and every token the plain `:root` blocks
derive from another, such as `--card-bg: var(--bg)`. A derived token takes its value where it's
declared, so without restating it a dark element would inherit the light page's value. `tokens.css`
then gives the element the site's night colors. Specimens and snapshots inside draw in Mocha. Code
colors follow too, because they're `light-dark()` pairs and `.site-dark` sets `color-scheme: dark`.

`.stage` paints its own background, and a border image's outset carries the band out to the window's
edges without widening the page. Keep the background on the element itself: axe reads text contrast
against an element's background, and it can't see paint from a pseudo-element or a border image. A
hero's picture ends in a negative margin of `--site-overhang`, so the window hangs over the stage's
edge onto the page, and whatever follows the hero starts that far down.

## The landing page's look

The landing page is a film the visitor scrolls through, with acorn's own windows as its cast. Its
markup is `apps/site/src/pages/index.astro`, its look is `apps/site/src/styles/landing.css`, and its
motion is `apps/site/src/scripts/landing/film.ts`. [Motion](./design/motion.md) lists what moves.

- The page passes `bleed` to `Marketing.astro`, so its sections run to the window's edges. Each keeps
  its own width with `.wrap`, up to `--land-width`, and the header lines up with that.
- The page is a plain column first. Every rule outside a `.live` or `.film` block is the finished,
  still page: every window flat, and every list in order. That's what a visitor without script, with
  reduced motion, or on a small screen gets.
- `film.ts` adds `live` to `<html>` when the visitor allows motion, and `film` when the window is
  also at least 60rem wide and 36rem tall. Three scenes pin under `film`: the opening, the deck of
  panes, and the window taken apart.
- A scene is an element with `data-scene`. Each moving part in it plays one set of `@keyframes` laid
  over the scene's whole scroll, 0% to 100%. Where the browser has scroll timelines, the scene is a
  view timeline called `--scene`, and the compositor plays the moves. Elsewhere `film.ts` sets `--p`
  on the scene, how far the scroll has taken it from 0 to 1, and each move is held paused at that
  point. A pinned scene (`data-scene="pin"`) is taller than the window and holds a sticky stage.
- The page reads dark, blaze, page, dark, page, blaze, dark: the opening and the plugins scene are on
  the night stage, and the running type and the closing band are on the blaze.

A new scene needs no script of its own: give it `data-scene`, write its moves as keyframes, and add
each moving part to the lists under **Moves** in `landing.css`. Keep its still state outside `.live`
and `.film`, and check it with reduced motion.

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
| `apps/site/scripts/siteCss.test.mjs` | A color written into the site's styles anywhere but `tokens.css`, as hex, a function, or a name, anything in `tokens.css` but a token, and text set in a token that fails contrast in some theme. The wireframes are left out. |
| `apps/site/scripts/contrast.test.mjs` | A pair of tokens the site sets text or a meaningful rule in that falls under 4.5:1 for text, or 3:1 for a rule: the page's pairs in the palette by day and by night, and a picture frame's pairs in all 12 themes. Add a pair here when a style uses a new one. |
| `apps/site/tests/site.spec.ts` | A theme pick that doesn't restyle the page, a saved theme missing from the first frame, and an axe finding on the design gallery. |
| `apps/site/scripts/acornUi.test.mjs` | A rule in the specimen stylesheet that reaches outside `.acorn-ui` other than a token block, a `.site-dark` block that misses the dark theme's colors or a derived token, and a picture that doesn't draw in Latte on a light page and Mocha on a dark one or the stage. |

## The design lab

These pages build in `pnpm dev:site` and in preview builds only:

| Page | What it shows |
| --- | --- |
| `/lab/design/` | Every marketing component. |
| `/lab/design/docs/` | Every docs component, inside Starlight's chrome. |
| `/lab/design/landing/` | The landing page wireframe, restyled with the components. |
| `/lab/og/<card>/` | One social card alone, at 1200 by 630, for a screenshot. |

Switch between light and dark in the header on any of them.
