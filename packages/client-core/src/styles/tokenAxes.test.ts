import { describe, expect, it } from 'vitest'
import {
  BRIDGE_TOKENS,
  FRAME_TOKENS,
  INVARIANT_TOKENS,
  STYLE_TOKENS,
  THEME_TOKENS,
  Z_ORDER_INVARIANTS,
} from '../ui/tokenAxes'
import { declaredByBlock, readAxisSheets, readStylePacks, readStyleSheets } from './readStyleSheets'

// The appearance contract, as executable assertions.
//
// Appearance is two axes on <html>: data-theme owns colour, data-style owns everything else. The
// whole design rests on the two token sets being DISJOINT — that is what makes their relative
// source order irrelevant, which in turn is what makes a 4-styles × 12-themes matrix a non-issue
// instead of a 48-cell screenshot grid. If disjointness is only a convention it will rot on the
// first busy afternoon, so it is a test.

const theme = new Set<string>(THEME_TOKENS)
const style = new Set<string>(STYLE_TOKENS)
const invariant = new Set<string>(INVARIANT_TOKENS)

const sheet = (name: string) => {
  const found = readAxisSheets().find((f) => f.name === name)
  if (!found) throw new Error(`missing axis stylesheet: ${name}`)
  return found.text
}

const declaredIn = (text: string): Set<string> => {
  const all = new Set<string>()
  for (const names of declaredByBlock(text).values()) for (const name of names) all.add(name)
  return all
}

describe('token axes are disjoint', () => {
  it('shares no token name between the theme and style sets', () => {
    expect([...theme].filter((t) => style.has(t))).toEqual([])
  })

  it('shares no token name with the invariant set', () => {
    expect([...invariant].filter((t) => theme.has(t) || style.has(t))).toEqual([])
  })

  it('declares only theme tokens in tokens-theme.css', () => {
    // --dark-* are inert value holders that the two dark mapping blocks alias; not an axis token.
    const stray = [...declaredIn(sheet('tokens-theme.css'))]
      .filter((t) => !t.startsWith('--dark-') && !theme.has(t))
    expect(stray).toEqual([])
  })

  it('declares only style tokens in tokens-style.css', () => {
    expect([...declaredIn(sheet('tokens-style.css'))].filter((t) => !style.has(t))).toEqual([])
  })

  it('declares only invariant tokens in tokens-invariant.css', () => {
    expect([...declaredIn(sheet('tokens-invariant.css'))].filter((t) => !invariant.has(t))).toEqual([])
  })
})

describe('token axes are complete', () => {
  it('gives every style token a :root default, so a pack can never leave a var() undefined', () => {
    const defaults = declaredByBlock(sheet('tokens-style.css')).get(':root') ?? new Set()
    expect([...style].filter((t) => !defaults.has(t))).toEqual([])
  })

  it('declares every primitive palette token in every named theme block', () => {
    // Derived tokens (--danger, --surface-sunken, …) are declared once on :root as var()
    // references, so they follow each theme automatically and must NOT be restated per block.
    const derived = new Set([
      '--danger', '--danger-fg', '--success', '--success-fg', '--surface-sunken',
      '--accent-fg', '--state-ok', '--state-warn', '--state-bad',
      '--find-hit-bg', '--find-current-bg', '--scrim-color',
      '--is-dark', '--color-scheme', '--syntax-fg',
    ])
    const primitives = [...theme].filter((t) => !derived.has(t))
    const blocks = declaredByBlock(sheet('tokens-theme.css'))

    for (const [selector, declared] of blocks) {
      if (!selector.includes('[data-theme=')) continue
      if (selector.includes('"dark"')) continue // the dark mapping block aliases --dark-* wholesale
      const missing = primitives.filter((t) => !declared.has(t))
      expect(missing, `${selector} is missing palette tokens`).toEqual([])
    }
  })
})

describe('style packs stay in their lane', () => {
  const packs = readStylePacks()

  it('sets no palette token', () => {
    for (const pack of packs) {
      const stray = [...declaredIn(pack.text)].filter((t) => theme.has(t) || invariant.has(t))
      expect(stray, `${pack.name} sets non-style tokens`).toEqual([])
    }
  })

  it('contains no colour literal — a pack composes theme slots, it never names a colour', () => {
    for (const pack of packs) {
      const stripped = pack.text.replace(/\/\*[\s\S]*?\*\//g, '')
      const literals = stripped.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(|\blab\(/g) ?? []
      expect(literals, `${pack.name} contains colour literals`).toEqual([])
    }
  })

  it('keeps --font-mono monospace-terminated, since xterm measures cell width from it', () => {
    for (const pack of packs) {
      const decl = pack.text.match(/--font-mono\s*:\s*([^;]+);/)
      if (decl) expect(decl[1].trim(), `${pack.name} --font-mono`).toMatch(/monospace\s*$/)
    }
  })

  // The architecture's own falsification test. A pack should be a token block; every structural
  // override is a bug report against the vocabulary. Exceeding the budget means the fix is a new
  // token, never a 26th override — otherwise the same overrides get written once per pack and the
  // token layer quietly stops being the seam.
  it('keeps each pack within its escape-hatch budget of 25 override selectors', () => {
    for (const pack of packs) {
      const stripped = pack.text.replace(/\/\*[\s\S]*?\*\//g, '')
      // Selectors that reach past the :root token block into actual elements.
      const overrides = [...stripped.matchAll(/:root\[data-style=[^\]]+\]\s+[^{]+\{/g)]
      expect(overrides.length, `${pack.name} override selectors`).toBeLessThanOrEqual(25)
    }
  })

  it('gives every registered pack a stylesheet, and vice versa', () => {
    // Cheap catch for "added the CSS, forgot the picker entry" (and the reverse, which would offer
    // a style that silently renders as Terminal). settings/uiStyles.test.ts covers the ids; this
    // asserts one :root[data-style] block per pack file.
    for (const pack of packs) {
      const id = pack.name.replace(/^style-|\.css$/g, '')
      expect(pack.text, `${pack.name}`).toContain(`:root[data-style='${id}']`)
    }
  })
})

describe('cross-axis selectors are banned', () => {
  it('never combines data-theme and data-style in one selector', () => {
    // (0,3,0) would beat both axis files and re-introduce the combinatorial matrix the disjoint
    // sets exist to avoid. A pack that needs theme-specific behaviour needs a token, not this.
    for (const file of readStyleSheets()) {
      const compound = file.text.match(
        /\[data-theme=[^\]]*\]\s*\[data-style|\[data-style=[^\]]*\]\s*\[data-theme/g,
      )
      expect(compound, `${file.name} has a compound axis selector`).toBeNull()
    }
  })
})

describe('canvas bridge tokens', () => {
  // xterm and Monaco render to a canvas, so they read these by string via getComputedStyle.
  // Renaming one breaks the terminal and the editor with no type error anywhere.
  it('declares every bridge token somewhere in the axis sheets', () => {
    const declared = new Set(readAxisSheets().flatMap((f) => [...declaredIn(f.text)]))
    expect([...BRIDGE_TOKENS].filter((t) => !declared.has(t))).toEqual([])
  })

  it('never lets a style pack shadow one', () => {
    for (const pack of readStylePacks()) {
      const stray = [...declaredIn(pack.text)].filter((t) => (BRIDGE_TOKENS as readonly string[]).includes(t))
      expect(stray, `${pack.name} shadows a bridge token`).toEqual([])
    }
  })
})

describe('plugin frame tokens', () => {
  it('projects every appearance and invariant token exactly once', () => {
    const expected = [...theme, ...style, ...invariant].sort()
    expect([...FRAME_TOKENS].sort()).toEqual(expected)
    expect(new Set(FRAME_TOKENS).size).toBe(FRAME_TOKENS.length)
  })

  it('declares every projected token in an axis sheet', () => {
    const declared = new Set(readAxisSheets().flatMap((file) => [...declaredIn(file.text)]))
    expect([...FRAME_TOKENS].filter((token) => !declared.has(token))).toEqual([])
  })
})

describe('the stacking ladder', () => {
  const ladder = declaredByBlock(sheet('tokens-invariant.css')).get(':root') ?? new Set()
  const value = (name: string): number => {
    const match = sheet('tokens-invariant.css').match(new RegExp(`${name}\\s*:\\s*(\\d+)`))
    if (!match) throw new Error(`no numeric value for ${name}`)
    return Number(match[1])
  }

  it.each(Z_ORDER_INVARIANTS)('keeps %s above %s', (above, below) => {
    expect(ladder.has(above) && ladder.has(below)).toBe(true)
    expect(value(above)).toBeGreaterThan(value(below))
  })
})
