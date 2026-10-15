# Phase 6: design the site from the app

Date: October 15, 2026. Status: done. Needs phase 5. Phases 8, 9, and 10 depend on it.

## Completion note

October 15, 2026. The site is styled from acorn's tokens, fonts, and mark, on marketing pages and docs
pages alike. The header's **Appearance** control offers the 12 themes and 4 style packs and restyles
the site and every specimen with no reload. [The site's design](../../site/design.md) is the reference.
James reviews it at `/lab/design/`, `/lab/design/docs/`, `/lab/design/landing/`, and
`/lab/design/social-card/` in `pnpm dev:site`.

What landed:

- `apps/site/src/styles/site.css`, on the app's tokens, with `--site-*` tokens only for the hero
  headline size, the prose measure, the page width, and section spacing. It maps Starlight's `--sl-*`
  palette and type onto acorn's tokens, so Starlight's own parts follow the theme.
- JetBrains Mono 2.304, regular, bold, and italic, with its OFL license, in `apps/site/public/fonts/`,
  first in `--font-mono`. Inter, Literata, and Nunito come from the app's own `fonts.css`.
- The wordmark, read from the app's `Acorn.tsx`, and `favicon.svg`, the drawing reduced to the cap and
  the outline. The old PNG favicon is gone.
- Components in `apps/site/src/components/`: header, footer, hero, install block, the specimen frame,
  the snapshot frame, feature section, tabbed tour, card, badge, keys, reference table, checkpoint, and
  social card. Tabs and copy buttons share two scripts.
- Starlight's `Header`, `Sidebar`, `PageTitle`, `Footer`, `ThemeProvider`, and `ThemeSelect` replaced.
- The no-flash script, `AppearanceScript.astro`, on every page.
- `scripts/siteCss.test.mjs`, `scripts/contrast.test.mjs`, and Playwright tests for the theme switch,
  the first frame after a reload, and axe on the three gallery pages.

The acceptance checks pass. The contrast test passes in every theme. axe finds nothing serious on the
gallery, outside the specimens' own markup. A preview build passes all 219 Playwright tests, and a
production build writes 17 pages and passes its 24. The restyled landing wireframe weighs 33.9 KB in
total with 4.7 KB of script, against 150 KB and 10 KB.

### Decisions

These follow the recommendations in this file, as [how agents run these phases](./README.md#how-agents-run-these-phases)
says.

- **Mono for long prose.** Docs body text is JetBrains Mono at `--fs-lg`, 15 pixels in Terminal, with
  a 70-character measure. Switching it to Inter is a one-line change in `site.css` if James finds long
  pages tiring.
- **No text in a muted or tone color.** The contrast test found `--text-muted` at 2.93:1 in Solarized
  Light, tone colors as low as 2.31:1 in Catppuccin Latte, and `--text` at 3.89:1 on `--bg-selected`
  in Solarized Dark. So every piece of text is `--text`. Secondary text differs by size and case, a
  callout's or a badge's tone is its border, and a current or hovered row gets an accent rule. A
  primary button is `--bg` on `--text`, because text on the accent fails in Solarized Light. No theme
  changed.
- **Decorative rules aren't checked.** Grey rules that separate sections are decoration, which WCAG
  1.4.11 leaves out, so `--border` isn't in the contrast test. The accent rules that mark state are.
- **Two sidebars.** The Starlight config lists the Docs groups first and the Build plugins groups
  after them, as top-level groups. `Sidebar.astro` shows a page its own half, split by URL, and
  previous and next stay inside it.

### Deviations

- Search, the table of contents, and `MarkdownContent` aren't replaced. Their markup already does the
  job, so `site.css` restyles them. The prose measure applies to the text column's children, and a
  specimen, code block, or table takes the column's full width, with no override.
- The header folds into its menu below 50rem, which is 800 pixels, not 768, so it folds at Starlight's
  own breakpoint and a docs page never shows two menus. On a docs page the sidebar menu carries the
  header's links and the Appearance control.
- The table of contents leaves the page below Starlight's 72rem, 1152 pixels, not the wireframe's
  1280, because Starlight's 52rem content column fits three columns there.
- Callouts, badges, and keys take the kit's shape, but keep their text in `--text`, for the contrast
  reason above. The kit itself still sets tone colors as text inside specimens.
- Code block options moved to `apps/site/ec.config.mjs`, because Starlight's `<Code>` component can't
  read a function from `astro.config.mjs`.
- The specimen stylesheet now loads on every page, because its token blocks are the site's tokens. It
  always keeps the kit's badge and key-cap rules, for the site's own components.
- The footer shows the version the source builds, 1.0.0 from the desktop app's `package.json`,
  because there's no release to read. A `shortcut:` comment in `SiteFooter.astro` marks it.
- The landing wireframe's copy moved into `apps/site/src/lab/wireframes/_landing.ts`, so the wireframe
  and its restyled version read the same words. The wireframes keep their grey-box look.

### What later phases need to know

- Phase 8: a page that fills the `hero` slot of `Marketing.astro` gets the `Hero` component's `h1`
  instead of the layout's. `/lab/design/landing/` is the starting point. The eyebrow there is the
  wireframe's draft.
- Phase 10: replace the footer's source version with the newest release, and add the star count to
  the header's star button at 100 stars or more.
- Phase 15 and later: use `ReferenceTable` for reference rows that need anchors, and `Badge` for host
  support, permission kind, and shipping.
- Phase 19: screenshot `/lab/design/social-card/` at 1200 by 630. It shows one example card and takes
  no parameters.
- A new style that sets text or a rule in a token pair the contrast test doesn't list needs a row in
  `PAIRS` in `scripts/contrast.test.mjs`.
- Pagefind's index exists only in a build, so check search's look with a build and `astro preview`.
  It was checked that way on `/docs/` in this phase, with one result to show.
- The architecture checks still fail on this base exactly as phase 2 recorded. None of the failures
  come from this change. `packages/protocol/src/plugin/handoffs.ts` also fails the format check on the
  base.
- Nothing here needs a deploy, so nothing is left for phase 20.

## Goal

The site looks like acorn, because it's built from acorn's own design tokens, fonts, and mark. A visitor
who opens the app after the site sees the same type, the same rules, and the same themes. The site's
look is built as a gallery of every component, in every theme, which James reviews on the local site
at the end of the run. See [how agents run these phases](./README.md#how-agents-run-these-phases).

## Starting point

- The app's look is set by two independent axes. Themes set color only, in
  `packages/client-core/src/infra/styles/tokens-theme.css`: 12 built-in themes, each 22 palette colors,
  with derived colors computed once. Style packs set shape, type, space, density, and motion: Terminal,
  the default, in `tokens-style.css`, plus Modern, Cozy, and Cute. [Appearance](../../ui-design/appearance.md)
  and [design tokens](../../ui-design/tokens.md) own the rules.
- The Terminal pack is monospace throughout, with square surfaces, 1-pixel rules, chrome bars on
  `--bg-subtle`, and a 13-pixel base size. The default Light theme's accent is near-black, so the app at
  rest is black on white.
- The mark is ASCII art: `packages/client-core/src/kit/components/content/Acorn.tsx` draws it in empty
  states, and the app icon at `apps/desktop/src-tauri/icons/icon.png` is the same drawing.
- The app bundles Inter, Literata, and Nunito under the SIL Open Font License in
  `packages/client-core/src/infra/styles/fonts/`, for the Modern, Cozy, and Cute packs.
- `packages/client-core/src/features/settings/StyleGallery.tsx` is the app's own gallery of every
  primitive in every pack and theme. It's the model for the site's gallery.
- Phase 3 loads the token files globally on the site, so `data-theme` and `data-style` on `<html>`
  drive everything.

## Direction

James confirmed this direction on October 15, 2026. Build to it.

**The only color on the page is the product.** The site's own chrome uses the theme's text, background,
border, and accent tokens. In the default Light theme, that's black on white with grey rules. Color
appears where acorn draws it: in specimens, snapshots, diff markers, status dots, and code. That makes
the product the most colorful thing on every page, and it keeps the site honest about what acorn looks
like.

**Terminal type for chrome, a reading face for long prose.** Headings, navigation, labels, buttons,
code, and specimens use the mono stack, as the Terminal pack does. Docs body text uses the same mono at
15 to 16 pixels, with a 70-character measure. Mono text at that size and measure reads fine, and it's
what hunk and posting do. If James's end review finds long pages tiring, docs body text switches to
Inter, which is already in the repository, and everything else stays mono.

The mono face is JetBrains Mono, self-hosted ([owner decision 6](./README.md#what-the-owner-decides)).
Commit its regular, bold, and italic WOFF2 files and its license to `apps/site/public/fonts/`, declare
them with `@font-face` and `font-display: swap`, and put `"JetBrains Mono"` first in the site's
`--font-mono`, ahead of the app's stack. Don't serve Berkeley Mono.

**The appearance picker is acorn's.** The header has one **Appearance** control, the same shape as the
app's: the 12 themes and the 4 style packs. Picking one restyles the site and every specimen at once,
because both read the same tokens. The default follows the operating system's light or dark preference,
the way the app does. A visitor who picks Cozy gets Literata, and nobody else downloads it, because a
browser fetches a font only when a rule uses it.

**The ASCII acorn is the mark.** The wordmark is the drawing beside the name, `acorn` in lowercase, in
the mono face, set as text, not an image. The favicon is the drawing reduced to the cap and the outline.

**No motion for decoration.** No scroll animations, no parallax, and no fading sections. The only
transitions are the ones the app's motion tokens already define for hover and press. Respect reduced
motion.

## Steps

### 1. Write the site's stylesheet against the app's tokens

Write `apps/site/src/styles/site.css` (new) using only the app's tokens: `--bg`, `--bg-subtle`,
`--text`, `--text-muted`, `--border`, `--accent`, `--font-ui`, `--font-mono`, the `--space-*` and
`--fs-*` scales, the radius roles, and the border recipes. Add site tokens only for what the app has no
token for, such as the hero headline size and the docs measure, and name them `--site-*`.

A rule that hard-codes a color, a font, or a pixel value the app has a token for is a bug. Add a test
that fails on a hex color or a named color in `site.css`, the way `cssHygiene.test.ts` polices the app.

### 2. Design the components

Design and build each one in `/lab/design/`, shown in every theme and pack:

| Component | Notes |
| --- | --- |
| Header | Wordmark, **Docs**, **Build plugins**, **Download**, **Changelog**, search, **Appearance**, and the GitHub star button. Collapses to a menu below 768 pixels. |
| Footer | The sitemap in four columns, the license, and the newest release's version. |
| Hero | Eyebrow in uppercase mono at label size, headline, paragraph, and actions. |
| Install block | Tabs for each install method, a command in mono with a prompt glyph, and a **Copy** button that says **Copied** for two seconds. |
| Specimen frame | Phase 3's component, styled. The desktop view sits in a frame that looks like a pane: chrome bar, divider, and content. The terminal view sits in a frame with the size label, such as `120×36`. |
| Snapshot frame | A whole-window version of the specimen frame for [phase 7](./07-shell-snapshots.md). |
| Feature section | Number, heading, paragraph, docs link, and a picture. Alternate the picture's side only on wide screens. |
| Tabbed tour | The landing page's feature tabs. |
| Code block | Shiki output in the app's two syntax themes, with a file path label and a **Copy** button. Matches the app's `CodeBlock`. |
| Callouts | Note, tip, caution, and danger, mapped to the kit's `Alert` tones so they match the app. |
| Tables | Reference tables with sticky headers and row anchors. |
| Badges | Host support (**Desktop**, **Terminal**, **Reduced**), permission kind (**Enforced**, **Declared**), and plugin shipping (**Built in**, **Installed package**). Reuse the kit's `Badge` styles. |
| Keys | Keyboard keys drawn like the kit's `Kbd`. |
| Steps | Numbered procedures with checkpoints. |
| Sidebar, table of contents, previous and next | Starlight's overridden with these styles. |
| Search palette | Styled as acorn's command palette: a centered panel, a filter input, and grouped rows. |
| Cards | For the features index and the plugins directory. |
| Social card template | 1200 by 630 pixels, for [phase 19](./19-search-and-agent-outputs.md). |

Reuse the kit's look by reusing its classes where you can: a site callout can be a `div.acorn-ui` with
the kit's `Alert` markup, styled by the scoped kit stylesheet from phase 3. That's less CSS to write,
and it can't drift from the app.

### 3. Replace Starlight's look

Override Starlight's `Header`, `Sidebar`, `PageTitle`, `TableOfContents`, `Pagination`, `Footer`,
`Search`, and `ThemeSelect` components with acorn's, the way hunk's config does. Replace the theme
select with the **Appearance** picker. Override `MarkdownContent` so a specimen can break out of the text
column.

### 4. Stop the flash

Theme and pack choices live in `localStorage`. A small inline script in `<head>` sets `data-theme` and
`data-style` before first paint, and the token files' operating system preference block covers a
visitor with no choice saved. This is the same reason `tokens-theme.css` has that block in the app.

### 5. Check contrast in every theme

Write a test that computes the contrast of every pair the site uses, such as body text on background
and muted text on subtle background, in all 12 themes. Body text must reach 4.5 to 1, and large text and
rules 3 to 1. The app's themes were tuned for the app, so expect a few pairs to fail. Fix them with a
different token pairing on the site, not by changing a theme.

## Out of scope

Landing copy and page content. The gallery uses real copy where it exists and placeholders elsewhere.

## Acceptance

- `/lab/design/` shows every component above in all 12 themes and 4 packs.
- Switching theme or pack restyles the whole site and every specimen with no reload, and a reload shows
  no flash of another theme.
- The contrast test passes in every theme.
- axe reports no violations on the gallery.
- `site.css` contains no hard-coded color.
- The landing page wireframe, restyled, stays inside its budget.

## Risks

Twelve themes and four packs make 48 combinations. The token split means the gallery doesn't need a
screenshot matrix, the same argument `docs/ui-design/tokens.md` makes for the app. Review the default
pairs closely, Light and Dark with Terminal, and spot-check the rest.
