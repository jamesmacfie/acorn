import assert from 'node:assert/strict'
import { test } from 'node:test'
import postcss from 'postcss'
import { acornUiCss, appearances, scopeSelector } from './acornUi.mjs'

test('a selector applies only inside .acorn-ui', () => {
  assert.equal(scopeSelector('.ui-btn'), '.acorn-ui .ui-btn')
  assert.equal(scopeSelector('*'), '.acorn-ui *')
  assert.equal(scopeSelector('html'), '.acorn-ui')
  assert.equal(scopeSelector('body .muted'), '.acorn-ui .muted')
  assert.equal(scopeSelector(":root[data-style='cute'] .ui-row"), ":root[data-style='cute'] .acorn-ui .ui-row")
})

test('every rule in the specimen stylesheet applies only inside .acorn-ui, apart from the tokens', () => {
  const css = acornUiCss()
  const sheet = postcss.parse(css)
  const qualifiers = String.raw`(?:\[[^\]]*\]|:not\([^)]*\))*`
  const scoped = new RegExp(String.raw`^(:root${qualifiers}\s+)?\.acorn-ui(?![\w-])`)
  const rootOnly = new RegExp(`^:root${qualifiers}$`)
  let rules = 0
  sheet.walkRules((rule) => {
    if (rule.parent?.type === 'atrule' && /keyframes$/i.test(rule.parent.name)) return
    rules += 1
    const tokenBlock =
      rule.selectors.every((selector) => rootOnly.test(selector)) &&
      rule.nodes.every((node) => node.type !== 'decl' || node.prop.startsWith('--'))
    if (tokenBlock) return
    for (const selector of rule.selectors) assert.match(selector, scoped)
  })
  // A generator that pruned everything would pass the loop above.
  assert.ok(rules > 50, `only ${rules} rules`)
  assert.match(css, /\.acorn-ui \.ui-btn/)
  // The system's dark preference reaches the tokens before any script runs.
  assert.match(css, /prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)/)
})

test('finds the 12 themes and 4 style packs', () => {
  const { themes, styles } = appearances()
  assert.equal(themes.length, 12)
  assert.deepEqual(styles.toSorted(), ['cozy', 'cute', 'modern', 'terminal'])
})
