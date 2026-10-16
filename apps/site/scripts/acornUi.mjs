// The app's stylesheets, rewritten for the site (docs/site/specimens.md). A specimen's or a shell
// snapshot's HTML is the desktop's own markup, so it needs the desktop's own CSS, read from client-core
// at build time so a stylesheet change reaches the site with no copy step.
//
// The token blocks, `:root` rules that only declare custom properties, stay global: `data-theme` and
// `data-style` on <html> drive the site and every specimen at once. Every other rule is rewritten to
// apply only inside `.acorn-ui`, and a rule that no committed specimen or snapshot uses is dropped.
import { readFileSync, readdirSync } from 'node:fs'
import { relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import postcss from 'postcss'

const CLIENT_CORE = new URL('../../../packages/client-core/src/', import.meta.url)
const STYLES = new URL('infra/styles/', CLIENT_CORE)
const SETTINGS = new URL('features/settings/', CLIENT_CORE)
const SIDEBAR = new URL('../../extension/src/sidebar/sidebar.css', import.meta.url)
const GENERATED = [
  new URL('../src/generated/specimens/', import.meta.url),
  new URL('../src/generated/snapshots/', import.meta.url),
  new URL('../src/generated/sidebar/', import.meta.url),
]

// The site chooses its own fonts, so it leaves the app's font files out.
const SKIPPED = new Set(['fonts.css'])

/** The sheets the app's stylesheet manifest imports, in its order, then every feature's own sheet,
 *  which its components import, by path. The manifest's own rules hide every scrollbar on the page,
 *  so the site leaves those out too. */
function appSheets() {
  const manifest = readFileSync(new URL('styles.css', STYLES), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const imported = [...manifest.matchAll(/@import\s+'\.\/([^']+)'/g)]
    .map(([, name]) => name)
    .filter((name) => !SKIPPED.has(name))
    .map((name) => new URL(name, STYLES))
  const root = fileURLToPath(CLIENT_CORE)
  const features = readdirSync(root, { recursive: true })
    .filter((path) => path.endsWith('.css') && !path.startsWith(relative(root, fileURLToPath(STYLES))))
    .sort()
    .map((path) => new URL(path, CLIENT_CORE))
  return [...imported, ...features].map((url) => readFileSync(url, 'utf8'))
}

// Kit components the site draws with the kit's own markup, outside any specimen: badges, key caps, and
// the command palette search draws as. Their rules stay whether or not a specimen uses them.
const SITE_KIT = /\.ui-(?:badge|kbd|input)\b|\.overlay(?![\w-])|\.palette-(?:list|row|label|hint|empty)\b/

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

/** One selector, applying only inside `scope`. A rule for the document's root element moves onto the
 *  scope itself, and a qualifier on the root stays there, so a style pack still keys off <html>. */
export function scopeSelector(selector, scope = '.acorn-ui') {
  const root = selector.match(ROOT)
  if (!root) return `${scope} ${selector}`
  const qualifier = root[1] ? `:root${root[1]} ` : ''
  return `${qualifier}${scope}${selector.slice(root[0].length)}`
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

/** Every committed specimen's and snapshot's desktop HTML, in one document. */
function generatedDocument() {
  const html = GENERATED.flatMap((dir) =>
    readdirSync(dir)
      .filter((name) => name.endsWith('.html'))
      .map((name) => readFileSync(new URL(name, dir), 'utf8')),
  ).join('')
  return new JSDOM(`<div class="acorn-ui">${html}</div>`).window.document
}

/** The specimen stylesheet: the app's sheets, scoped to `.acorn-ui` and pruned to what the specimens and
 *  snapshots use. */
export function acornUiCss() {
  const document = generatedDocument()
  const scoped = (css, scope) => {
    const sheet = postcss.parse(css)
    sheet.walkComments((comment) => comment.remove())
    sheet.walkRules((rule) => {
      if (inKeyframes(rule) || isTokenBlock(rule)) return
      const used = rule.selectors
        .map((selector) => scopeSelector(selector, scope))
        .filter((selector) => SITE_KIT.test(selector) || matches(document, selector))
      if (used.length > 0) rule.selectors = [...new Set(used)]
      else rule.remove()
    })
    sheet.walkAtRules((atRule) => {
      if (atRule.nodes?.length === 0) atRule.remove()
    })
    return sheet.toString()
  }
  // The browser extension's panel has its own sheet, with class names the shell uses too, so it
  // applies only inside a browser snapshot's panel and a sidebar picture.
  return [scoped(appSheets().join('\n'), '.acorn-ui'), scoped(readFileSync(SIDEBAR, 'utf8'), '.acorn-ui .snapshot-sidebar')].join('\n')
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

/** The themes and style packs, in the app's order and with the app's labels, and the ids of the dark
 *  themes: those whose token block sets `--is-dark: 1`. `light` and `terminal` are the plain `:root`
 *  defaults, with no block of their own. */
export function appearances() {
  const entries = (file) =>
    [...readFileSync(new URL(file, SETTINGS), 'utf8').matchAll(/\{ id: '([^']+)', label: '([^']+)'/g)].map(
      ([, id, label]) => ({ id, label }),
    )
  const blocks = readFileSync(new URL('tokens-theme.css', STYLES), 'utf8').matchAll(/:root\[data-theme="([^"]+)"\]\s*\{([^}]*)\}/g)
  return {
    themes: entries('builtInThemes.ts'),
    styles: entries('uiStyles.ts'),
    dark: [...blocks].filter(([, , body]) => /--is-dark:\s*1\b/.test(body)).map(([, id]) => id),
  }
}
