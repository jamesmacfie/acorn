# Icons

This page covers how `Icon` resolves a name, `IconButton`, which icons load eagerly, and brand marks
and their colors. Read it before you add an icon or a brand mark. It's part of
[UI design](../ui-design.md).

## Icons

`kit/components/content/Icon.tsx` takes a name string and resolves it in this order:

1. A `brand:`-prefixed name is a brand mark from `kit/tokens/brandMarks.ts`: one SVG path's `d`
   attribute in a 24 box, drawn as a single `<path fill="currentColor">`.
2. Any other name is a Lucide glyph from `lucide-static/icon-nodes.json`, drawn stroked and unfilled
   in the same box, node by node through `<Dynamic>`, never `innerHTML`.
3. An unmatched name renders as text in a `span.glyph`. The remaining inline literals, such as ⊘ and
   ◉, rely on this, which is why `--font-glyph` exists.

`tone` is a role token, so a state mark is colored like every other kit node. `tone="brand"` uses the
mark's own color, held to the theme's contrast through `--brand-legible`. `spin` turns the mark, for a
state in progress. It has no reduced-motion guard, because on a state icon the turn is the whole
signal, and a 12px rotation isn't the motion that setting exists to stop.

The terminal client uses the same names and tones, but draws a small set as one-cell marks
(`apps/tui/src/kit/glyphs.ts`). Its `spin` uses the shared braille tick. An unmapped name draws
nothing, so a mark that carries meaning on both hosts needs a terminal mapping.

### A button whose face is a mark

Use `IconButton`, not a `Button` with `iconOnly`. It takes an `icon` name and a required `label`, and
defaults to `variant="bare"` and `size="sm"`. A caller that wants another pair says so, as the
dashboards do with `ghost` and `xs`. `label` is required, because a mark has no text for a screen
reader. The terminal's `IconButton` draws the label as its text.

The `brand:` prefix keeps the two families from colliding, and keeps brand marks out of the Lucide
list that `kit/components/inputs/IconPicker.tsx` offers for task icons.

### Which names are drawn without waiting

Lucide ships 1,756 icons and 706 KB of geometry, and `Icon` resolves a name at render time, so a
bundler can't tell which names are used. `kit/tokens/iconNodes.ts` splits the set:

- The eager half is every Lucide name spelled as a literal in product code, written to
  `iconNodes.eager.json` and carried by the chunk that holds `Icon`. On October 4, 2026, it held 123
  names in about 23 KB. Those draw on the first pass.
- The lazy half is the rest, behind `() => import('lucide-static/icon-nodes.json')`. A name only that
  half has shows its text fallback for one frame, then becomes an SVG.

The eager half is generated. `packages/client-core/scripts/icon-census.mjs` scans `packages/`,
`plugins/`, and `apps/` for `name="…"`, `icon: '…'`, and `glyph: '…'` literals that are Lucide names,
and client-core's `lint` runs it with `--check`. Spell a new icon without regenerating and lint fails,
naming the icon. Run `pnpm --filter @acorn/client-core icons` and commit the result.

Nothing is dropped. A person can assign any icon to a task and a manifest can name any icon, and both
are persisted. `IconPicker` and `features/tabs/TabRail.tsx` load the full map up front, because they
draw stored names. A new view that draws a stored icon name should call `loadIconNodes()` when it
mounts.

### Brand marks

A mark belongs in core only if a core view renders it. Otherwise it belongs to the plugin that draws
it, because if core names `brand:x` and no plugin registered it, the literal `brand:x` shows. Core's
list is GitHub, because `project.github` is a field on the project row.

A plugin supplies its mark in one of two ways, with identical results:

- Compiled in: call `brandMarkRegistry.register()` from the plugin's `init`
  (`@acorn/plugin-api/client`), as `plugins/docker/src/client/index.ts` does.
- Loaded: declare `icon`, or `icons` for several brands, at the top level of `acorn-plugin.json`. The
  host registers it under a name stamped from the plugin list, so a package can't claim another's mark,
  as in `plugins/linear/acorn-plugin.config.mjs`.

Both end at the same registry, so moving a plugin from compiled to loaded changes no glyph string.
Path data works where a component wouldn't: a function can't cross a `MessagePort`, and a rail
source's logo has to draw whether or not the plugin's frame is mounted.

A mark is one `d` attribute, not an SVG document. A document would allow `<script>`, `<use href>`,
`<image href>`, `<foreignObject>`, `on*` handlers, and CSS `@import`. `d`'s grammar has nothing to
sanitize, so a manifest mark needs only a character check
(`packages/node-core/src/server/plugins/manifest.ts`). `Icon` fills it with `currentColor`, so a
plugin's mark follows every theme, which a data-URI `<img>` couldn't.

### Brand color

A mark can carry `color`, the brand's six-digit hex. `brandStyle(name)` in `kit/tokens/brandMarks.ts`
sets two custom properties on the element: `--brand` for the fill, and `--brand-on`, which is
`--brand-fg`, for what sits on top. A view reads them with a fallback, so a mark without a color and a
plain Lucide name keep the view's own look:

```css
.integration-logo { background: var(--brand, var(--bg-hover)); color: var(--brand-on, var(--text)); }
```

Two rules govern a brand color:

- It mustn't be the only thing carrying contrast. A third-party hex doesn't know your theme, and
  GitHub's `#24292f` on a dark pane is black on near-black. Fill a shape with it and put
  `--brand-fg` on top, or tint with it, as Agent Center's session icon does at 8%. If a mark ever
  disappears, the fix is a light and dark pair on the mark.
- It's validated as a hex, not as a CSS color. The string reaches a `style` attribute, and a color
  slot accepts `url()`, which would let a manifest make a request. `plugin/contract.ts` checks
  `/^#[0-9a-f]{6}$/i`.

A frame is a separate origin with no reach into the registry, so it draws its own copy of a mark and
sets its own `--brand`. A plugin that draws a tree names `glyph: 'brand:linear'` like anyone else,
because the host resolves it.
