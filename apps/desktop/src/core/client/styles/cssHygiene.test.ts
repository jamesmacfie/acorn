import { describe, expect, it } from 'vitest'
import { declaredByBlock, readStyleSheets, referenced } from './readStyleSheets'

// Two guards over the whole stylesheet corpus.
//
// 1. No phantom tokens. Before the token axes landed, EIGHT custom properties were referenced and
//    never defined — --fs-xs alone had 25 uses and silently rendered at the inherited size, and
//    --danger had two different hardcoded red fallbacks at different call sites. That is invisible
//    at review time and invisible at runtime. Now it fails the suite.
//
// 2. Ratcheting literal counts. The style axis can only reach a value that is a token, so every
//    remaining literal is a surface a style pack cannot restyle. These baselines are the Phase 2
//    sweep's worklist; they may only go DOWN. Same shrinking-ledger idiom as core/boundaries.test.ts.

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
      '--agent-comparison-count', // AgentComparison.tsx sets it from the selected session count
      '--left', // reserved override hook for the left pane width
      '--l', '--r', // Shiki emits both syntax colours inline per token
      '--state-color', '--label-color', // inline per-element props carrying live Linear API colours
    ])

    const phantom = [...new Set(sheets.flatMap((f) => [...referenced(f.text)]))]
      .filter((name) => !declared.has(name) && !runtimeSet.has(name))
      .sort()

    expect(phantom).toEqual([])
  })
})

describe('literal ratchets (these may only go down)', () => {
  // NOTE the lookahead sits BEFORE the whitespace: `prop:\s*(?!var\()` does not work, because
  // `\s*` backtracks to zero width and the lookahead then succeeds against the space itself.
  const count = (re: RegExp) => (withoutComments(corpus).match(re) ?? []).length

  // Remaining: `.linear-priority i`, a 1px radius on a 3px-wide bar. A genuine hairline one-off —
  // the smallest scale rung (2px) would read as a pill at that width.
  it('border-radius literals', () => {
    expect(count(/border-radius:(?!\s*var\()[^;]+;/g)).toBeLessThanOrEqual(1)
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
