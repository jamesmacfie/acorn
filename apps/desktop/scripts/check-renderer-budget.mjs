import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'

// The startup budget for a built renderer, run against the bytes the bundler will pick up: everything
// the built index.html loads or preloads, which is what a cold window pays for before it draws.
//
// Two checks, because a byte total alone is not enough. Between 2026-08-31 and 2026-09-02 the total
// drifted from 1,317,605 B to 1,329,679 B on 31 unrelated commits while staying red, so nobody read it;
// and a budget that only counts bytes lets the next heavy chunk in as long as something else shrank.
// The denylist is a name test: a chunk called `shiki` in a startup list is wrong whatever it weighs.
//
//   node scripts/check-renderer-budget.mjs [--dir <built client dir>]
//
// docs/frontend.md § Startup budget owns the contract. The terminal client's analogue is
// apps/tui/scripts/check-startup-graph.mjs, which holds the same denylist for its own graph.

const args = process.argv.slice(2)
const dirFlag = args.indexOf('--dir')
const clientDir = resolve(dirFlag === -1 ? resolve(import.meta.dirname, '../dist/client') : args[dirFlag + 1])

const limits = {
  scripts: 1_250_000,
  styles: 200_000,
}

// Chunk-name prefixes that must not be fetched at startup, whatever they weigh. Each one is a lazy
// surface that leaked into the eager graph through a registry holding values instead of loaders
// (docs/performance.md § Registries hold loaders).
//
// A chunk's name is the name of one module in it, so a name here can move when the graph changes: the
// pull-request model was `prModel` until phase 1 made the PR pane's contribution lazy, after which
// rolldown gave the same modules a chunk called `prSections`. Both are listed. A prefix that no
// longer names any chunk is not an error — see `inBuild` below — so a stale one is harmless, and
// leaving it in is what catches the module coming back under its old name.
const DENYLIST = ['shiki', 'wasm', 'DiffPane', 'prModel', 'prSections', 'viewState', 'icon-nodes']

// The denylist entries that are allowed in the startup list for now, reported loudly rather than
// failing the build. This list may only shrink: once a chunk with that name exists in the build and is
// no longer fetched at startup, the build fails until the prefix is deleted from here. That is what
// makes a fix stick rather than quietly regress a month later.
//
// Empty since phase 1 of the performance programme, which was the phase that owed the three it held —
// `shiki`, `DiffPane` and `prModel`. Nothing on the denylist is fetched at startup any more, so a
// name that reappears fails the build outright and this list should stay empty.
const KNOWN = []

const html = await readFile(resolve(clientDir, 'index.html'), 'utf8')
const assetPaths = (pattern) => [...html.matchAll(pattern)].map((match) => match[1])
const entryAssets = assetPaths(/<script[^>]+src="([^"]+)"/g)
const scriptAssets = [
  ...entryAssets,
  ...assetPaths(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/g),
]
const styleAssets = assetPaths(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)

const onDisk = (assetPath) => resolve(clientDir, assetPath.replace(/^\//, ''))
async function totalBytes(paths) {
  const sizes = await Promise.all(paths.map(async (path) => (await stat(onDisk(path))).size))
  return sizes.reduce((total, size) => total + size, 0)
}

const [scriptBytes, styleBytes] = await Promise.all([totalBytes(scriptAssets), totalBytes(styleAssets)])

// How deep the preload chain goes: the longest path of static imports from the entry chunk. The first
// read argued that 143 requests through the custom scheme handler is a waterfall, and nothing measured
// it. Depth is the part that costs latency — a flat list of 150 is parallel, a chain of 20 is not.
const STATIC_EDGE = /(?:^|[\n;}])\s*import\s*(?:[^'";]*?\s*from\s*)?['"](\.[^'"]+)['"]/g
const DYNAMIC_EDGE = /import\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g
async function staticEdges(file) {
  const source = await readFile(file, 'utf8').catch(() => '')
  const dynamic = new Set([...source.matchAll(DYNAMIC_EDGE)].map((m) => resolve(dirname(file), m[1])))
  const edges = new Set([...source.matchAll(STATIC_EDGE)].map((m) => resolve(dirname(file), m[1])))
  for (const lazy of dynamic) edges.delete(lazy)
  return [...edges]
}

let depth = 0
{
  const seen = new Set()
  let frontier = entryAssets.map(onDisk)
  while (frontier.length) {
    depth += 1
    const next = []
    for (const file of frontier) {
      if (seen.has(file)) continue
      seen.add(file)
      next.push(...await staticEdges(file))
    }
    frontier = next.filter((file) => !seen.has(file))
  }
}

// The dependency lists Vite emits for the entry chunk's dynamic imports. Reported rather than gated:
// the array is the union over every import site in the chunk, so a legitimately lazy pane is in it and
// always will be, and denylisting it would fail forever. The number is here because it is the honest
// answer to "how much more is one interaction away".
const entrySource = await Promise.all(entryAssets.map((path) => readFile(onDisk(path), 'utf8').catch(() => '')))
const mapDeps = new Set(
  entrySource.flatMap((source) => [...source.matchAll(/["'](assets\/[^"']+\.(?:js|css))["']/g)].map((m) => m[1])),
)
for (const path of [...scriptAssets, ...styleAssets]) mapDeps.delete(path.replace(/^\//, ''))
const mapDepsBytes = await totalBytes([...mapDeps]).catch(() => 0)

console.log(`[renderer-budget] startup scripts=${scriptBytes}B styles=${styleBytes}B assets=${scriptAssets.length + styleAssets.length} depth=${depth}`)
console.log(`[renderer-budget] one interaction away: ${mapDeps.size} more chunks, ${mapDepsBytes}B (not counted)`)

const startupNames = [...scriptAssets, ...styleAssets].map((path) => basename(path))
const hit = (prefix) => startupNames.filter((name) => name.startsWith(prefix))

// Every emitted asset, so "fixed" can be told from "was never built". A prefix that produces no chunk
// at all is not evidence of anything — the module may have been renamed or deleted — and failing on it
// would make the allowance list impossible to keep honest.
const built = await readdir(resolve(clientDir, 'assets')).catch(() => [])
const inBuild = (prefix) => built.some((name) => name.startsWith(prefix))

const offenders = DENYLIST.filter((prefix) => !KNOWN.includes(prefix) && hit(prefix).length)
const known = KNOWN.filter((prefix) => hit(prefix).length)
const fixed = KNOWN.filter((prefix) => !hit(prefix).length && inBuild(prefix))

for (const prefix of known) {
  console.log(`[renderer-budget] KNOWN FAILURE: ${hit(prefix).join(', ')} is fetched at startup and must not be. Owned by the performance programme's phase 1.`)
}

const problems = []
if (offenders.length) {
  problems.push(
    `Denylisted chunks in the renderer's startup list: ${offenders.flatMap(hit).join(', ')}. `
    + 'A chunk on that list is a lazy surface that leaked into the eager graph — the table that names it '
    + 'should hold a loader, not the value (docs/frontend.md § Startup budget).',
  )
}
if (fixed.length) {
  problems.push(
    `No longer fetched at startup: ${fixed.join(', ')}. Delete ${fixed.length === 1 ? 'it' : 'them'} from `
    + 'KNOWN in this script so the fix cannot regress.',
  )
}
if (scriptBytes > limits.scripts || styleBytes > limits.styles) {
  problems.push(
    `Renderer startup budget exceeded (scripts ${scriptBytes}/${limits.scripts}B, styles ${styleBytes}/${limits.styles}B). `
    + 'Keep optional plugin surfaces behind lazy contribution boundaries.',
  )
}
if (problems.length) throw new Error(problems.join('\n'))
