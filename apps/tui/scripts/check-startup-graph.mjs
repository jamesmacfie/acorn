import { readFileSync, statSync } from 'node:fs'
import { basename, resolve } from 'node:path'

// main.js plus every top-level dynamic import awaited before render, followed through static edges.
// Vite's acorn:tui-startup-graph plugin records the real chunk edges and source modules, including
// modules merged into chunks named after something else. docs/frontend.md § Startup budget owns it.
const args = process.argv.slice(2)
const distFlag = args.indexOf('--dist')
const dist = resolve(distFlag === -1 ? resolve(import.meta.dirname, '../dist') : args[distFlag + 1])
const graph = JSON.parse(readFileSync(resolve(dist, 'startup-graph.json'), 'utf8'))
if (graph.entry !== 'main.js' || !graph.roots.includes(graph.entry) || !graph.chunks[graph.entry]) {
  throw new Error('[tui-startup] startup graph must include main.js. Rebuild the terminal client.')
}

// Complete minified startup graph, including bundled Zod. Updated from the App-only unminified
// metric in October 2026; external runtime packages are reported separately, never hidden as bytes.
const CEILING = 720_000
const DENYLIST = ['shiki', 'wasm', 'DiffPane', 'prModel', 'prSections', 'viewState', 'icon-nodes', 'drizzle-orm', 'RemoteTree-', 'TreeHost-', 'roster-']

const closure = new Set()
const externals = new Set()
const visit = (file) => {
  if (closure.has(file)) return
  const chunk = graph.chunks[file]
  if (!chunk) throw new Error(`[tui-startup] missing startup chunk ${file}. Rebuild the terminal client.`)
  closure.add(file)
  for (const next of chunk.imports) {
    if (graph.chunks[next]) visit(next)
    else if (next.startsWith('.') || next.endsWith('.js')) throw new Error(`[tui-startup] missing import ${next} in ${file}`)
    else externals.add(next)
  }
}
for (const root of graph.roots) visit(root)

const bytes = [...closure].reduce((sum, file) => sum + statSync(resolve(dist, file)).size, 0)
const wholeBuild = Object.keys(graph.chunks).reduce((sum, file) => sum + statSync(resolve(dist, file)).size, 0)
console.log(`[tui-startup] complete startup closure: ${closure.size} chunks, ${bytes}B of ${wholeBuild}B built (ceiling ${CEILING}B)`)
console.log(`[tui-startup] external runtime imports (bytes not counted): ${[...externals].sort().join(', ')}`)

const names = [...closure].flatMap((file) => [
  { label: file, names: [basename(file)] },
  ...graph.chunks[file].modules.map((module) => ({ label: `${module} (in ${file})`, names: module.replace(/\.[^./]+$/, '-').split('/') })),
]).concat([...externals].map((name) => ({ label: name, names: name.split('/') })))
const offenders = names.filter(({ names }) => DENYLIST.some((prefix) => names.some((name) => name.startsWith(prefix))))
const problems = []
if (offenders.length) problems.push(`Denylisted startup dependencies: ${offenders.map(({ label }) => label).join(', ')}. Keep optional surfaces behind loaders.`)
if (bytes > CEILING) problems.push(`Terminal startup graph is over its ${CEILING}B ceiling: ${bytes}B. Keep optional work after the first frame.`)
if (problems.length) throw new Error(problems.join('\n'))
