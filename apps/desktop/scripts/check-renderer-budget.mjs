import { readdir, stat } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { readRendererGraph } from './renderer-graph.mjs'

// The startup budget for a built renderer, run against the bytes the bundler will pick up: every script
// and stylesheet a cold window loads before it draws.
//
// Two checks, because a byte total alone is not enough: a budget that only counts bytes lets the next
// heavy chunk in as long as something else shrank. The denylist is a name test: a chunk called `shiki`
// in a startup list is wrong whatever it weighs.
//
//   node scripts/check-renderer-budget.mjs [--dir <built client dir>]
//
// The graph comes from Vite's manifest and the source modules in each chunk, read by
// ./renderer-graph.mjs. The built index.html is not enough on its own: when its entry is a small guard
// that loads the app with one dynamic import, the HTML names a single small script while the window
// loads the whole graph.
//
// docs/frontend/startup-budget.md § Startup budget owns the contract. The terminal client's analogue is
// apps/tui/scripts/check-startup-graph.mjs, which holds the first group of the same denylist for its
// own graph.

const args = process.argv.slice(2)
const dirFlag = args.indexOf('--dir')
const clientDir = resolve(dirFlag === -1 ? resolve(import.meta.dirname, '../dist/client') : args[dirFlag + 1])

// `scripts` and `roster` are the figures this script prints plus about 5%. Slack much larger than that
// lets drift through unnoticed. A change that needs more raises the limit in the same commit and says
// why in the commit message.
//
// `floor` is a lower bound, not a target. A startup set that small means the check is reading the
// wrong graph, so it fails the build rather than passes it.
//
// `roster` is the compiled roster's scripts beyond startup, which the workspace restore waits for. A
// dynamic import moves code off the first frame, but restore still waits on whatever the roster
// imports, so a cut that only moves startup code into the roster saves nothing. Pane models are
// synchronous factories, so they register with the roster (docs/frontend/startup-budget.md).
const limits = {
  scripts: 1_000_000,
  roster: 310_000,
  styles: 200_000,
  floor: 100_000,
}

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
// same pull-request modules can land in a chunk called `prModel` or `prSections`, so both are listed.
// A prefix that names no chunk is not an error (see `inBuild` below), so a stale one is harmless, and
// leaving it in catches the module coming back under its old name.
//
// The second group is plugin code a registration needs only when it draws: the memory section and
// the workflow editor's draft modules, the GitHub importer and the preview pane. The terminal
// client's graph doesn't check for them, so only this list has them.
//
// The third group is the loaded-plugin host and the promotion modal, which load on first use: the
// worker host, the chrome registration and its data, and the modal. Frame registration imports
// `chromeData`, so that name stands for it too.
//
// The whole list applies to the roster as well as to startup, because the restore waits on both.
const DENYLIST = [
  'shiki', 'wasm', 'DiffPane', 'prModel', 'prSections', 'viewState', 'icon-nodes',
  'MemoryAddForm', 'draft-', 'draftStore', 'stepFields', 'GithubImporter', 'PreviewTaskPane', 'PreviewPane',
  'workerHost', 'chromeRegister', 'chromeData', 'PromoteToTaskModal',
]

// The denylist entries that are allowed in the startup list for now, reported loudly rather than
// failing the build. This list may only shrink: once a chunk with that name exists in the build and is
// no longer fetched at startup, the build fails until the prefix is deleted from here. That is what
// makes a fix stick rather than quietly regress a month later.
//
// viewState and workerHost load at startup on main. They are allowed so a release can build until
// the eager imports that pull them in are made lazy.
const KNOWN = ['viewState', 'workerHost']

const graph = await readRendererGraph(clientDir)
const { manifest, chunkModules, startupKeys, startupChunks, startupFiles, closure, filesOf } = graph
// A roster with no chunk of its own is imported statically, so the startup count already holds it.
const rosterFiles = graph.rosterFiles ?? new Set()
const scriptAssets = [...startupFiles].filter((path) => !path.endsWith('.css'))
const styleAssets = [...startupFiles].filter((path) => path.endsWith('.css'))
const hops = startupKeys.length

async function totalBytes(paths) {
  const sizes = await Promise.all(paths.map(async (path) => (await stat(resolve(clientDir, path))).size))
  return sizes.reduce((total, size) => total + size, 0)
}
const rosterScripts = [...rosterFiles].filter((path) => !path.endsWith('.css'))
const [scriptBytes, styleBytes, rosterBytes] = await Promise.all([totalBytes(scriptAssets), totalBytes(styleAssets), totalBytes(rosterScripts)])

// Everything one dynamic import past the startup set. Reported rather than gated: it is the union over
// every lazy surface the startup code can open, so a legitimately lazy pane is in it and always will
// be, and denylisting it would fail forever. The number is here because it is the honest answer to
// "how much more is one interaction away".
const lazyRoots = [...startupChunks].flatMap((key) => manifest[key].dynamicImports ?? [])
const lazyFiles = [...filesOf(closure(lazyRoots))].filter((path) => !startupFiles.has(path))
const lazyBytes = await totalBytes(lazyFiles)

console.log(`[renderer-budget] startup scripts=${scriptBytes}B styles=${styleBytes}B assets=${startupFiles.size} hops=${hops}`)
console.log(graph.rosterFiles
  ? `[renderer-budget] compiled roster before restore: scripts=${rosterBytes}B in ${rosterScripts.length} chunks`
  : '[renderer-budget] compiled roster has no chunk of its own; startup counts it')
console.log(`[renderer-budget] one interaction away: ${lazyFiles.length} more chunks, ${lazyBytes}B (not counted)`)

// Each startup and roster chunk's file name, then each module in it as `module (in chunk)`, so a
// failure says both what came back and where it landed.
const startupNames = [...startupFiles, ...rosterFiles].flatMap((path) => [
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
    `Denylisted names in the renderer's startup or roster list: ${offenders.flatMap(hit).join(', ')}. `
    + 'A name on that list is a lazy surface that leaked into the eager graph — the table that names it '
    + 'should hold a loader, not the value (docs/frontend/startup-budget.md § Startup budget).',
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
if (rosterBytes > limits.roster) {
  problems.push(
    `Compiled roster budget exceeded (scripts ${rosterBytes}/${limits.roster}B). The workspace restore waits for `
    + 'this registration, so keep views and handlers behind lazy contribution boundaries, and import narrow '
    + 'entrypoints rather than barrels from registration code.',
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
