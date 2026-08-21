import { describe, expect, it } from 'vitest'
import { readStyleSheets, stripComments } from '../styles/readStyleSheets'
import { STYLES } from './uiStyles'

// Drift guard, mirroring themes.test.ts (docs/ui-design.md § Style packs): the Appearance styles
// picker is hand-synced with the `:root[data-style="…"]` blocks in styles/style-*.css. Offering a
// style with no pack behind it would silently render as Terminal.
describe('STYLES ↔ stylesheets', () => {
  it('lists exactly the styles the stylesheets define', () => {
    const css = stripComments(readStyleSheets().map((f) => f.text).join('\n'))
    // 'terminal' is the :root default (no data-style block), exactly as 'light' is for themes.
    const inCss = new Set(['terminal', ...[...css.matchAll(/:root\[data-style=["']([^"']+)["']\]/g)].map((m) => m[1])])
    expect(new Set(STYLES().map(([value]) => value))).toEqual(inCss)
  })

  it('gives every style a label', () => {
    for (const [value, label] of STYLES()) {
      expect(value).toBeTruthy()
      expect(label).toBeTruthy()
    }
  })

  it('always offers terminal, the attribute-less default', () => {
    expect(STYLES().map(([value]) => value)).toContain('terminal')
  })
})
