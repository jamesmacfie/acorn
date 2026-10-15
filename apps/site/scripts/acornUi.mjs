// The app's stylesheets, rewritten for the site (docs/site/specimens.md). A specimen's HTML is the
// desktop's own markup, so it needs the desktop's own CSS, read from client-core at build time so a
// stylesheet change reaches the site with no copy step.
//
// The token blocks, `:root` rules that only declare custom properties, stay global: `data-theme` and
// `data-style` on <html> drive the site and every specimen at once. Every other rule is rewritten to
// apply only inside `.acorn-ui`, and a rule no committed specimen uses is dropped.
import { readFileSync, readdirSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import postcss from 'postcss'

const STYLES = new URL('../../../packages/client-core/src/infra/styles/', import.meta.url)
const SPECIMENS = new URL('../src/generated/specimens/', import.meta.url)

// The site chooses its own fonts, so it leaves the app's font files out.
const SKIPPED = new Set(['fonts.css'])

/** The sheets the app's stylesheet manifest imports, in its order. The manifest's own rules hide
 *  every scrollbar on the page, so the site leaves those out too. */
function appSheets() {
  const manifest = readFileSync(new URL('styles.css', STYLES), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  return [...manifest.matchAll(/@import\s+'\.\/([^']+)'/g)]
    .map(([, name]) => name)
    .filter((name) => !SKIPPED.has(name))
    .map((name) => readFileSync(new URL(name, STYLES), 'utf8'))
}

// What may qualify the root element, such as `[data-style='cozy']` or `:not([data-theme="light"])`.
const QUALIFIERS = String.raw`(?:\[[^\]]*\]|:not\([^)]*\))*`
// A selector's leading `html`, `body`, or `:root`, with its qualifiers.
const ROOT = new RegExp(String.raw`^(?:html|body|:root)(${QUALIFIERS})(?=$|[\s>+~])`)
const ROOT_ONLY = new RegExp(`^:root${QUALIFIERS}$`)
const ROOT_PREFIX = new RegExp(String.raw`^:root${QUALIFIERS}\s+`)

const isTokenBlock = (rule) =>
  rule.selectors.every((selector) => ROOT_ONLY.test(selector)) &&
  rule.nodes.every((node) => node.type !== 'decl' || node.prop.startsWith('--'))

const inKeyframes = (rule) => rule.parent?.type === 'atrule' && /keyframes$/i.test(rule.parent.name)

/** One selector, applying only inside `.acorn-ui`. A rule for the document's root element moves onto
 *  `.acorn-ui` itself, and a qualifier on the root stays there, so a style pack still keys off <html>. */
export function scopeSelector(selector) {
  const root = selector.match(ROOT)
  if (!root) return `.acorn-ui ${selector}`
  const qualifier = root[1] ? `:root${root[1]} ` : ''
  return `${qualifier}.acorn-ui${selector.slice(root[0].length)}`
}

// What a static picture can't be in, so a rule for it is kept when the element it styles exists.
const STATE = /::?(?:hover|focus-visible|focus-within|focus|active|visited|target|before|after|placeholder|selection|marker|backdrop|-webkit-[\w-]+|-moz-[\w-]+)\b/g

/** Does a scoped selector match anything in the specimens? A selector jsdom can't parse counts as a
 *  match, because dropping a rule is the riskier mistake. */
function matches(document, selector) {
  const subject = selector.replace(ROOT_PREFIX, '').replace(STATE, '').trim()
  try {
    return document.querySelector(/[\s>+~]$/.test(subject) ? `${subject} *` : subject) !== null
  } catch {
    return true
  }
}

/** Every committed specimen's desktop HTML, in one document. */
function specimenDocument() {
  const html = readdirSync(SPECIMENS)
    .filter((name) => name.endsWith('.html'))
    .map((name) => readFileSync(new URL(name, SPECIMENS), 'utf8'))
    .join('')
  return new JSDOM(`<div class="acorn-ui">${html}</div>`).window.document
}

/** The specimen stylesheet: the app's sheets, scoped to `.acorn-ui` and pruned to what the specimens use. */
export function acornUiCss() {
  const document = specimenDocument()
  const sheet = postcss.parse(appSheets().join('\n'))
  sheet.walkComments((comment) => comment.remove())
  sheet.walkRules((rule) => {
    if (inKeyframes(rule) || isTokenBlock(rule)) return
    const used = rule.selectors.map(scopeSelector).filter((selector) => matches(document, selector))
    if (used.length > 0) rule.selectors = [...new Set(used)]
    else rule.remove()
  })
  sheet.walkAtRules((atRule) => {
    if (atRule.nodes?.length === 0) atRule.remove()
  })
  return sheet.toString()
}

// What the plugin serves, by id: the specimen stylesheet, and the theme and style pack ids for a picker.
const MODULES = {
  'virtual:acorn-ui.css': () => acornUiCss(),
  'virtual:acorn-ui/appearances': () => `export default ${JSON.stringify(appearances())}`,
}

/** Serves `virtual:acorn-ui.css` and `virtual:acorn-ui/appearances`, rebuilt on every build and dev start. */
export function acornUi() {
  return {
    name: 'acorn-ui',
    resolveId: (id) => (id in MODULES ? `\0${id}` : undefined),
    load: (id) => (id.startsWith('\0') ? MODULES[id.slice(1)]?.() : undefined),
  }
}

/** The themes and style packs the token files define, by id. `light` and `terminal` are the plain
 *  `:root` defaults, with no block of their own. */
export function appearances() {
  const themes = readFileSync(new URL('tokens-theme.css', STYLES), 'utf8')
  return {
    themes: ['light', ...[...themes.matchAll(/:root\[data-theme="([^"]+)"\]/g)].map(([, id]) => id)],
    styles: [
      'terminal',
      ...readdirSync(STYLES)
        .map((name) => name.match(/^style-(.+)\.css$/)?.[1])
        .filter(Boolean),
    ],
  }
}
