# Specimens

This page covers specimens on the public site: adding one, how the generators draw and check it, the
stylesheet that styles it, and what jsdom can't draw. [The public site](../site.md) covers the rest of
`apps/site`.

A _specimen_ is a picture of plugin UI that acorn draws itself. Its source is plugin tree code, and a
generator runs it through both hosts and commits what each one drew. The site shows the desktop's HTML,
styled by the app's own stylesheets, and the terminal's cells, colored by the current theme. Nothing on
the site runs the specimen's code.

## Add a specimen

1. Create `apps/site/specimens/<group>/<id>.tsx`. Write it the way a plugin writes a tree, against
   `acorn-plugin-sdk/remote`. Export the component as the default, and a `meta` object typed
   `SpecimenMeta` from `apps/site/specimens/specimen.ts`, with a title, a caption, the terminal size in
   cells, and the desktop width in pixels. The file name is the id, and it must be unique across groups.
2. Run `UPDATE_SPECIMENS=1 pnpm --filter @acorn/site specimens`.
3. Look at it on `/lab/specimens/` in `pnpm dev:site`, in a few themes and style packs.
4. Draw it on a page. A docs page that draws one has to be `.mdx`. From
   `apps/site/src/content/docs/docs/<group>/<page>.mdx`, that's:

   ```mdx
   import Specimen from '../../../../components/Specimen.astro'

   <Specimen id="buttons" />
   ```

Static means static. A specimen that has to show a state, such as a selected row, sets it in its source.
Hover and focus styles still work, because they're CSS.

A component page shows a specimen's source as its example with `<SpecimenCode id="…" />`, so keep a
specimen's code the way a plugin would write it. The specimens a component page uses live in
`apps/site/specimens/components/`.

## Add a layout picture

A layout isn't a tree, so its picture is an entry in `apps/site/specimens/layouts.json`: the layout's
name, its regions, a title, a caption, the terminal size, the desktop width, and any `tabs`, `steps`, or
`current` the layout takes. Each generator mounts its own host's layout component, `LAYOUTS` from
`@acorn/client-core/host/layouts` and from `apps/tui/src/layouts`, with every region holding its name.
The `<id>.tree.json` records the layout in place of batches, so `<Specimen>` draws it like any other.

## How it works

An example plugin's tree is recorded by the examples package first, and then drawn like any other
specimen ([pictures on a guide](./plugin-guides.md#pictures-on-a-guide)). For the specimens in
`apps/site/specimens/`, `pnpm --filter @acorn/site specimens` runs two generators, in this order. Its
bare `vitest run` also runs the plugin reference's manifest example check.

1. `apps/site/scripts/specimens.test.ts` runs each specimen in-process with `solidTree` and a recording
   remote root, and writes the batches to `apps/site/src/generated/specimens/<id>.tree.json`. Those are
   the batches a plugin's worker would send. It then delivers them to client-core's `TreeHost` under
   jsdom, waits for the HTML to stop changing, and writes `<id>.html`. A `Modal` draws through a portal
   into the document's body, so the HTML is the host's markup followed by any portal's. On the site a
   specimen draws a modal's backdrop in its frame, not over the page.
2. `apps/tui/src/kit/specimens.test.tsx` reads each `<id>.tree.json`, draws the batches through the
   terminal's `TreeHost` at the specimen's size, and writes `<id>.cells.json`. Each run of cells records
   its text, its attributes, and the palette slot that colored it, not a color.

Without `UPDATE_SPECIMENS=1`, both compare instead of writing, and fail on any difference. The site
workflow runs the comparison, so a kit change that moves markup fails until someone regenerates the
pictures, looks at them, and commits them. The terminal generator also runs in the terminal client's
own test suite.

The terminal generator lives in `apps/tui` because the cell renderer does, and it reads and writes the
site's files by path. The sidebar generator below does the same from `apps/extension`. Those are the
two places an app touches another app's files. Apps still never import each other.

The output is the same on every machine. The generator renumbers node ids and element ids from the
specimen id, pins the clock to January 15, 2026, and runs with the UTC time zone and the `en_US` locale.
The HTML keeps no scripts and no event handler attributes. An inline style keeps only custom properties
and the geometry a component computes for itself: `transform`, `width`, `height`, `min-width`, `top`,
`left`, `position`, `grid-template-columns`, and `visibility`. Input values and checked boxes are copied
into attributes, because a mounted control holds them as properties. An image from another origin, such
as a GitHub avatar, loses its `src`, because a site page loads nothing from another origin, so it draws
as its empty frame.

## The browser extension's panel

The extension's panel isn't a plugin tree, so its pictures are a third generator.
`apps/extension/src/sidebar/pictures.test.tsx` mounts the real sidebar under jsdom against a scripted
Node, the way the extension's own sidebar tests do, for each scene: pairing, Home, a conversation, the
handoff card, a plugin's panel, and a Linear issue's task and a conversation from that issue's page. It
writes the markup to `apps/site/src/generated/sidebar/<id>.html`, inside the
`.snapshot-sidebar` wrapper the panel's own sheet is scoped to, and copies a text box's value into its
markup. `pnpm --filter @acorn/site specimens` runs it last, with the same `UPDATE_SPECIMENS=1` switch,
and the extension's test suite runs it too, so a sidebar change fails until someone regenerates the
pictures. `SidebarPicture.astro` draws one at the panel's width, and holds each scene's title and
caption. To add a scene, add a test that calls `picture()`, and an entry in that component.

## The specimen stylesheet

`apps/site/scripts/acornUi.mjs` builds `virtual:acorn-ui.css` on every build and dev start, from the
sheets `packages/client-core/src/infra/styles/styles.css` imports, then every other stylesheet in
client-core, which features import beside their components. It leaves out `fonts.css`, which the
site's own stylesheet imports, and the manifest's own rules that hide scrollbars. Every page loads it,
because the token blocks in it are the site's tokens too ([design](../site.md#design)). The same sheet
styles [shell snapshots](./snapshots.md#on-the-site).

- Token blocks, which are `:root` rules that declare only custom properties, stay global. So
  `data-theme` and `data-style` on `<html>` drive every specimen.
- Every other rule applies only inside `.acorn-ui`. A rule for `html` or `body` moves onto `.acorn-ui`.
  A style pack's `:root[data-style='…']` qualifier stays on the root.
- A rule that matches nothing in the committed specimens', snapshots', and sidebar pictures' HTML is
  dropped. A rule for a state, such as
  `:hover`, stays when the element it styles exists. The rules in `SITE_KIT` always stay, because the
  site draws the kit's markup outside any specimen: `.ui-badge` and `.ui-kbd` for the `Badge` and `Keys`
  components, and the input, overlay, and palette rules for [search](./agent-outputs.md).

`apps/site/scripts/acornUi.test.mjs` fails if any rule applies outside `.acorn-ui`. On October 16, 2026,
with 95 committed specimens, the stylesheet was 100 KB, or 15 KB compressed with Brotli, and every
docs page was inside the 100 KB docs budget that `apps/site/scripts/budget.mjs` checks.

The terminal view colors each slot with the same theme token the terminal takes from a theme, so it
follows the theme too: `--text`, `--text-muted`, `--accent`, `--state-ok`, `--state-warn`, `--state-bad`,
`--bg-hover`, and `--bg-selected`.

## What jsdom can't draw honestly

jsdom has no layout, so a component that measures itself draws its unmeasured state:

- `Graph` fits its view to the canvas it measures, and jsdom measures nothing, so the graph draws
  unscaled from its top-left corner. Keep a graph specimen to two ranks so it fits the canvas's 16rem
  minimum height.
- `CodeBlock` highlights with Shiki asynchronously. The generator waits for the HTML to stop changing,
  but the `code-block` specimen draws a command with no language, which isn't highlighted, so that wait
  is untested.

`Rows` can't be drawn from a tree at all, because its children are a render function, which can't cross
to the host. Plugins draw lists as `Row` nodes inside a `ListColumn`, and so do specimens. `Menu`,
`Popover`, `Sections`, `SplitHandle`, and `DiffPane` can't either, for the same reason: a prop each one
needs is a function. Their component pages show what a tree uses instead.
