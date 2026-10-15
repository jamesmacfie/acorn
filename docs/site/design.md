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

The JetBrains Mono files are the full fonts from the project's release, not a Latin subset, because
the terminal view of a specimen draws box-drawing characters.

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
| `Specimen`, `SnapshotFrame` | A picture of acorn in a frame drawn like a pane, or a whole window. |
| `Snapshot`, `Cells` | A [shell snapshot](./snapshots.md) in its frame, and a terminal's cells, which specimens and snapshots share. |
| `Feature`, `Tour`, `Card` | A numbered feature section, the landing page's tabbed tour, and a card. |
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

## The design lab

These pages build in `pnpm dev:site` and in preview builds only:

| Page | What it shows |
| --- | --- |
| `/lab/design/` | Every marketing component. |
| `/lab/design/docs/` | Every docs component, inside Starlight's chrome. |
| `/lab/design/landing/` | The landing page wireframe, restyled with the components. |
| `/lab/design/social-card/` | The social card alone, at 1200 by 630, for a screenshot. |

Pick a theme and a style pack under **Appearance** on any of them.
