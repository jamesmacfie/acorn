// Every pair of color tokens the site draws text or a meaningful rule with. The page draws in the site's
// palette (src/styles/tokens.css), checked in its day and night colors. A specimen's or a snapshot's
// frame draws in the app's own theme, checked in all 12. The themes were tuned for the app, so where a
// pair fails there the site pairs different tokens instead of changing a theme. Grey rules that only
// separate one part of a page from the next are decoration, which WCAG 1.4.11 leaves out, so `--border`
// is not checked.
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
const PICTURE_PAIRS = [
  ['--text', '--bg', TEXT, "a frame's caption and size"],
  ['--text', '--bg-subtle', TEXT, "a frame's bar and title"],
  ['--accent', '--bg-subtle', LARGE, "the selected tab in a frame's bar"],
]

const SITE_PAIRS = [
  ['--text', '--bg', TEXT, 'body text, headings, links, buttons'],
  ['--text', '--bg-subtle', TEXT, 'the stage, chrome bars, the sidebar, code, callouts, badges, keys, table headers'],
  ['--bg', '--accent', TEXT, 'primary buttons'],
  ['--accent', '--bg', LARGE, 'the current or hovered row, the selected tab, a hovered button, link underlines'],
  ['--accent', '--bg-subtle', LARGE, 'the selected tab in a chrome bar'],
  ['--focus', '--bg', LARGE, 'the focus ring'],
  ['--focus', '--bg-subtle', LARGE, 'the focus ring on the stage'],
]
// The hero's verb is display text on the stage, so only its night color is checked.
const NIGHT_PAIRS = [['--site-verb', '--bg-subtle', LARGE, "the hero's verb"]]

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

/** The site palette's two drops, day and night, as the tokens each declares. */
function paletteTokens() {
  const css = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8')
  const drops = {}
  postcss.parse(css).walkRules((rule) => {
    const drop = rule.selector.includes("data-color-scheme='dark'") ? 'night' : 'day'
    rule.walkDecls((decl) => {
      ;(drops[drop] ??= {})[decl.prop] = decl.value
    })
  })
  return drops
}

/** An `oklch()` color as [r, g, b] in sRGB, through OKLab (Björn Ottosson's matrices). */
function oklchToRgb(l, c, h) {
  const [a, b] = [c * Math.cos((h * Math.PI) / 180), c * Math.sin((h * Math.PI) / 180)]
  const [L, M, S] = [l + 0.3963377774 * a + 0.2158037573 * b, l - 0.1055613458 * a - 0.0638541728 * b, l - 0.0894841775 * a - 1.291485548 * b].map((v) => v ** 3)
  const linear = [
    4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
  ]
  return linear.map((v) => {
    const clamped = Math.min(1, Math.max(0, v))
    return Math.round((clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055) * 255)
  })
}

/** A token's color as [r, g, b], following `var()` to the hex or `oklch()` value it ends at. */
function resolve(tokens, name) {
  const value = tokens[name]
  const reference = value?.match(/^var\((--[\w-]+)\)$/)
  if (reference) return resolve(tokens, reference[1])
  const hex = value?.match(/^#([0-9a-f]{6})$/i)
  if (hex) return [0, 2, 4].map((at) => parseInt(hex[1].slice(at, at + 2), 16))
  const oklch = value?.match(/^oklch\(([\d.]+)% ([\d.]+) ([\d.]+)\)$/)
  if (oklch) return oklchToRgb(Number(oklch[1]) / 100, Number(oklch[2]), Number(oklch[3]))
  throw new Error(`${name} is ${value}, which this test can't read as a color`)
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

test('reads an oklch color as sRGB', () => {
  assert.deepEqual(oklchToRgb(1, 0, 0), [255, 255, 255])
  assert.deepEqual(oklchToRgb(0, 0, 0), [0, 0, 0])
  // oklch(62.8% 0.2577 29.23) is sRGB red.
  assert.deepEqual(oklchToRgb(0.628, 0.2577, 29.23), [255, 0, 0])
})

/** The pairs that fall under their minimum, as messages. */
function failing(name, tokens, pairs) {
  return pairs.flatMap(([fg, bg, minimum, where]) => {
    const ratio = contrast(resolve(tokens, fg), resolve(tokens, bg))
    return ratio < minimum ? [`${name}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1, under ${minimum}:1 (${where})`] : []
  })
}

test("every pair the site's palette draws is legible by day and by night", () => {
  const { day, night } = paletteTokens()
  assert.deepEqual([...failing('day', day, SITE_PAIRS), ...failing('night', night, [...SITE_PAIRS, ...NIGHT_PAIRS])], [])
})

test("every pair a picture's frame draws is legible in every theme", () => {
  assert.deepEqual(
    Object.entries(themeTokens()).flatMap(([theme, tokens]) => failing(theme, tokens, PICTURE_PAIRS)),
    [],
  )
})
