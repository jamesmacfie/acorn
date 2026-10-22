import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { runnerImport } from 'vite'
import { buildBundledPlugins } from '../../../scripts/bundled-plugins.mjs'
import { buildVersion } from '../../../scripts/buildVersion.mts'

// The acceptances the phone carries for the first-party bundles of this release, as
// `first-party-bundles.json` (docs/mobile/plugin-custody.md § First-party bundles). It builds the roster
// the desktop and the standalone Node ship, with the same function, and records each client bundle's hash
// with the disclosure the desktop records for it. vite.config.ts hands the file to the app.
const OUTPUT = resolve(import.meta.dirname, '../first-party-bundles.json')

// The roster builds as the desktop and the standalone Node build it. A NODE_ENV from a dev server would
// change the bytes, so the hashes wouldn't match, and loading anything through Vite sets one.
delete process.env.NODE_ENV
const staging = mkdtempSync(join(tmpdir(), 'acorn-first-party-'))
try {
  const ids = buildBundledPlugins(staging)

  // The sources are TypeScript with extensionless imports, which Vite loads and Node's own loader can't.
  const load = async (specifier) => (await runnerImport(specifier, { configFile: false, logLevel: 'error' })).module
  const { bundledAck } = await load('@acorn/custody/rules')
  const { pluginManifestShape } = await load('@acorn/protocol/plugin/contract.ts')

  const acks = ids.flatMap((id) => {
    const dir = join(staging, id)
    const manifest = pluginManifestShape.parse(JSON.parse(readFileSync(join(dir, 'acorn-plugin.json'), 'utf8')))
    if (manifest.id !== id) throw new Error(`${id} built a package named ${manifest.id}`)
    if (!manifest.client) return []
    const hash = createHash('sha256').update(readFileSync(join(dir, manifest.client))).digest('hex')
    return [bundledAck(manifest, hash, `bundled:acorn-${buildVersion()}`)]
  })
  writeFileSync(OUTPUT, `${JSON.stringify(acks)}\n`)
  console.log(`[first-party] ${acks.length} client bundle(s) -> ${OUTPUT}`)
} finally {
  rmSync(staging, { recursive: true, force: true })
}
