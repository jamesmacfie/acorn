import { describe, expect, it } from 'vitest'
import { readStyleSheets, stripComments } from '../styles/readStyleSheets'
import { THEMES } from './themes'

// Drift guard (docs/ui-design.md): the Appearance THEMES picker is hand-synced with the
// `:root[data-theme="…"]` blocks in styles/tokens-theme.css. This reads the stylesheets and asserts
// the two sets match, so adding/removing a theme in one place fails the suite until both agree.
//
// Globs the stylesheets rather than naming one file: the token layer has already been split once
// (tokens-layout.css → tokens-{invariant,style,theme}.css + base.css + shell.css) and a test that
// hardcodes a path just breaks on the next split.
describe('THEMES ↔ stylesheets', () => {
  it('lists exactly the themes the stylesheets define', () => {
    const css = stripComments(readStyleSheets().map((f) => f.text).join('\n'))
    // 'light' is the :root default (no data-theme block); every other theme has an attribute block.
    const inCss = new Set(['light', ...[...css.matchAll(/:root\[data-theme=["']([^"']+)["']\]/g)].map((m) => m[1])])
    expect(new Set(THEMES().map(([value]) => value))).toEqual(inCss)
  })

  it('gives every theme a label', () => {
    for (const [value, label] of THEMES()) {
      expect(value).toBeTruthy()
      expect(label).toBeTruthy()
    }
  })
})
