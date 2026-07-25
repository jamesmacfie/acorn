import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Test-only helper: read every stylesheet in the renderer as text. The appearance contract is
// expressed in CSS, so the tests that enforce it (settings/themes.test.ts, styles/tokenAxes.test.ts)
// parse the sheets rather than booting a browser — jsdom does not resolve var() cascades reliably,
// so a computed-style assertion there would give false confidence.

export type StyleSheetFile = { path: string; name: string; text: string }

/** Drop CSS comments. Prose mentions selectors and values; scanners must not count them. */
export const stripComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '')

const clientRoot = fileURLToPath(new URL('..', import.meta.url))

/** Every `.css` file under `core/` and `plugins/`, recursively. */
export function readStyleSheets(): StyleSheetFile[] {
  const srcRoot = join(clientRoot, '..', '..')
  return [...walk(join(srcRoot, 'core')), ...walk(join(srcRoot, 'plugins'))]
}

/** Just the token-axis sheets, which are the ones the orthogonality contract applies to. */
export function readAxisSheets(): StyleSheetFile[] {
  const dir = fileURLToPath(new URL('.', import.meta.url))
  return readdirSync(dir)
    .filter((name) => name.startsWith('tokens-') && name.endsWith('.css'))
    .map((name) => ({ path: join(dir, name), name, text: readFileSync(join(dir, name), 'utf8') }))
}

/** The per-style packs, `styles/style-<id>.css`. Empty until the first pack lands. */
export function readStylePacks(): StyleSheetFile[] {
  const dir = fileURLToPath(new URL('.', import.meta.url))
  return readdirSync(dir)
    .filter((name) => name.startsWith('style-') && name.endsWith('.css'))
    .map((name) => ({ path: join(dir, name), name, text: readFileSync(join(dir, name), 'utf8') }))
}

function walk(dir: string): StyleSheetFile[] {
  const out: StyleSheetFile[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(path))
    else if (entry.name.endsWith('.css')) out.push({ path, name: entry.name, text: readFileSync(path, 'utf8') })
  }
  return out
}

/**
 * Custom properties DECLARED (not merely referenced) by each `:root…` block in a sheet, keyed by
 * the block's selector. Deliberately a small hand-rolled scanner rather than a CSS parser
 * dependency: the axis files are flat `:root { … }` blocks with no nesting.
 */
export function declaredByBlock(text: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  // Strip comments so a commented-out declaration or a `--token` mentioned in prose is not counted.
  const stripped = text.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const match of stripped.matchAll(/(:root[^{]*)\{([^}]*)\}/g)) {
    const selector = match[1].trim()
    const names = new Set([...match[2].matchAll(/(^|[;\s])(--[a-z0-9-]+)\s*:/gi)].map((m) => m[2]))
    const existing = out.get(selector)
    if (existing) for (const name of names) existing.add(name)
    else out.set(selector, names)
  }
  return out
}

/** Every custom property referenced via `var(--x)` anywhere in the text. */
export function referenced(text: string): Set<string> {
  const stripped = text.replace(/\/\*[\s\S]*?\*\//g, '')
  return new Set([...stripped.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)].map((m) => m[1]))
}
