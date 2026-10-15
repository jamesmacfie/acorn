# The public site's design

This page covers how `apps/site` looks and why: the stylesheet, the fonts, the mark, the Appearance
control, the components, Starlight's replaced parts, and the checks that hold the design to the app.
Read it before you style a page or add a component. [The public site](../site.md) covers running and
deploying it.

The site is built from acorn's own design tokens. The only color on a page is the color acorn draws:
the site's chrome uses the theme's text, background, border, and accent tokens, so in the default Light
theme it's black on white with grey rules. A visitor who picks a theme or a style pack restyles the
site and every specimen at once, because both read the same tokens.

## The stylesheets

Every page loads two sheets, in this order:

1. `virtual:acorn-ui.css`, which `apps/site/scripts/acornUi.mjs` builds from the app's own sheets. Its
   token blocks set the tokens on `<html>`, and its other rules style specimens inside `.acorn-ui`
   ([specimens](./specimens.md#the-specimen-stylesheet)).
2. `apps/site/src/styles/site.css`, the site's own sheet.

Starlight loads both through `customCss` in `apps/site/astro.config.mjs`. A marketing page loads them in
`apps/site/src/layouts/Marketing.astro`.

`site.css` uses the app's tokens for every color, font, space, size, radius, border, shadow, and
duration. A value the app has no token for is a `--site-*` token at the top of the file, such as the
hero headline size and the 70-character prose measure. The sheet also points Starlight's own
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

## Fonts

| Face | Where it comes from | Used by |
| --- | --- | --- |
| JetBrains Mono 2.304 | `apps/site/public/fonts/`, regular, bold, and italic, with its license in `OFL.txt` | Every pack's `--font-mono`, and the Terminal pack's `--font-ui` |
| Inter, Literata, Nunito | The app's own files, through `@acorn/client-core/infra/styles/fonts.css` | The Modern, Cozy, and Cute packs |

`site.css` puts JetBrains Mono first in `--font-mono`, ahead of the app's fallback stack. A browser
fetches a face only when a rule uses it, so a visitor who never picks Cozy never downloads Literata.

The JetBrains Mono files are subsets, about 20 KB each against 90 KB for the release's files, because
a phone on a slow connection waits for them before it draws the page's text. Each keeps Latin-1, the
punctuation and symbols the site writes, arrows, the Mac key symbols, and the box-drawing, block, and
shape ranges the terminal view of a specimen draws. They leave out the programming ligatures, which
the app doesn't draw either. A character outside the subset falls back to the next face in
`--font-mono`. `Marketing.astro` preloads the regular and bold faces, the two the first screen uses.

To rebuild them, take the `.woff2` files from the JetBrains Mono 2.304 release and run this for each of
`Regular`, `Bold`, and `Italic`:

```sh
uvx --from fonttools --with brotli pyftsubset JetBrainsMono-Regular.woff2 \
  --unicodes="U+0020-007E,U+00A0-00FF,U+0131,U+0152-0153,U+02C6,U+02DA,U+02DC,U+2010-2027,U+2030-203A,U+2044,U+20AC,U+2122,U+2190-2199,U+21A9,U+21B5,U+21D0-21D3,U+21E7,U+2212,U+2303-2304,U+2318,U+2325,U+232B,U+238B,U+23CE,U+2500-25FF,U+2713,U+2715,U+2717,U+2726" \
  --layout-features="ccmp,locl,mark,mkmk" --flavor=woff2 \
  --output-file=apps/site/public/fonts/JetBrainsMono-Regular.woff2
```

Add a range when the site starts writing a character outside it.

## The mark

`apps/site/src/components/Mark.astro` draws the wordmark: the ASCII acorn from the app's empty states,
set as text beside `acorn`. It reads the drawing from
`packages/client-core/src/kit/components/content/Acorn.tsx`, so the two can't differ.
`apps/site/public/favicon.svg` is the same drawing reduced to the cap and the outline.

## Appearance

The header's **Appearance** control offers the app's 12 themes and 4 style packs, with the app's labels,
read from `features/settings/builtInThemes.ts` and `features/settings/uiStyles.ts` in client-core. A
theme's choice of light or dark comes from `--is-dark: 1` in its token block.

`apps/site/src/components/AppearanceScript.astro` runs inline in `<head>`. It reads the
saved choice from `localStorage` under `acorn-theme` and `acorn-style` and sets `data-theme`,
`data-style`, and `data-color-scheme` on `<html>` before the first frame, so a reload never flashes
another theme. With no theme saved, `data-theme` stays off and the token files' system preference
block picks light or dark, as it does in the app. Code blocks read `data-color-scheme` to pick
github-light or github-dark (`apps/site/ec.config.mjs`).

## Components

The components are in `apps/site/src/components/`. Each has a comment that says what it draws.

| Component | What it is |
| --- | --- |
| `SiteHeader`, `SiteFooter` | The header and the footer on every page. Below 50rem the header's links fold into a menu. |
| `Hero` | Eyebrow, headline, paragraph, actions, and a picture. A marketing page puts it in the layout's `hero` slot. |
| `InstallBlock` | A tab per install method, its commands after a prompt, and **Copy**. |
| `Specimen`, `SnapshotFrame` | A picture of acorn in a frame drawn like a pane, or a whole window. A specimen switches between its desktop and terminal views with tabs, or shows them side by side with `both`. |
| `Snapshot`, `Cells` | A [shell snapshot](./snapshots.md) in its frame, and a terminal's cells, which specimens and snapshots share. |
| `Feature`, `Tour`, `Card` | A numbered feature section, the landing page's tabbed tour, and a card. `Feature` takes `level={3}` under a section's own heading. |
| `Badge`, `Keys` | The kit's own `Badge` and `Kbd` markup, with the text kept in `--text`. |
| `ReferenceTable`, `Checkpoint` | A table with a sticky header and an anchor per row, and a step's check. |
| `SocialCard` | The 1200 by 630 picture a shared link shows. |

Callouts are Starlight's asides, restyled in `site.css` as the kit's banner `Alert`. Steps are
Starlight's `<Steps>`. Tabs and copy buttons share two small scripts in `apps/site/src/scripts/`.

## Starlight's replaced parts

`apps/site/src/components/starlight/` replaces Starlight's `Header`, `Sidebar`, `PageTitle`, `Footer`,
`ThemeProvider`, and `ThemeSelect`. The `Footer` draws previous and next with the site's own
`Pagination`. Search, the table of contents, and the prose column keep Starlight's markup and take
the site's look from `site.css`.

There are two sidebars. A page under `/docs/build-plugins/` or `/docs/components/` sees the Build
plugins groups, and every other docs page sees the rest (`isBuildPath` in `apps/site/src/nav.ts`).
Previous and next stay inside the page's own sidebar.

## Checks

| Check | What it fails on |
| --- | --- |
| `apps/site/scripts/siteCss.test.mjs` | A color written into the site's styles, as hex, a function, or a name, and text set in a token that fails contrast in some theme. The wireframes are left out. |
| `apps/site/scripts/contrast.test.mjs` | A pair of tokens the site sets text or a meaningful rule in that falls under 4.5:1 for text, or 3:1 for a rule, in any of the 12 themes. Add a pair here when a style uses a new one. |
| `apps/site/tests/site.spec.ts` | A theme pick that doesn't restyle the page, a saved theme missing from the first frame, and an axe finding on the design gallery. |

## Lighthouse

The landing page has to score at least 98 for performance on mobile and 100 for accessibility. Check it
by hand against a production build served by `astro preview`, with Lighthouse's default mobile settings:

```sh
pnpm --filter @acorn/site build
pnpm --filter @acorn/site exec astro preview --ignore-lock --host 127.0.0.1 --port 4339
npx lighthouse http://127.0.0.1:4339/ --form-factor=mobile --only-categories=performance,accessibility
```

| Date | Page | Performance | Accessibility | First paint | Largest paint |
| --- | --- | --- | --- | --- | --- |
| October 16, 2026 | The landing page as phase 8 built it | 99 | 100 | 1.7 s | 1.8 s |

Lighthouse 13.5 simulates a slow phone connection, and on it the fonts cost the most. With the full
JetBrains Mono files the landing page scored 90, and a page with almost no content scored 95. The site
serves subsets of the fonts, and marketing pages preload the regular and bold faces
([fonts](#fonts)). `astro preview` serves gzip, so the landing page's HTML arrives as
73 KB there, against 27 KB with Brotli.

## The design lab

These pages build in `pnpm dev:site` and in preview builds only:

| Page | What it shows |
| --- | --- |
| `/lab/design/` | Every marketing component. |
| `/lab/design/docs/` | Every docs component, inside Starlight's chrome. |
| `/lab/design/landing/` | The landing page wireframe, restyled with the components. |
| `/lab/design/social-card/` | The social card alone, at 1200 by 630, for a screenshot. |

Pick a theme and a style pack under **Appearance** on any of them.
