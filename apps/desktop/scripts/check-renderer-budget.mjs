import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, resolve } from 'node:path'

// The startup budget for a built renderer, run against the bytes the bundler will pick up: every script
// and stylesheet a cold window loads before it draws.
//
// Two checks, because a byte total alone is not enough. Between 2026-08-31 and 2026-09-02 the total
// drifted from 1,317,605 B to 1,329,679 B on 31 unrelated commits while staying red, so nobody read it;
// and a budget that only counts bytes lets the next heavy chunk in as long as something else shrank.
// The denylist is a name test: a chunk called `shiki` in a startup list is wrong whatever it weighs.
//
//   node scripts/check-renderer-budget.mjs [--dir <built client dir>]
//
// The graph comes from Vite's manifest, which vite.config.ts moves to `renderer-manifest.json` beside
// the client dir, and the denylist also reads `renderer-modules.json` there, the source modules in
// each chunk. The built index.html is not enough on its own: on 2026-09-24 its entry became a
// small guard that loads the app with one dynamic import, the HTML named a single 9.6 KB script, and
// this check passed on that while the window loaded 870 KB.
//
// docs/frontend.md § Startup budget owns the contract. The terminal client's analogue is
// apps/tui/scripts/check-startup-graph.mjs, which holds the first group of the same denylist for its
// own graph.

const args = process.argv.slice(2)
const dirFlag = args.indexOf('--dir')
const clientDir = resolve(dirFlag === -1 ? resolve(import.meta.dirname, '../dist/client') : args[dirFlag + 1])
const manifestPath = resolve(clientDir, '../renderer-manifest.json')
const modulesPath = resolve(clientDir, '../renderer-modules.json')

// `scripts` is the measured startup figure plus about 5%: 738,695 B on 2026-09-25, after unused kit
// components stopped riding along (vite.config.ts). It was 1,250,000 B from 2026-08-31, which left
// 390 KB of slack and let 226 KB of drift through without a word. A change that needs more raises it
// in the same commit and says why in the commit message.
//
// `floor` is a lower bound, not a target. A startup set that small means the check is reading the
// wrong graph, which is how it went blind in September, so it fails the build rather than passes it.
const limits = {
  scripts: 776_000,
  styles: 200_000,
  floor: 100_000,
}

// Source modules that are dynamically imported but still load before the first draw, keyed as the
// manifest keys them. Every other dynamic import is a lazy surface and stays out of the count. A module
// listed here that has no chunk of its own is skipped: index.html loads src/client/index.tsx directly,
// so today it is part of the entry chunk, and the entry is counted anyway. It stays listed because an
// entry module that dynamic-imports the app is the shape that blinded this check once (see above), and
// that import is startup whatever syntax loads it.
const STARTUP_IMPORTS = ['src/client/index.tsx']

// Name prefixes that must not be fetched at startup, whatever they weigh. Each one is a lazy surface
// that leaked into the eager graph through a registry holding values instead of loaders.
//
// A prefix is tested against each startup chunk's file name and against every source module inside
// those chunks: each folder on its path, so a package folder such as `shiki` counts, and its file
// name written the way a chunk would be named after it, `draft.ts` as `draft-`. That is what lets one
// prefix mean the same thing whether the module got a chunk of its own or not.
// The module test is the one that matters most. A module imported statically from startup code
// merges into a startup chunk named after something else, so a chunk-name test alone never sees it.
//
// A chunk's name is the name of one module in it, so a name here can move when the graph changes: the
// pull-request model was `prModel` until phase 1 made the PR pane's contribution lazy, after which
// rolldown gave the same modules a chunk called `prSections`. Both are listed. A prefix that no
// longer names any chunk is not an error — see `inBuild` below — so a stale one is harmless, and
// leaving it in is what catches the module coming back under its old name.
//
// The second group is plugin code a registration needs only when it draws: the memory section and
// the Findings review it carries, the workflow editor's draft modules, the GitHub importer and the
// preview pane. Each was on the renderer's startup graph through a plugin's client entry until
// 2026-09-25. The terminal client's graph was not checked for them, so only this list has them.
const DENYLIST = [
  'shiki', 'wasm', 'DiffPane', 'prModel', 'prSections', 'viewState', 'icon-nodes',
  'MemorySection', 'FindingsBundleReview', 'draft-', 'draftStore', 'stepFields', 'GithubImporter', 'PreviewTaskPane', 'PreviewPane',
]

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

// The static closure of the startup modules: each chunk, the chunks it imports, and their stylesheets.
// `hops` is how many fetches run one after another before the last of them can start. Vite preloads a
// chunk's whole static closure alongside it, so a static edge costs no round trip; the entry and each
// startup import cost one each.
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
const scriptAssets = [...startupFiles].filter((path) => !path.endsWith('.css'))
const styleAssets = [...startupFiles].filter((path) => path.endsWith('.css'))
const hops = startupKeys.length

async function totalBytes(paths) {
  const sizes = await Promise.all(paths.map(async (path) => (await stat(resolve(clientDir, path))).size))
  return sizes.reduce((total, size) => total + size, 0)
}
const [scriptBytes, styleBytes] = await Promise.all([totalBytes(scriptAssets), totalBytes(styleAssets)])

// Everything one dynamic import past the startup set. Reported rather than gated: it is the union over
// every lazy surface the startup code can open, so a legitimately lazy pane is in it and always will
// be, and denylisting it would fail forever. The number is here because it is the honest answer to
// "how much more is one interaction away".
const lazyRoots = [...startupChunks].flatMap((key) => manifest[key].dynamicImports ?? [])
const lazyFiles = [...filesOf(closure(lazyRoots))].filter((path) => !startupFiles.has(path))
const lazyBytes = await totalBytes(lazyFiles)

console.log(`[renderer-budget] startup scripts=${scriptBytes}B styles=${styleBytes}B assets=${startupFiles.size} hops=${hops}`)
console.log(`[renderer-budget] one interaction away: ${lazyFiles.length} more chunks, ${lazyBytes}B (not counted)`)

// Each startup chunk's file name, then each module in it as `module (in chunk)`, so a failure says
// both what came back and where it landed.
const startupNames = [...startupFiles].flatMap((path) => [
  { label: basename(path), names: [basename(path)] },
  ...(chunkModules[path] ?? []).map((module) => ({
    label: `${module} (in ${basename(path)})`,
    names: module.replace(/\.[^./]+$/, '-').split('/'),
  })),
])
const hit = (prefix) => startupNames.filter(({ names }) => names.some((name) => name.startsWith(prefix))).map(({ label }) => label)

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
    `Denylisted names in the renderer's startup list: ${offenders.flatMap(hit).join(', ')}. `
    + 'A name on that list is a lazy surface that leaked into the eager graph — the table that names it '
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
if (scriptBytes < limits.floor) {
  problems.push(
    `Renderer startup scripts total ${scriptBytes}B, under the ${limits.floor}B floor. The app cannot start on that `
    + 'little, so this check is reading the wrong graph. If the entry now loads the app through a new dynamic '
    + 'import, add that module to STARTUP_IMPORTS.',
  )
}
if (problems.length) throw new Error(problems.join('\n'))
