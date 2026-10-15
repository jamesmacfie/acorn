// Fails when a built page outgrows its byte budget, or loads anything from another origin.
// Run after `astro build`: `node scripts/budget.mjs [dist]`.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { brotliCompressSync } from 'node:zlib'

const SITE = 'https://acorn.sh'
const KB = 1024

// Brotli-compressed bytes of the HTML plus every stylesheet and script the page loads. Images and
// fonts don't count. Tighten these once real pages exist.
const BUDGETS = {
  landing: { js: 10 * KB, total: 150 * KB },
  marketing: { js: 10 * KB },
  docs: { total: 100 * KB },
}

// <link> relations that make the browser fetch the target. Others, such as canonical, only name a URL.
const FETCHING_RELS = new Set(['stylesheet', 'preload', 'modulepreload', 'prefetch', 'icon', 'apple-touch-icon', 'manifest'])

const TAG = /<(script|link|img|iframe|source|video|audio|embed|object)\b[^>]*>/gi
const INLINE_SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi
// A static import or re-export in a built module. Dynamic `import()` loads on demand, so it's left out.
const STATIC_IMPORT = /\b(?:import|export)\s*(?:[^'"();]*?\bfrom\s*)?["']([^"']+)["']/g

const brotli = (text) => brotliCompressSync(text).length

function attr(tag, name) {
  const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))
  return match ? (match[1] ?? match[2] ?? match[3]) : undefined
}

function kindOf(page) {
  if (page === 'index.html') return 'landing'
  if (page.startsWith('lab/')) return undefined
  if (page.startsWith('docs/') || page === '404.html') return 'docs'
  return 'marketing'
}

function htmlPages(dir, prefix = '') {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = prefix + entry.name
    if (entry.isDirectory()) return htmlPages(join(dir, entry.name), `${rel}/`)
    return entry.name.endsWith('.html') ? [rel] : []
  })
}

/** Measures one built page: its sizes, and every URL it loads from another origin. */
function measure(dist, page) {
  const html = readFileSync(join(dist, page), 'utf8')
  const pageUrl = new URL(page, `${SITE}/`)
  const foreign = []
  const styles = new Set()
  const scripts = new Set()

  for (const [tag, name] of html.matchAll(TAG)) {
    const element = name.toLowerCase()
    const rel = element === 'link' ? (attr(tag, 'rel') ?? '').toLowerCase().split(/\s+/) : []
    if (element === 'link' && !rel.some((value) => FETCHING_RELS.has(value))) continue
    const ref = element === 'link' ? attr(tag, 'href') : (attr(tag, 'src') ?? attr(tag, 'data'))
    if (!ref) continue
    const url = new URL(ref, pageUrl)
    if (url.protocol === 'data:') continue
    if (url.origin !== SITE) {
      foreign.push(ref)
      continue
    }
    if (rel.includes('stylesheet')) styles.add(url.pathname)
    if (element === 'script' || rel.includes('modulepreload')) scripts.add(url.pathname)
  }

  // A module's static imports load with it, so follow them.
  for (const path of scripts) {
    for (const [, ref] of readFileSync(join(dist, path), 'utf8').matchAll(STATIC_IMPORT)) {
      const url = new URL(ref, `${SITE}${path}`)
      if (url.origin === SITE) scripts.add(url.pathname)
      else foreign.push(ref)
    }
  }

  const fileBytes = (paths) => [...paths].reduce((sum, path) => sum + brotli(readFileSync(join(dist, path))), 0)
  const inlineJs = [...html.matchAll(INLINE_SCRIPT)]
    .filter(([, attrs, body]) => body.trim() && !/\bsrc\s*=|type\s*=\s*["']?application\/(ld\+)?json/i.test(attrs))
    .reduce((sum, [, , body]) => sum + brotli(body), 0)
  const js = inlineJs + fileBytes(scripts)
  // Inline scripts are already inside the HTML's bytes.
  const total = brotli(html) + fileBytes(styles) + fileBytes(scripts)
  return { js, total, foreign }
}

/** Every budget and origin failure in a built site, as readable lines. */
export function checkBudgets(dist) {
  const failures = []
  for (const page of htmlPages(dist)) {
    const kind = kindOf(page)
    if (!kind) continue
    const { js, total, foreign } = measure(dist, page)
    const budget = BUDGETS[kind]
    const kb = (bytes) => `${(bytes / KB).toFixed(1)} KB`
    if (budget.js !== undefined && js > budget.js) failures.push(`${page}: ${kb(js)} of JavaScript, budget ${kb(budget.js)}`)
    if (budget.total !== undefined && total > budget.total)
      failures.push(`${page}: ${kb(total)} in total, budget ${kb(budget.total)}`)
    for (const ref of foreign) failures.push(`${page}: loads ${ref} from another origin`)
  }
  return failures
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dist = process.argv[2] ?? fileURLToPath(new URL('../dist/', import.meta.url))
  const failures = checkBudgets(dist)
  if (failures.length > 0) {
    console.error(`Page budget failed:\n${failures.map((line) => `  ${line}`).join('\n')}`)
    process.exit(1)
  }
  console.log('Every page is within its budget and loads only from its own origin.')
}
