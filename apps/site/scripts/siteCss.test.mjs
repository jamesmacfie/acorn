// The site takes every color from acorn's theme tokens, so the light and dark themes restyle all of it.
// This fails on a color written into the site's own styles: src/styles/site.css and the <style> blocks
// in its components, layouts, and lab pages. The wireframes are grey boxes on purpose, so they're left out.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import postcss from 'postcss'

const SRC = new URL('../src/', import.meta.url)

// Words a color property may hold that aren't a color.
const KEYWORDS = new Set(['transparent', 'currentcolor', 'inherit', 'initial', 'unset', 'revert', 'revert-layer'])
const HEX = /#[0-9a-f]{3,8}\b/i
const COLOR_FUNCTION = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i
// Text in these tokens fails contrast in some themes. scripts/contrast.test.mjs says which.
const ILLEGIBLE = /var\(--(?:text-muted|text-faint|state-ok|state-warn|state-bad|success|warn|danger)\)/

/** Every stylesheet the site writes itself, as [file, css]. */
function siteStyles() {
  return readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .filter((file) => !file.startsWith('lab/wireframes/') && /\.(css|astro)$/.test(file))
    .flatMap((file) => {
      const text = readFileSync(new URL(file, SRC), 'utf8')
      if (file.endsWith('.css')) return [[file, text]]
      return [...text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map(([, css]) => [file, css])
    })
}

/** Is a bare word in a value a named color, by the browser's own reading? */
const probe = new JSDOM('').window.document.createElement('i')
function isNamedColor(word) {
  if (KEYWORDS.has(word.toLowerCase())) return false
  probe.style.color = ''
  probe.style.color = word
  return probe.style.color !== ''
}

/** The colors a stylesheet writes, as `file: property: value`. */
function literalColors(file, css) {
  const found = []
  postcss.parse(css).walkDecls((decl) => {
    // Custom property names, strings, and URLs can hold color-like words that aren't colors.
    const value = decl.value.replace(/var\(--[\w-]+/g, '').replace(/(["']).*?\1|url\([^)]*\)/g, '')
    // A word before a parenthesis is a function, such as `tan()`, not the color of the same name.
    const words = value.match(/(?<![\w-])[a-z]+(?![\w(-])/gi) ?? []
    if (HEX.test(value) || COLOR_FUNCTION.test(value) || words.some(isNamedColor)) {
      found.push(`${file}: ${decl.prop}: ${decl.value}`)
    }
  })
  return found
}

test('finds a literal color in any of its forms', () => {
  for (const css of ['a { color: #fff }', 'a { border: 1px solid red }', 'a { background: rgb(0 0 0 / 50%) }']) {
    assert.equal(literalColors('probe.css', css).length, 1, css)
  }
  const tokens = 'a { color: var(--text); border: var(--bw) solid transparent; font-weight: bold }'
  assert.deepEqual(literalColors('probe.css', tokens), [])
})

test("the site's styles write no color of their own", () => {
  const styles = siteStyles()
  assert.ok(styles.some(([file]) => file === 'styles/site.css'), 'reads site.css')
  assert.deepEqual(
    styles.flatMap(([file, css]) => literalColors(file, css)),
    [],
  )
})

test("the site's text uses only the tokens that are legible in every theme", () => {
  const illegible = []
  for (const [file, css] of siteStyles()) {
    postcss.parse(css).walkDecls((decl) => {
      if (decl.prop === 'color' && ILLEGIBLE.test(decl.value)) illegible.push(`${file}: ${decl.toString()}`)
    })
  }
  assert.deepEqual(illegible, [])
})
