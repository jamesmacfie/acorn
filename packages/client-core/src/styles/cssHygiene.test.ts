import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { declaredByBlock, readStyleSheets, referenced, workspaceRoot } from './readStyleSheets'

const sheets = readStyleSheets()
const corpus = sheets.map((f) => f.text).join('\n')
const withoutComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '')

describe('no phantom tokens', () => {
  it('defines every custom property that is referenced', () => {
    const declared = new Set<string>()
    for (const file of sheets) {
      for (const names of declaredByBlock(file.text).values()) for (const name of names) declared.add(name)
    }

    // Set at runtime from JS rather than in any stylesheet, so they are legitimately absent here.
    const runtimeSet = new Set([
      '--term-drawer-h', // TerminalPanel.tsx sets it on documentElement
      '--left', // reserved override hook for the left pane width
      '--l', '--r', // Shiki emits both syntax colours inline per token
      '--state-color', '--label-color', // inline per-element props carrying live Linear API colours
      '--chip-color', // Chip's `color` prop — the shared successor to the two above
      // Numbers handed to CSS from a component: a fill ratio and a column count. Passing the number
      // rather than a computed width or a grid template is what keeps the SHAPE in the stylesheet
      // where a style pack can reach it.
      '--meter-value', '--kv-extra-cols',
      // The diff canvas's width in columns (maxLineCols), written inline by DiffCanvas. Same rule:
      // the component hands over the COUNT, and diff.css keeps the arithmetic that turns it into a
      // width — so the gutter widths it adds stay reachable by a style pack.
      '--diff-cols',
      // The dashboard grid's measured square-cell size and its cell-to-cell pitch, written inline by
      // PanelGrid's ResizeObserver. They carry a MEASUREMENT, not a design decision — the shape
      // (twelve columns, the gap, the overlay's lattice) all stays in dashboards.css, which is what
      // keeps a style pack in charge of it. Declared there too as a pre-measure fallback, but on
      // `.dash-grid` rather than `:root`, which this scanner does not read.
      '--dash-cell', '--dash-pitch',
    ])

    // Declared in a stylesheet, but on a component's own block rather than `:root` — which is the
    // one place declaredByBlock reads. These are not tokens and have no business on `:root`: they
    // are local constants a single feature's arithmetic shares, scoped to the block that owns them.
    const locallyDeclared = new Set([
      // diff.css `.diff`: the fixed chrome beside a code line. The row canvas's min-width has to add
      // the same gutter and marker widths the columns themselves use, and naming them once is what
      // stops the two from drifting apart and clipping the last character off every long line.
      '--diff-gutter-w', '--diff-marker-w', '--diff-btn-w', '--diff-chrome-w',
    ])

    const phantom = [...new Set(sheets.flatMap((f) => [...referenced(f.text)]))]
      .filter((name) => !declared.has(name) && !runtimeSet.has(name) && !locallyDeclared.has(name))
      .sort()

    expect(phantom).toEqual([])
  })
})

describe('literal ratchets (these may only go down)', () => {
  // NOTE the lookahead sits BEFORE the whitespace: `prop:\s*(?!var\()` does not work, because
  // `\s*` backtracks to zero width and the lookahead then succeeds against the space itself.
  const count = (re: RegExp) => (withoutComments(corpus).match(re) ?? []).length

  // Zero. The last one was `.linear-priority i`, a 1px radius on a 3px-wide bar — a genuine hairline
  // one-off the scale had no rung for — and it went with the Linear browse when that plugin moved to the
  // loaded tier. A ratchet that reaches zero should say zero.
  it('border-radius literals', () => {
    expect(count(/border-radius:(?!\s*var\()[^;]+;/g)).toBe(0)
  })

  it('border widths not using a width token', () => {
    expect(count(/border(?:-(?:top|right|bottom|left))?:\s*\d+px/g)).toBe(0)
  })

  // --divider is the ROW-SEPARATOR recipe, and Modern/Cute set --divider-w: 0 — so any site that
  // used it for a job the pack still wants silently lost its border in 2 of 4 packs. That is how
  // the database pane ended up borderless everywhere but Terminal. An all-four-sides shorthand can
  // never be a row separator: it is a control (--control-border), a card or popover
  // (--surface-border) or a badge, so this shape is mechanically a misuse.
  it('four-sided border using the row-divider recipe', () => {
    expect(count(/border:\s*var\(--divider\)/g)).toBe(0)
  })

  it('box-shadow geometry not using an elevation token', () => {
    expect(count(/box-shadow:(?!\s*var\()[^;]+;/g)).toBe(0)
  })

  // calc(var(--z-x) ± 1) is allowed: several surfaces stack one step above a ladder rung, and
  // expressing that against the rung keeps the ladder authoritative.
  it('raw z-index not using the ladder', () => {
    expect(count(/z-index:(?!\s*(?:var\(|calc\())[^;]+;/g)).toBe(0)
  })

  // Remaining: 8px/9px/9px micro-type and one 16px glyph button — all below or between ramp rungs.
  it('literal font-size', () => {
    expect(count(/font-size:\s*\d/g)).toBeLessThanOrEqual(4)
  })

  // Third-party brand marks live in tokens-invariant.css, so nothing outside the axis files needs
  // to spell a colour at all.
  it('colour literals outside the axis sheets', () => {
    const leaked = sheets
      .filter((f) => !f.name.startsWith('tokens-'))
      .map((f) => (withoutComments(f.text).match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).length)
      .reduce((a, b) => a + b, 0)
    expect(leaked).toBe(0)
  })

  // A class handed to a primitive lands on the SAME element as the primitive's own class, so a bare
  // `.thing { display: … }` ties with `.ui-card { display: block }` and the winner is chunk order.
  // Compounding is the fix, and this is the shape that must not come back — a `.dash-panel` that
  // loses the tie is a block, which silently kills the body's scroll.
  it('classes merged onto Card are compounded with it', () => {
    // Anchored at the start of a selector: a descendant rule like `.dash-slot > .dash-panel` already
    // outranks the primitive and is not the shape at issue.
    const bare = ['dash-panel', 'dash-card']
      .filter((name) => new RegExp(`^\\s*(?:[^{}]*,\\s*)?\\.${name}\\s*\\{`, 'm').test(withoutComments(corpus)))
    expect(bare).toEqual([])
  })

  // Individual px VALUES left inside spacing declarations. Everything on the --space-* scale is
  // already a token, so whatever remains is off-scale (3px, 5px, 7px, 9px …). Deliberately NOT
  // snapped: that would shift ~85 paddings by 1px and the hygiene pass promised no visual change.
  // Snap them while authoring a pack that moves the density anyway, where 1px is invisible.
  it('off-scale spacing values', () => {
    const decls = withoutComments(corpus)
      .match(/(?:padding|margin|gap|row-gap|column-gap)(?:-(?:top|right|bottom|left))?:[^;]+;/g) ?? []
    const offScale = decls.flatMap((d) => d.match(/-?\d+px/g) ?? []).length
    expect(offScale).toBeLessThanOrEqual(147)
  })
})

// A plugin frame is a separate document served exactly one host stylesheet, and that sheet is a
// HAND-PICKED subset of these files (apps/desktop/src/app/main/pluginFrameStyles.ts). primitives.css is
// in it because the components on @acorn/plugin-api/ui are, so every class those components render has
// to be fully styled by that subset alone. A base rule that sits in shell.css instead reaches all 18
// shell call sites and none of the frames — the header keeps its variant tweaks and loses its height,
// divider and label typography, which looks like a plugin that ignored the design system rather than
// like a missing file. That is how .section-header was broken for the Database and HTTP panes.
//
// The subset is READ from pluginFrameStyles.ts rather than restated here, so editing that list either
// keeps this honest or fails it.
// `font` is a shorthand, and a shorthand needs at minimum a size AND a family. Hand it a family token
// alone — `font: var(--font-ui)` — and it parses (any var() might expand to anything) but is invalid once
// substituted. That case does NOT behave like a syntax error: an invalid-at-computed-value-time
// declaration takes the property's unset value rather than falling back to the previous declaration in
// the cascade, and every `font` longhand is inherited, so the element inherits from a parent that
// declares nothing and lands on the browser's default serif. base.css never gets to win.
//
// It is invisible in review, invisible to tsc, and it rendered the whole Database pane in Times New Roman.
// The legitimate uses all carry a size (`font: var(--fs-sm) var(--font-mono)`), so the signature to ban is
// narrow: a `font` shorthand whose entire value is one var(). Use `font-family` when you mean the family.
it('never puts a bare token in the font shorthand', () => {
  // One var() and then the semicolon. A legitimate `font: var(--fs-sm) var(--font-mono)` has a second
  // token after the first var() closes, so it does not match; the inner value bans parentheses to stop
  // the scan running past that close paren.
  const bare = withoutComments(corpus).match(/(?:^|[;{\s])font:\s*var\(--[a-z0-9-]+(?:,[^;()]*)?\)\s*;/g) ?? []
  expect(bare).toEqual([])
})

describe('the plugin-frame stylesheet is self-contained', () => {
  const listPath = join(workspaceRoot(), 'apps/desktop/src/app/main/pluginFrameStyles.ts')
  const served = [...readFileSync(listPath, 'utf8').matchAll(/from '@acorn\/client-core\/([^']+)\?raw'/g)]
    .map((m) => m[1])

  it('names sheets that exist', () => {
    expect(served.length).toBeGreaterThan(5)
    expect(served.filter((rel) => !sheets.some((f) => f.path.endsWith(`/src/${rel}`)))).toEqual([])
  })

  it('gives a base rule for every class primitives.css styles', () => {
    const servedText = served
      .map((rel) => sheets.find((f) => f.path.endsWith(`/src/${rel}`))?.text ?? '')
      .map(withoutComments)
      .join('\n')
    const primitives = withoutComments(sheets.find((f) => f.name === 'primitives.css')?.text ?? '')
    // Hooks with no base rule of their own: styled only through a state or a child, so there is
    // nothing for the served subset to be missing. `.ui-fold` is a <details> — only `[open]` matters.
    const hooks = new Set(['ui-fold'])
    const orphans = [...new Set([...primitives.matchAll(/\.([a-z][a-z0-9-]{2,})/g)].map((m) => m[1]))]
      .filter((name) => !hooks.has(name))
      .filter((name) => !new RegExp(`(^|[\\s,>+~])\\.${name}\\s*(,|\\{)`, 'm').test(servedText))
      .sort()
    expect(orphans).toEqual([])
  })
})
