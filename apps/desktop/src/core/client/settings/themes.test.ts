import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { THEMES } from './themes'

// Drift guard (docs/ui-design.md): the Appearance THEMES picker is hand-synced with the
// `:root[data-theme="…"]` blocks in tokens-layout.css. This reads the stylesheet and asserts the
// two sets match, so adding/removing a theme in one place fails the suite until both agree.
describe('THEMES ↔ tokens-layout.css', () => {
  it('lists exactly the themes the stylesheet defines', () => {
    const css = readFileSync(fileURLToPath(new URL('../styles/tokens-layout.css', import.meta.url)), 'utf8')
    // 'light' is the :root default (no data-theme block); every other theme has an attribute block.
    const inCss = new Set(['light', ...[...css.matchAll(/:root\[data-theme="([^"]+)"\]/g)].map((m) => m[1])])
    expect(new Set(THEMES.map(([value]) => value))).toEqual(inCss)
  })

  it('gives every theme a label', () => {
    for (const [value, label] of THEMES) {
      expect(value).toBeTruthy()
      expect(label).toBeTruthy()
    }
  })
})
