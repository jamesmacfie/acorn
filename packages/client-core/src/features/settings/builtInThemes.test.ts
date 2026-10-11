import { describe, expect, it } from 'vitest'
import { readStyleSheets, stripComments } from '../../infra/styles/readStyleSheets'
import { PLUGIN_THEME_PREFIX } from '../../host/chrome/chromeThemes'
import { THEMES } from './builtInThemes'

// Drift guard (docs/ui-design/appearance.md § Plugin themes): the Appearance themes picker is hand-synced with
// the `:root[data-theme="…"]` blocks in styles/tokens-theme.css. This reads the stylesheets and
// asserts the two sets match, so adding or removing a theme in one place fails the suite until both
// agree. It globs the stylesheets rather than naming one file, so splitting the token layer doesn't
// break it.
//
// A plugin-contributed theme has a definition the host generates (`pluginThemeBlock`) rather than a
// block in a file. So the set comparison below is scoped to the built-in half, and the namespace that
// separates the two halves is asserted in both directions: a stylesheet may not define a `plugin:`
// theme, and the built-in list may not contain one. chromeThemes.test.ts pins the generated half.
describe('THEMES ↔ stylesheets', () => {
  const css = stripComments(
    readStyleSheets()
      .map((f) => f.text)
      .join('\n'),
  )
  const inCss = new Set([
    // 'light' is the :root default (no data-theme block); every other theme has an attribute block.
    'light',
    ...[...css.matchAll(/:root\[data-theme=["']([^"']+)["']\]/g)].map((m) => m[1]),
  ])
  const registered = THEMES().map(([value]) => value)

  it('lists exactly the themes the stylesheets define', () => {
    expect(new Set(registered.filter((id) => !id.startsWith(PLUGIN_THEME_PREFIX)))).toEqual(inCss)
    // Anti-vacuity: a filter that started dropping everything would satisfy an empty-set comparison.
    expect(inCss.size).toBeGreaterThan(10)
  })

  it('keeps the plugin namespace out of the stylesheets and out of the built-in list', () => {
    // The prefix is what lets a plugin theme be selected by the same picker without a plugin ever
    // being able to redefine a built-in: a stylesheet that claimed one would be shadowed by, or would
    // shadow, a host-generated block at identical specificity depending only on load order.
    expect([...inCss].filter((id) => id.startsWith(PLUGIN_THEME_PREFIX))).toEqual([])
    expect(registered.filter((id) => id.includes(':') && !id.startsWith(PLUGIN_THEME_PREFIX))).toEqual([])
  })

  it('gives every theme a label', () => {
    for (const [value, label] of THEMES()) {
      expect(value).toBeTruthy()
      expect(label).toBeTruthy()
    }
  })
})
