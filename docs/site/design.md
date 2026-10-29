# The public site's design

This page covers how `apps/site` looks and why: the stylesheet, the mark, the light and dark
themes, the components, Starlight's replaced parts, and the checks that hold the design to the app.
Read it before you style a page or add a component. [The public site](../site.md) covers running and
deploying it, and [marketing copy](./marketing-copy.md) covers how the marketing pages read.

Two topics have pages of their own:

- [Fonts](./design/fonts.md): the faces, the JetBrains Mono subsets, and the preloads.
- [Lighthouse](./design/lighthouse.md): the landing page's target, the command, and its scores.

The site is built from acorn's own design tokens, under the app's token names, with colors of its
own. The page draws in the site's palette: a violet-black night with near-white ink, one brass
accent, the color of an acorn's shell, and one rose verb in the landing page's headline. By day the
page turns violet-white and the brass deepens to bronze. A picture of acorn, a specimen or a
snapshot, draws in the app's own theme instead, Catppuccin Latte or Mocha, so it shows the colors
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
beat them. Element rules skip anything inside `.acorn-ui`, so a specimen draws exactly as the app draws
it.

Components with their own look keep it in a `<style>` block beside their markup, written to the same
rules.

## The palette

`apps/site/src/styles/tokens.css` sets the site's colors under the app's token names, such as `--bg`,
`--text`, and `--accent`, so `site.css` and Starlight's mapping read them as they always have. Its
day block sits on `<html>`. Its night block sits on `<html>` in dark mode and on every `.site-dark`
element. `html:root:root` outweighs the app's `:root[data-theme="…"]` blocks whichever sheet loads
first. Three more of its tokens are the site's alone:

| Token | What it colors |
| --- | --- |
| `--site-accent`, `--site-accent-ink` | Marks the site draws over a picture, such as the outlines on the plugins chapter's window. A picture keeps these when it takes the app's theme. |
| `--site-verb` | The hero's verb, rose, once, on the landing page. |
| `--site-glyph-*` | The oak sprig over a stage: four violet steps and three brass ones, each a little lighter than the stage. |

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
palette pairs at 5.3:1 by day and 9.9:1 by night.

## Type sizes

Each kind of text on a marketing page has one size, so two things that do the same job never differ:

| Size | What it sets |
| --- | --- |
| `--site-fs-hero`, `--site-fs-display` | The hero's headline, and a chapter's or the closing band's heading. |
| `--site-fs-h2`, `--fs-xl` | A section's heading, and a step's, a card's, or a list's heading. |
| `--site-fs-lede` | The paragraph under a display heading, the hero's included. |
| `--site-fs-body` | Paragraphs, and the tour's tabs. |
| `--fs-lg` | Secondary words in Inter: a card's text and the plugin wall's names. |
| `--fs-md` | Mono controls and links: the header, buttons, segmented switches, and the footer's links. Mono runs wider than Inter, so it sits a pixel under `--fs-lg`. |
| `--fs` | Labels: a footer column's name, a specimen's bar and caption. |

Mono runs wide, and its space is as wide as a letter, so headings pull in. Every heading takes
`--site-track-heading` and `--site-words-heading`, and a display heading takes the stronger
`--site-track-display` and `--site-words-display`. A lede in Inter takes `--site-track-lede`. A
frame's title is semibold in sentence case, as a snapshot's is, not the app's tracked capitals.

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

Every stage's hero carries an oak sprig drawn in mono glyphs, behind its words
(`apps/site/src/scripts/glyphField.ts`). Its twig and the leaves' midribs are lines of slashes and
dashes, the blades are a stipple, and the acorns are shaded in brass with scaly caps. A task branch
from the site's fixture runs along the twig, and on the landing page it's `retry-failed-webhooks`, the
task in the hero's window. Each page grows its own sprig from its title. The field fades near the
words, so they stay clear, and a pointer that brushes the sprig sets it swaying. It stays empty
without script, holds still under reduced motion, and hides below 48rem, where the words fill the
stage.

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
| `Hero` | The stage at the top of a page: headline, paragraph, the oak sprig behind them, and an optional link back to the page's section (`crumb`), actions, and picture. `highlight` sets the end of the headline apart as the hero's verb, in rose over a rule that draws in once. A marketing page puts it in the layout's `hero` slot, and the layout draws one with the page's title when there's none. With `split`, the paragraph and actions sit beside the headline on a wide screen, so the picture starts higher. |
| `InstallBlock` | A tab per install method, its commands after a prompt, and **Copy**. |
| `Specimen`, `SnapshotFrame` | A picture of acorn in a frame drawn like a pane, or a whole window or a phone's screen with rounder corners and a deeper shadow. Neither draws a desktop's window buttons. A specimen has a bar with its name and a caption under it. It switches between its desktop and terminal views with tabs, or shows them side by side with `both`. A snapshot has no bar, and its caption is for screen readers only, so the picture speaks for itself. Either takes a `caption` that replaces its own. |
| `Snapshot`, `Cells` | A [shell snapshot](./snapshots.md) in its frame, and a terminal's cells, which specimens and snapshots share. |
| `Feature`, `Tour`, `Card` | A feature section, the landing page's tour, and a card. A `.features` list already gives the order, so the sections carry no numbers. `Feature` takes `level={3}` under a section's own heading. A `Feature` with no picture keeps to the reading measure. The tour's tabs run down the side on a wide screen, beside the selected tab's words and window. On a marketing page a card is rounder, and its edge takes the accent under the pointer. |
| `DownloadPage`, `BuildFromSource` | The download page, in `apps/site/src/layouts/`, for a release or for none, and its Build from source section. `src/scripts/platform.ts` moves the visitor's platform first. |
| `FeaturePage` | The layout of a feature page, in `apps/site/src/layouts/`: the title and sentence from `apps/site/src/features.ts`, a picture, the page's sections, **In the terminal**, related features, and **Get started**. A new feature page needs an entry in `features.ts`, which the features index reads too. |
| `Badge`, `Keys` | The kit's own `Badge` and `Kbd` markup, with the text kept in `--text`. |
| `ReferenceTable`, `Checkpoint` | A table with a sticky header and an anchor per row, and a step's check. |
| `SocialCard` | The 1200 by 630 picture a shared link shows ([social cards](./agent-outputs.md#social-cards)). |
| `Search` | The header's search, drawn with the command palette's markup ([search](./agent-outputs.md#search)). |

A primary button is the accent, with `--bg` as its ink, and `data-size="lg"` makes it a page's main
action. A page has one. `.segmented` turns a tab strip into buttons in a tray, the selected one
inverse, as the hero's desktop and terminal switch does. A heading is one color. The hero's verb is the
only words set apart, and only on the landing page.

A label, such as a footer column's name or a changelog entry's date, is mono, a step smaller, in
sentence case and untracked. The app's own labels are uppercase and tracked in the Terminal pack, which
suits a dense pane, so the docs' sidebar and tables keep them.

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
shows them in place. A primary button lifts on hover, a link's underline turns from a rule to the
accent, and an FAQ answer slides open where the browser can animate to `height: auto`
(`interpolate-size`).

Three moments are the site's own. The rule under the hero's verb draws in once, after the headline
lands. The oak sprig over a stage comes in from where its twig enters, over a second and a half, and
sways where a pointer brushes it, settling in about two seconds. The closing acorn on the landing page
tips its cap when the pointer or the keyboard reaches **Get acorn**.

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
