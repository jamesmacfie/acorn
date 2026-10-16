// Every Settings page acorn ships, read from where each is registered, and the check that the docs'
// settings reference covers each one through its pages' `covers` frontmatter (docs/site.md).
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pages, readCovers, ROOT } from './stale.mjs'

// Registered pages the reference leaves out on purpose, with the reason.
export const EXCLUDED = {
  gallery: 'The style gallery. The desktop registers it only in development builds.',
}

// Core's pages, read as a file rather than imported: client-core is TypeScript that plain Node can't
// load, and apps don't reach into a package by relative path.
// shortcut: takes every `id: '…'` after the array opens, which holds while the array spreads its search
// declarations from constants above it; import the table if this runs under a TypeScript loader.
const CORE = 'packages/client-core/src/features/settings/corePages.ts'
const corePages = () => {
  const table = readFileSync(join(ROOT, CORE), 'utf8').split('export const CORE_SETTINGS_PAGES = [')[1] ?? ''
  return [...table.matchAll(/\bid: '([^']+)'/g)].map((match) => match[1])
}

// A compiled plugin registers its pages from code that needs a host to run, so this reads the golden
// list the desktop's plugin-disable test derives by activating every compiled plugin, and fails on.
const COMPILED = 'apps/desktop/test/client/clientPluginDisable.snapshot.json'

// A loaded plugin declares its pages as settings frames in its manifest config.
// shortcut: reads every plugins/*/acorn-plugin.config.mjs, not only those BUNDLED_PLUGINS ships; read
// that list once a plugin that isn't bundled declares a settings frame.
async function loadedPages() {
  const configs = readdirSync(join(ROOT, 'plugins'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(ROOT, 'plugins', entry.name, 'acorn-plugin.config.mjs')))
    .map((entry) => entry.name)
  const pages = await Promise.all(
    configs.map(async (dir) => {
      const { default: config } = await import(join(ROOT, 'plugins', dir, 'acorn-plugin.config.mjs'))
      return (config.contributions?.frames ?? []).filter((frame) => frame.target === 'settings')
    }),
  )
  return pages.flat().map((frame) => frame.id)
}

/** Every shipped Settings page ID: core's, each compiled plugin's, and each loaded plugin's. */
export async function shippedSettingsPages() {
  const compiled = JSON.parse(readFileSync(join(ROOT, COMPILED), 'utf8')).full.settingsPages
  return [...corePages(), ...compiled, ...(await loadedPages())]
}

/** Each docs page with a `covers` list, as `{ file, covers }`. */
export const coveringPages = () =>
  pages()
    .filter((page) => /\.mdx?$/.test(page.file))
    .map((page) => ({ file: page.file, covers: readCovers(readFileSync(join(ROOT, page.file), 'utf8')) }))
    .filter((page) => page.covers.length > 0)

/** What's wrong between the registered pages and the docs that cover them. */
export function coverageProblems(registered, covering, excluded = EXCLUDED) {
  const covered = new Set(covering.flatMap((page) => page.covers))
  const known = new Set(registered)
  return [
    ...registered
      .filter((id) => !covered.has(id) && !(id in excluded))
      .map((id) => `Settings page ${id} is registered, and no settings docs page lists it in covers`),
    ...covering.flatMap((page) =>
      page.covers
        .filter((id) => !known.has(id) || id in excluded)
        .map((id) => `${page.file} covers ${id}, which isn't a shipped Settings page`),
    ),
  ]
}
