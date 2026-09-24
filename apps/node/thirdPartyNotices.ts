import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Plugin } from 'vite'

// The licence text of every third-party package a build bundles, as one file beside the output.
// Bundling copies a package's code into acorn's files, and most of these licences (MIT, ISC, BSD,
// Apache-2.0) ask that the notice travel with the code. A package left external keeps its own licence
// file in node_modules, so it is not listed (./externals.ts).
//
// Shared by the service build (./vite.config.ts) and the desktop helper's
// (apps/desktop/vite.helper.config.ts), each under its own file name, because both land in the same
// folder.

const LICENCE_FILE = /^(licen[cs]e|notice|copying)(\.|$)/i

// `…/node_modules/<name>/…` or `…/node_modules/@scope/<name>/…`, taking the last node_modules in the
// path, which is the package the module belongs to under pnpm's layout.
const packageRoot = (id: string): string | null => {
  const at = id.lastIndexOf('/node_modules/')
  if (at === -1) return null
  const rest = id.slice(at + '/node_modules/'.length).split('/')
  const depth = rest[0]?.startsWith('@') ? 2 : 1
  return `${id.slice(0, at)}/node_modules/${rest.slice(0, depth).join('/')}`
}

export const thirdPartyNotices = (fileName: string): Plugin => ({
  name: 'acorn:third-party-notices',
  apply: 'build',
  generateBundle(_, bundle) {
    const roots = new Set<string>()
    for (const output of Object.values(bundle)) {
      if (output.type !== 'chunk') continue
      for (const id of output.moduleIds) {
        const root = packageRoot(id.replace(/^\0/, ''))
        if (root && existsSync(join(root, 'package.json'))) roots.add(root)
      }
    }
    const entries = [...roots].map((root) => {
      const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name: string; version: string; license?: string }
      const texts = readdirSync(root)
        .filter((name) => LICENCE_FILE.test(name))
        .sort()
        .map((name) => readFileSync(join(root, name), 'utf8').trim())
      const text = texts.length > 0 ? texts.join('\n\n') : `No licence file is published with this package. Its package.json declares: ${manifest.license ?? 'nothing'}.`
      return { heading: `${manifest.name}@${manifest.version} (${manifest.license ?? 'unknown'})`, text }
    })
    // One pnpm directory per peer-dependency set, so the same version can appear twice.
    const unique = [...new Map(entries.map((entry) => [entry.heading, entry])).values()]
    unique.sort((a, b) => a.heading.localeCompare(b.heading))
    const source = unique.map(({ heading, text }) => `${heading}\n${'='.repeat(heading.length)}\n\n${text}\n`).join('\n')
    this.emitFile({ type: 'asset', fileName, source: `Third-party software bundled into this build.\n\n${source}` })
  },
})
