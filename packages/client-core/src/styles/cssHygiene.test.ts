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
      '--meter-value', '--kv-extra-cols',
      '--diff-cols',
      '--dash-cell', '--dash-pitch',
    ])

    // Local constants scoped to their own block, not tokens for `:root`
    // (docs/ui-design.md § Runtime-set custom properties).
    const locallyDeclared = new Set([
      '--diff-gutter-w', '--diff-marker-w', '--diff-btn-w', '--diff-chrome-w',
      '--row-field-w',
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

  // Zero today. The last literal was `.linear-priority i`, a 1px radius on a 3px-wide bar with no
  // rung on the scale, and it left when that plugin moved to the loaded tier. A ratchet that
  // reaches zero should say zero.
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

  // Third-party brand marks live in tokens-invariant.css, so nothing outside the axis files needs
  // to spell a colour at all.
  it('colour literals outside the axis sheets', () => {
    const leaked = sheets
      .filter((f) => !f.name.startsWith('tokens-'))
      .map((f) => (withoutComments(f.text).match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).length)
      .reduce((a, b) => a + b, 0)
    expect(leaked).toBe(0)
  })

  // docs/ui-design.md § How the primitives are built covers why a class handed to a primitive
  // must compound onto it.
  it('classes merged onto Card are compounded with it', () => {
    // Anchored at the start of a selector: a descendant rule like `.dash-slot > .dash-panel`
    // already outranks the primitive and is not the shape at issue.
    const bare = ['dash-panel', 'dash-card']
      .filter((name) => new RegExp(`^\\s*(?:[^{}]*,\\s*)?\\.${name}\\s*\\{`, 'm').test(withoutComments(corpus)))
    expect(bare).toEqual([])
  })

  // Individual pixel values left inside spacing declarations. Everything on the --space-* scale is
  // already a token, so whatever remains is off-scale (3px, 5px, 7px, 9px, and so on). These are not
  // snapped retroactively: that would shift about 85 paddings by 1px and the hygiene pass promised
  // no visual change. Snap them while authoring a pack that moves the density anyway, where 1px is
  // invisible.
  it('off-scale spacing values', () => {
    const decls = withoutComments(corpus)
      .match(/(?:padding|margin|gap|row-gap|column-gap)(?:-(?:top|right|bottom|left))?:[^;]+;/g) ?? []
    const offScale = decls.flatMap((d) => d.match(/-?\d+px/g) ?? []).length
    expect(offScale).toBeLessThanOrEqual(147)
  })
})

// A plugin frame is served exactly the sheets pluginFrameStyles.ts lists, primitives.css among them
// (docs/ui-design.md § How the primitives are built).
//
// A font shorthand needs at minimum a size and a family. `font: var(--font-ui)` parses, since any
// var() might expand to anything, but is invalid once substituted with a family alone: an
// invalid-at-computed-value-time declaration takes the property's unset value rather than falling
// back to the previous declaration in the cascade, and every `font` longhand is inherited, so the
// element inherits nothing from its parent and lands on the browser's default serif. This rendered
// the whole Database pane in Times New Roman, and it is invisible in review and invisible to tsc.
// The signature to ban is narrow: a `font` shorthand whose entire value is one var(). Use
// `font-family` when the value should be a family; the legitimate uses all carry a size
// (`font: var(--fs-sm) var(--font-mono)`).
it('never puts a bare token in the font shorthand', () => {
  // One var() and then the semicolon. A legitimate `font: var(--fs-sm) var(--font-mono)` has a
  // second token after the first var() closes, so it does not match; the inner value bans
  // parentheses to stop the scan running past that close paren.
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
