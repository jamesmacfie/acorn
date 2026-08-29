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

    // Runtime-set custom properties: a component measurement or count, never a design decision
    // (docs/ui-design.md § Runtime-set custom properties).
    const runtimeSet = new Set([
      '--term-drawer-h', // TerminalPanel.tsx sets it on documentElement
      '--left', // reserved override hook for the left pane width
      '--l', '--r', // Shiki emits both syntax colours inline per token
      '--state-color', '--label-color', // inline per-element props carrying live Linear API colours
      '--chip-color', // Chip's `color` prop — the shared successor to the two above
      // A brand's own colour and what sits on it, from brandStyle() in ui/brandMarks.ts. Third-party
      // identity rather than a design decision, which is why it comes from the mark and not a token.
      '--brand', '--brand-on',
      '--meter-value', '--kv-extra-cols',
      // RailTab sets it from the validated project colour, which is a user's choice about one
      // project rather than a design decision (tabs/RailTab.tsx).
      '--rail-accent',
      '--diff-cols',
      // The kit's space role, written inline from ui/kit/roles.ts. Always a var() into a style
      // token, so it carries a role rather than a value (docs/ui-design.md § The closed kit).
      '--kit-gap',
      '--dash-cell', '--dash-pitch',
    ])

    // Local constants scoped to their own block, not tokens for `:root`
    // (docs/ui-design.md § Runtime-set custom properties).
    const locallyDeclared = new Set([
      '--diff-gutter-w', '--diff-marker-w', '--diff-btn-w', '--diff-chrome-w',
      '--row-field-w',
      '--kit-grid-col',
    ])

    const phantom = [...new Set(sheets.flatMap((f) => [...referenced(f.text)]))]
      .filter((name) => !declared.has(name) && !runtimeSet.has(name) && !locallyDeclared.has(name))
      .sort()

    expect(phantom).toEqual([])
  })
})

describe('literal ratchets (these may only go down)', () => {
  // The lookahead sits before the whitespace: `prop:\s*(?!var\()` does not work, because `\s*`
  // backtracks to zero width and the lookahead then succeeds against the space itself.
  const count = (re: RegExp) => (withoutComments(corpus).match(re) ?? []).length

  // Zero. A ratchet that reaches zero should say zero.
  it('border-radius literals', () => {
    expect(count(/border-radius:(?!\s*var\()[^;]+;/g)).toBe(0)
  })

  it('border widths not using a width token', () => {
    expect(count(/border(?:-(?:top|right|bottom|left))?:\s*\d+px/g)).toBe(0)
  })

  // docs/ui-design.md § Border roles covers why an all-four-sides shorthand can never use --divider.
  it('four-sided border using the row-divider recipe', () => {
    expect(count(/border:\s*var\(--divider\)/g)).toBe(0)
  })

  it('box-shadow geometry not using an elevation token', () => {
    expect(count(/box-shadow:(?!\s*var\()[^;]+;/g)).toBe(0)
  })

  // docs/ui-design.md § Token axes covers why calc(var(--z-x) ± 1) is allowed here.
  it('raw z-index not using the ladder', () => {
    expect(count(/z-index:(?!\s*(?:var\(|calc\())[^;]+;/g)).toBe(0)
  })

  // Remaining: 8px/9px/9px micro-type and one 16px glyph button, all below or between ramp rungs.
  it('literal font-size', () => {
    expect(count(/font-size:\s*\d/g)).toBeLessThanOrEqual(4)
  })

  // A third-party brand colour rides on its mark, in TypeScript or a plugin manifest, so nothing in
  // any stylesheet spells a colour.
  it('colour literals outside the axis sheets', () => {
    const leaked = sheets
      .filter((f) => !f.name.startsWith('tokens-'))
      .map((f) => (withoutComments(f.text).match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).length)
      .reduce((a, b) => a + b, 0)
    expect(leaked).toBe(0)
  })

  // docs/ui-design.md § How the kit is built covers why a class handed to a primitive
  // must compound onto it.
  it('classes merged onto Card are compounded with it', () => {
    // Anchored at the start of a selector: a descendant rule like `.dash-slot > .dash-panel`
    // already outranks the primitive and is not the shape at issue.
    const bare = ['dash-panel', 'dash-card']
      .filter((name) => new RegExp(`^\\s*(?:[^{}]*,\\s*)?\\.${name}\\s*\\{`, 'm').test(withoutComments(corpus)))
    expect(bare).toEqual([])
  })

  // Pixel values left inside spacing declarations. Everything on the --space-* scale is a token,
  // so whatever remains is off-scale. Snapping them retroactively would shift about 85 paddings by
  // 1px; do it while authoring a pack that moves the density anyway.
  it('off-scale spacing values', () => {
    const decls = withoutComments(corpus)
      .match(/(?:padding|margin|gap|row-gap|column-gap)(?:-(?:top|right|bottom|left))?:[^;]+;/g) ?? []
    const offScale = decls.flatMap((d) => d.match(/-?\d+px/g) ?? []).length
    expect(offScale).toBeLessThanOrEqual(147)
  })
})

// A plugin frame is served exactly the sheets scripts/stage.mjs lists, primitives.css among them
// (docs/ui-design.md § How the kit is built).
//
// A font shorthand needs a size and a family. `font: var(--font-ui)` parses, because any var()
// might expand to anything, but it is invalid once substituted with a family alone. An
// invalid-at-computed-value-time declaration takes the property's unset value instead of the
// previous declaration, and every `font` longhand inherits, so the element lands on the browser's
// default serif. That rendered the whole Database pane in Times New Roman, invisible in review and
// to tsc. Use `font-family` when the value is a family; legitimate uses carry a size, as in
// `font: var(--fs-sm) var(--font-mono)`.
it('never puts a bare token in the font shorthand', () => {
  // One var() and then the semicolon. A legitimate `font: var(--fs-sm) var(--font-mono)` has a
  // second token after the first var() closes, so it does not match; the inner value bans
  // parentheses to stop the scan running past that close paren.
  const bare = withoutComments(corpus).match(/(?:^|[;{\s])font:\s*var\(--[a-z0-9-]+(?:,[^;()]*)?\)\s*;/g) ?? []
  expect(bare).toEqual([])
})

describe('the plugin-frame stylesheet is self-contained', () => {
  const listPath = join(workspaceRoot(), 'apps/desktop/scripts/stage.mjs')
  const list = /const FRAME_STYLES = \[([\s\S]*?)\]/.exec(readFileSync(listPath, 'utf8'))?.[1] ?? ''
  const served = [...list.matchAll(/'([^']+\.css)'/g)].map((m) => m[1])

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
    // Hooks with no base rule of their own, styled only through a state or a child, so there is
    // nothing for the served subset to be missing. `.ui-fold` is a <details> element; only
    // `[open]` matters.
    const hooks = new Set(['ui-fold'])
    const orphans = [...new Set([...primitives.matchAll(/\.([a-z][a-z0-9-]{2,})/g)].map((m) => m[1]))]
      .filter((name) => !hooks.has(name))
      .filter((name) => !new RegExp(`(^|[\\s,>+~])\\.${name}\\s*(,|\\{)`, 'm').test(servedText))
      .sort()
    expect(orphans).toEqual([])
  })
})
