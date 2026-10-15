// Every pair of color tokens the site draws text or a meaningful rule with, checked in all 12 themes.
// The themes were tuned for the app, so where a pair fails the site pairs different tokens instead of
// changing a theme. Grey rules that only separate one part of a page from the next are decoration,
// which WCAG 1.4.11 leaves out, so `--border` is not checked.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import postcss from 'postcss'
import { appearances } from './acornUi.mjs'

const TEXT = 4.5
const LARGE = 3

// [foreground, background, minimum ratio, where the site uses it]
//
// The site never sets text in `--text-muted` or a tone color, or on `--bg-hover` or `--bg-selected`:
// muted text is 2.93:1 in Solarized Light, tone colors fall to 2.31:1 in Catppuccin Latte, and `--text`
// is 4.29:1 on `--bg-hover` and 3.89:1 on `--bg-selected` in Solarized Dark. So secondary text differs
// by size and case, a callout or badge shows its tone in its border beside a word that names it, and a
// hovered or current row is marked with an accent rule.
// scripts/siteCss.test.mjs fails on `color: var(--text-muted)` in the site's styles.
const PAIRS = [
  ['--text', '--bg', TEXT, 'body text, headings, links, buttons'],
  ['--text', '--bg-subtle', TEXT, 'chrome bars, the sidebar, code, callouts, badges, keys, table headers'],
  ['--bg', '--text', TEXT, 'primary buttons'],
  ['--accent', '--bg', LARGE, 'the current or hovered row, the selected tab, a hovered button'],
  ['--accent', '--bg-subtle', LARGE, 'the selected tab in a chrome bar'],
  ['--focus', '--bg', LARGE, 'the focus ring'],
]

const themeSheet = readFileSync(
  new URL('../../../packages/client-core/src/infra/styles/tokens-theme.css', import.meta.url),
  'utf8',
)

/** Each theme's tokens, as declared: the plain `:root` blocks, then the theme's own block on top. */
function themeTokens() {
  const base = {}
  const blocks = {}
  postcss.parse(themeSheet).walkRules((rule) => {
    if (rule.parent?.type === 'atrule') return
    const id = rule.selector === ':root' ? undefined : rule.selector.match(/^:root\[data-theme="([^"]+)"\]$/)?.[1]
    if (rule.selector !== ':root' && !id) return
    const target = id ? (blocks[id] ??= {}) : base
    rule.walkDecls((decl) => {
      target[decl.prop] = decl.value
    })
  })
  return Object.fromEntries(appearances().themes.map(({ id }) => [id, { ...base, ...blocks[id] }]))
}

/** A token's color as [r, g, b], following `var()` to the hex value it ends at. */
function resolve(tokens, name) {
  const value = tokens[name]
  const reference = value?.match(/^var\((--[\w-]+)\)$/)
  if (reference) return resolve(tokens, reference[1])
  const hex = value?.match(/^#([0-9a-f]{6})$/i)
  if (!hex) throw new Error(`${name} is ${value}, which this test can't read as a color`)
  return [0, 2, 4].map((at) => parseInt(hex[1].slice(at, at + 2), 16))
}

/** WCAG 2 relative luminance and contrast ratio. */
const luminance = (rgb) => {
  const [r, g, b] = rgb.map((channel) => {
    const c = channel / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a, b) => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light + 0.05) / (dark + 0.05)
}

test('the contrast formula matches WCAG', () => {
  assert.equal(contrast([0, 0, 0], [255, 255, 255]), 21)
  assert.equal(Math.round(contrast([0x74, 0x74, 0x74], [255, 255, 255]) * 100) / 100, 4.67)
})

test('every pair the site uses is legible in every theme', () => {
  const failures = []
  for (const [theme, tokens] of Object.entries(themeTokens())) {
    for (const [fg, bg, minimum, where] of PAIRS) {
      const ratio = contrast(resolve(tokens, fg), resolve(tokens, bg))
      if (ratio < minimum) failures.push(`${theme}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1, under ${minimum}:1 (${where})`)
    }
  }
  assert.deepEqual(failures, [])
})
