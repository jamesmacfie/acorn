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

## How it works

`pnpm --filter @acorn/site specimens` runs two generators, in this order:

1. `apps/site/scripts/specimens.test.ts` runs each specimen in-process with `solidTree` and a recording
   remote root, and writes the batches to `apps/site/src/generated/specimens/<id>.tree.json`. Those are
   the batches a plugin's worker would send. It then delivers them to client-core's `TreeHost` under
   jsdom, waits for the HTML to stop changing, and writes `<id>.html`.
2. `apps/tui/src/kit/specimens.test.tsx` reads each `<id>.tree.json`, draws the batches through the
   terminal's `TreeHost` at the specimen's size, and writes `<id>.cells.json`. Each run of cells records
   its text, its attributes, and the palette slot that colored it, not a color.

Without `UPDATE_SPECIMENS=1`, both compare instead of writing, and fail on any difference. The site
workflow runs the comparison, so a kit change that moves markup fails until someone regenerates the
pictures, looks at them, and commits them. The terminal generator also runs in the terminal client's
own test suite.

The terminal generator lives in `apps/tui` because the cell renderer does, and it reads and writes the
site's files by path. That's the one place an app touches another app's files. Apps still never import
each other. Moving the cell renderer into a package would remove the exception, at far more cost.

The output is the same on every machine. The generator renumbers node ids and element ids from the
specimen id, pins the clock to January 15, 2026, and runs with the UTC time zone and the `en_US` locale.
The HTML keeps no scripts and no event handler attributes. An inline style keeps only custom properties
and the geometry a component computes for itself: `transform`, `width`, `height`, `min-width`, `top`,
`left`, `position`, `grid-template-columns`, and `visibility`. Input values and checked boxes are copied
into attributes, because a mounted control holds them as properties.

## The specimen stylesheet

`apps/site/scripts/acornUi.mjs` builds `virtual:acorn-ui.css` on every build and dev start, from the
sheets `packages/client-core/src/infra/styles/styles.css` imports. It leaves out `fonts.css`, and the
manifest's own rules that hide scrollbars.

- Token blocks, which are `:root` rules that declare only custom properties, stay global. So
  `data-theme` and `data-style` on `<html>` drive every specimen.
- Every other rule applies only inside `.acorn-ui`. A rule for `html` or `body` moves onto `.acorn-ui`.
  A style pack's `:root[data-style='…']` qualifier stays on the root.
- A rule that matches nothing in the committed specimens' HTML is dropped. A rule for a state, such as
  `:hover`, stays when the element it styles exists.

`apps/site/scripts/acornUi.test.mjs` fails if any rule applies outside `.acorn-ui`. With the ten seed specimens,
the stylesheet is 35 KB, or 6.1 KB compressed with Brotli, against 128 KB for `primitives.css` alone.
The gallery page, with all ten specimens, weighs 29.9 KB compressed, inside the 100 KB docs budget.

The terminal view colors each slot with the same theme token the terminal takes from a theme, so it
follows the theme too: `--text`, `--text-muted`, `--accent`, `--state-ok`, `--state-warn`, `--state-bad`,
`--bg-hover`, and `--bg-selected`.

## What jsdom can't draw honestly

jsdom has no layout, so a component that measures itself draws its unmeasured state:

- `Graph` fits its view to the canvas it measures, and jsdom measures nothing, so the graph draws
  unscaled from its top-left corner. Keep a graph specimen to two ranks so it fits the canvas's 16rem
  minimum height.
- `CodeBlock` highlights with Shiki asynchronously. The generator waits for the HTML to stop changing,
  but none of the seed specimens draws a code block, so that wait is untested.

`Rows` can't be drawn from a tree at all, because its children are a render function, which can't cross
to the host. Plugins draw lists as `Row` nodes inside a `ListColumn`, and so do specimens.
