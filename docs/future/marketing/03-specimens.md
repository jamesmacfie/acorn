# Phase 3: draw real UI on the site

Date: October 15, 2026. Status: proposed. Needs phase 2. Phases 7, 15, 16, 17, and 18 depend on it.

## Goal

A docs page can show any piece of plugin UI as acorn draws it, on the desktop and in the terminal,
from one source, in any of acorn's themes, with no screenshot. When the kit changes, a test fails until
someone regenerates the pictures and looks at them.

This is the site's central technical bet. It turns "a plugin's tree draws on both hosts" from a claim
into something every example shows. Start with the spike in step 1, and don't build the rest until the
spike works.

## Starting point

- Both hosts draw a remote tree from a stream of mutations. The desktop's
  `packages/client-core/src/host/tree/TreeHost.tsx` takes a `TreeTransport` that delivers batches and
  mounts the kit's own components from `packages/client-core/src/host/tree/components.ts`. The
  terminal's `apps/tui/src/plugins/TreeHost.tsx` applies the same batches through the shared rules in
  `packages/client-core/src/host/tree/treeState.ts`.
- A plugin writes its tree with `acorn-plugin-sdk/remote`, whose Solid adapter is
  `packages/plugin-sdk/src/remote/solid.ts`.
- client-core's `hosts` test project renders components under jsdom. `apps/tui/src/kit/render.tsx`
  draws one node to a cell buffer and reads back its lines and colored runs, which is how
  `apps/tui/src/kit/kit.test.tsx` checks every kit node.
- `pnpm --filter @acorn/tui capture` already prints a terminal frame with no TTY
  (`apps/tui/src/capture.tsx`).
- `packages/client-core/src/infra/styles/styles.css` imports the token files, `base.css`, `shell.css`,
  `primitives.css`, the style packs, and the feature sheets. In Vitest, a `.css?raw` import comes back
  empty, so read sheets with `readFileSync`.
- `packages/client-core/src/infra/styles/themeCellTokens.json` maps each theme to its terminal colors.
- `references/opentui/packages/web/scripts/generate-doc-visuals.ts` writes terminal frames to committed
  JSON, and its test regenerates and compares them. That's the model for the terminal half.
- Apps never import each other. The site can import `@acorn/client-core` and `acorn-plugin-sdk`, but
  not `apps/tui`.

## The pipeline

A specimen goes through four steps:

1. **Source.** `apps/site/specimens/<group>/<id>.tsx` (new) is plugin tree code written against
   `acorn-plugin-sdk/remote`, plus metadata: a title, a caption, a terminal size in columns and rows, and
   a desktop width.
2. **Record.** The site runs the tree in-process against a recording transport and writes its mutation
   batches to `apps/site/src/generated/specimens/<id>.tree.json` (new). That file is exactly what a
   plugin would send.
3. **Draw.** Two generators read the recorded batches:
   - The desktop generator, in `apps/site`, feeds them to client-core's `TreeHost` under jsdom through
     a fake transport, waits for the tree to settle, and writes the mounted HTML to
     `apps/site/src/generated/specimens/<id>.html` (new).
   - The terminal generator, in `apps/tui`, reads the same batches by file path, draws them through the
     terminal `TreeHost` at the declared size, and writes the cells to
     `apps/site/src/generated/specimens/<id>.cells.json` (new). Each run records its text, its
     attributes, and its color as a palette slot, not an RGB value, so the site can recolor it for any
     theme.
4. **Check.** Both generators run in compare mode in CI and fail when the committed file differs.
   `UPDATE_SPECIMENS=1` rewrites them, the way `UPDATE_PLUGIN_SCHEMA=1` rewrites the manifest schema.

The terminal generator lives in `apps/tui` because the cell renderer does, and it writes into
`apps/site` by path. That's a file read and write across apps, not an import, so the boundary rule
holds. Record it as a deliberate exception in `docs/site.md` (new). Moving the cell renderer into a
package would remove the exception, and it's far more work than this programme needs.

## Steps

### 1. Spike, two days at most

Prove one specimen end to end on both hosts: a `Stack` holding a `Button`, a `Badge`, and a short
`Rows` list. Answer three questions and record the answers here:

1. Can the SDK's remote adapter run in-process, outside a worker, against a recording transport? If
   not, what's the smallest seam that lets it?
2. Does client-core's `TreeHost` mount and settle under jsdom with a fake transport, with no worker
   host?
3. Does the terminal `TreeHost` draw recorded batches through `renderCells` with no Node connection?

If question 1 fails and the fix is large, fall back to writing each specimen as kit JSX rendered
directly by each host. That's worse, because the example stops being plugin code, so only take it if the
recording path costs more than a week.

### 2. Make the output deterministic

The same source must produce the same bytes on every machine:

- Replace generated element IDs with stable ones derived from the specimen ID and position.
- Strip every `on*` attribute, every `<script>`, and every inline `style` except the runtime-set custom
  properties `docs/ui-design/tokens.md` lists.
- Pin the date, the locale, and the time zone for anything that formats a timestamp.
- Wait for asynchronous content to settle. `CodeBlock` highlights with Shiki asynchronously, and
  components that measure themselves with `ResizeObserver` draw differently under jsdom. Give jsdom a
  fixed viewport, and list any component that can't draw honestly there in the site's internal page.

### 3. Scope the app's stylesheets

The site uses acorn's tokens for its own chrome too ([phase 6](./06-visual-design.md)), so split the
stylesheets in two:

- **The token files** (`tokens-invariant.css`, `tokens-style.css`, `tokens-theme.css`, and the style
  pack files) load globally, unchanged. `data-theme` and `data-style` on the site's `<html>` drive the
  site and every specimen at once.
- **Everything else** (`base.css`, `primitives.css`, `shell.css`, `diff.css`, and the feature sheets a
  specimen needs) is rewritten at build so every selector applies only inside an element with the class
  `acorn-ui`. Element rules in `base.css` that target `html` or `body` move onto `.acorn-ui`. The global
  scrollbar rules are dropped.

Do this in a small build step that reads the source sheets from `packages/client-core`, so a stylesheet
change reaches the site on the next build with no copy step. Then prune selectors that no committed
specimen or snapshot uses. Write a test that fails if any rule in the output applies outside
`.acorn-ui`.

### 4. Draw specimens on a page

Add an `<Specimen id="…" />` Astro component. It draws:

- A frame with **Desktop** and **Terminal** tabs. The tabs need a few lines of script for proper tab
  semantics. With scripting off, both views show, one above the other.
- The desktop view: the committed HTML inside a `div.acorn-ui`.
- The terminal view: a `<pre>` of spans, one per run. Each span takes a class for its palette slot and
  its attributes, such as bold or reverse. The site maps palette slots to colors per theme from
  `themeCellTokens.json`, so the terminal view follows the site's theme picker like the desktop view
  does. A size label such as `80×24` sits on the frame.
- A caption, and an accessible name on the frame.

Specimens are static. Hover and focus styles still work, because they're CSS. A specimen that needs to
show a state, such as a selected row or an open menu, records that state in its source.

### 5. Seed the gallery

Write ten specimens that later phases need first: `Button` variants, `Badge` and `Chip`, a `Field` with
an `Input`, a `SettingsSection` with rows, a `ListDetail` with `Rows`, `Tabs`, `Alert`, `Table`,
`Timeline`, and `Graph`. Show all of them at `/lab/specimens/` in every theme and style pack, for
review.

Document the commands, the cross-app exception from [the pipeline](#the-pipeline), and the components
jsdom can't draw in the site's internal page.

## Out of scope

Whole windows, which are [phase 7](./07-shell-snapshots.md). Live, clickable specimens that run Solid on
the site. The point is a picture that can't go stale, not a playground.

## Acceptance

- The ten seed specimens draw on `/lab/specimens/` on both hosts, in all 12 themes and 4 style packs.
- Renaming a class in a kit component fails the specimen check until someone runs
  `UPDATE_SPECIMENS=1` and commits the result.
- Running the generators twice on two machines produces identical files.
- The scoped stylesheet test passes, and a page with specimens shows no change to the site's own
  header, sidebar, or text compared to a page without.
- No committed specimen contains a script, an event handler attribute, or a style attribute outside the
  allowed list.
- The budget check passes on a docs page with five specimens. Record the specimen stylesheet's
  compressed size in the site's internal page.

## Risks

- jsdom has no layout. Components that size themselves, such as `ListDetail`'s collapse or a dashboard
  grid, draw their unmeasured state. Pick specimen sizes that avoid the collapsed state, or record the
  measurement as a fixed value in the specimen source.
- `primitives.css` is 125 KB before compression. Without pruning, every docs page pays for it. The
  pruning step is what keeps the budget.
- After this phase, a kit change touches committed site files. That's intended. Reviewers see the picture change in
  the pull request.
