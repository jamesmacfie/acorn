import { readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'

// The renderer's startup graph, read from what the build wrote: Vite's manifest, which vite.config.ts
// moves to `renderer-manifest.json` beside the client dir, and `renderer-modules.json`, the source
// modules in each chunk. Two readers share it: the startup budget (./check-renderer-budget.mjs) and the
// size report (./size-report.mjs). One reading means the two cannot count different startup sets.

// Source modules that are dynamically imported but still load before the first draw, keyed as the
// manifest keys them. Every other dynamic import is a lazy surface and stays out of the count. A module
// listed here that has no chunk of its own is skipped: index.html loads src/client/index.tsx directly,
// so today it is part of the entry chunk, and the entry is counted anyway. It stays listed because an
// entry module that dynamic-imports the app is the shape that blinded the budget once, and that import
// is startup whatever syntax loads it.
const STARTUP_IMPORTS = ['src/client/index.tsx']

/**
 * The startup closure of a built client dir: each startup chunk, the chunks it imports, and their
 * stylesheets, plus whatever index.html names directly. Throws when the graph files are missing or
 * describe a different build than the index.html beside them.
 */
export async function readRendererGraph(clientDir) {
  const manifestPath = resolve(clientDir, '../renderer-manifest.json')
  const modulesPath = resolve(clientDir, '../renderer-modules.json')
  const html = await readFile(resolve(clientDir, 'index.html'), 'utf8')
  const readGraph = async (path) => JSON.parse(
    await readFile(path, 'utf8').catch(() => {
      throw new Error(
        `No ${basename(path)} at ${path}. The acorn:renderer-graph plugin in vite.config.ts writes it; `
        + 'build the renderer with `vite build` before running this check.',
      )
    }),
  )
  const manifest = await readGraph(manifestPath)
  const chunkModules = await readGraph(modulesPath)

  // A manifest left over from an earlier build would describe chunks this one does not have, so the
  // entry it names has to be the script this index.html loads.
  const htmlPaths = (pattern) => [...html.matchAll(pattern)].map((match) => match[1].replace(/^\//, ''))
  const entryKey = Object.keys(manifest).find((key) => manifest[key].isEntry)
  if (!entryKey || !htmlPaths(/<script[^>]+src="([^"]+)"/g).includes(manifest[entryKey].file)) {
    throw new Error(`${manifestPath} does not describe the entry ${clientDir}/index.html loads. Rebuild the renderer.`)
  }

  // `hops` is how many fetches run one after another before the last of them can start. Vite preloads
  // a chunk's whole static closure alongside it, so a static edge costs no round trip; the entry and
  // each startup import cost one each.
  const startupKeys = [entryKey, ...STARTUP_IMPORTS.filter((key) => key !== entryKey && manifest[key])]
  const closure = (roots) => {
    const keys = new Set()
    const visit = (key) => {
      if (keys.has(key) || !manifest[key]) return
      keys.add(key)
      for (const next of manifest[key].imports ?? []) visit(next)
    }
    for (const root of roots) visit(root)
    return keys
  }
  const filesOf = (keys) => new Set([...keys].flatMap((key) => [manifest[key].file, ...manifest[key].css ?? []]))

  const startupChunks = closure(startupKeys)
  // Whatever index.html names directly is startup too, whatever the manifest says.
  const startupFiles = new Set([
    ...filesOf(startupChunks),
    ...htmlPaths(/<script[^>]+src="([^"]+)"/g),
    ...htmlPaths(/<link[^>]+rel="(?:modulepreload|stylesheet)"[^>]+href="([^"]+)"/g),
  ])
  return { manifest, chunkModules, startupKeys, startupChunks, startupFiles, closure, filesOf }
}
