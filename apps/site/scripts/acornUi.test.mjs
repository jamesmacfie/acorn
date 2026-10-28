import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import postcss from 'postcss'
import { acornUiCss, appearances, darkScope, pictureScopes, scopeSelector, SITE_THEMES } from './acornUi.mjs'

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
  // A token block sits on <html>, a `.site-dark` element, or a picture of acorn.
  const rootOnly = new RegExp(`^(?::root${qualifiers}|\\.site-dark|:root(?:${qualifiers}|\\s+\\.site-dark)\\s+:is\\(\\.specimen, \\.snapshot\\))$`)
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

test('the dark scope restates the dark theme and every token derived from it', () => {
  const declarations = {}
  postcss.parse(darkScope()).walkDecls((decl) => {
    declarations[decl.prop] = decl.value
  })
  assert.ok(appearances().dark.includes(SITE_THEMES.dark), `${SITE_THEMES.dark} is a dark theme`)
  assert.match(declarations['--bg'], /^#[0-9a-f]{6}$/i)
  assert.equal(declarations['--card-bg'], 'var(--bg)')
  // A token with no var() in it isn't derived, so the scope inherits it rather than resetting it.
  assert.equal(declarations['--font-mono'], undefined)
  assert.ok(Object.keys(declarations).every((prop) => prop.startsWith('--')))
})

test("a picture of acorn draws in the app's own theme: Latte on a light page, Mocha on a dark one and on the stage", () => {
  const blocks = {}
  postcss.parse(pictureScopes()).walkRules((rule) => {
    const declarations = {}
    rule.walkDecls((decl) => {
      declarations[decl.prop] = decl.value
    })
    for (const selector of rule.selectors) blocks[selector] = declarations
  })
  const theme = (id) => {
    const block = {}
    postcss.parse(readFileSync(new URL('../../../packages/client-core/src/infra/styles/tokens-theme.css', import.meta.url), 'utf8')).walkRules(`:root[data-theme="${id}"]`, (rule) => {
      rule.walkDecls((decl) => {
        block[decl.prop] = decl.value
      })
    })
    return block
  }
  const pictures = ':is(.specimen, .snapshot)'
  assert.equal(blocks[`:root[data-color-scheme="light"] ${pictures}`]['--bg'], theme(SITE_THEMES.light)['--bg'])
  assert.equal(blocks[`:root[data-color-scheme="dark"] ${pictures}`]['--bg'], theme(SITE_THEMES.dark)['--bg'])
  assert.equal(blocks[`:root .site-dark ${pictures}`]['--accent'], theme(SITE_THEMES.dark)['--accent'])
  assert.equal(blocks[`:root .site-dark ${pictures}`]['--card-bg'], 'var(--bg)')
})

test('keeps the kit rules the site draws outside specimens', () => {
  const css = acornUiCss()
  assert.match(css, /\.acorn-ui \.ui-kbd-key/)
  assert.match(css, /\.acorn-ui \.ui-badge\[data-tone='warn'\]/)
})

test('finds the 12 themes and 4 style packs, with their labels, and which themes are dark', () => {
  const { themes, styles, dark } = appearances()
  assert.equal(themes.length, 12)
  assert.deepEqual(themes[0], { id: 'light', label: 'Light' })
  assert.deepEqual(styles.map(({ id }) => id), ['terminal', 'modern', 'cozy', 'cute'])
  assert.deepEqual(
    themes.map(({ id }) => id).filter((id) => !dark.includes(id)),
    ['light', 'solarized-light', 'catppuccin-latte'],
  )
  assert.equal(dark.length, 9)
})
