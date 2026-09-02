import { readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'

// The startup budget for the terminal client, which needs a different shape of check from the
// renderer's. This bundle sets `modulePreload: false` and has one entry, so there is no preload list to
// read: the analogue is the static import closure of the chunk `main.js` reaches for first, `App`.
// Everything in that closure is evaluated before the first frame.
//
//   node scripts/check-startup-graph.mjs [--dist <built dir>]
//
// Two checks, the same two the desktop's check-renderer-budget.mjs makes: a byte ceiling, and a
// denylist of chunk names that must not be in the graph whatever they weigh. The walk is a regex over
// import edges rather than a real module graph, so it is approximate — a re-export chain the runtime
// would prune counts here. Exact is not what is wanted: this exists to catch a 300 KB regression, and
// it does that.
//
// docs/frontend.md § Startup budget owns the contract; docs/testing.md § Continuous integration says
// this runs from `build`.

const args = process.argv.slice(2)
const distFlag = args.indexOf('--dist')
const dist = resolve(distFlag === -1 ? resolve(import.meta.dirname, '../dist') : args[distFlag + 1])

// Measured at 1,024,422 B on 2026-09-03, and rounded up so an unrelated comment does not turn the
// build red. It was 1,114,282 B until phase 1 of the performance programme made the GitHub plugin's
// PR pane a lazy contribution; the kit table this host holds was never in the graph at all, because
// `../src/plugins/RemoteTree.tsx` is already lazy
// (docs/future/performance/measurements.md § 2026-09-03).
//
// What is left is not a registry. `../src/App.tsx` imports thirteen client plugin barrels statically
// so their `init` can register, and their registration modules and shared queries are most of this
// number. Phase 4 is the phase that changes it; a ceiling that assumed phase 1 could halve this
// number was wrong about where the bytes were.
const CEILING = 1_060_000

// The same list the desktop's check holds, for the same reason: a chunk with one of these names in a
// startup graph is a lazy surface that leaked into the eager one. Written twice rather than shared,
// because each host's build script is the only consumer and the allowances below differ.
//
// `prSections` is the pull-request model under the chunk name it took once phase 1 made the PR pane's
// contribution lazy — a chunk is named after one module in it, so the name moves when the graph does.
// Both names stay listed; a prefix that names no chunk is not an error (`inBuild` below).
const DENYLIST = ['shiki', 'wasm', 'DiffPane', 'prModel', 'prSections', 'viewState', 'icon-nodes']
// Names allowed in the graph for now, reported loudly rather than failing the build. It may only
// shrink. Empty since phase 1, which was the phase that owed the one it held.
const KNOWN = []

const STATIC_EDGE = /(?:^|[\n;}])\s*import\s*(?:[^'";]*?\s*from\s*)?['"](\.[^'"]+)['"]/g
const DYNAMIC_EDGE = /import\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g

const edgesOf = (file) => {
  const source = readFileSync(file, 'utf8')
  const dynamic = new Set([...source.matchAll(DYNAMIC_EDGE)].map((m) => resolve(dirname(file), m[1])))
  const eager = new Set([...source.matchAll(STATIC_EDGE)].map((m) => resolve(dirname(file), m[1])))
  // A specifier that appears in both forms is only ever fetched by the dynamic one — that is what a
  // lazily loaded pane looks like from here.
  for (const lazy of dynamic) eager.delete(lazy)
  return eager
}

const chunks = resolve(dist, 'chunks')
const roots = readdirSync(chunks)
  .filter((name) => /^App-.*\.js$/.test(name))
  .map((name) => resolve(chunks, name))
if (roots.length !== 1) {
  throw new Error(`[tui-startup] expected exactly one dist/chunks/App-*.js to walk from, found ${roots.length}. Did the entry get renamed?`)
}

const closure = new Set()
const frontier = [...roots]
while (frontier.length) {
  const file = frontier.pop()
  if (closure.has(file)) continue
  closure.add(file)
  for (const edge of edgesOf(file)) frontier.push(edge)
}

const bytes = [...closure].reduce((total, file) => total + statSync(file).size, 0)
const wholeBuild = readdirSync(chunks).reduce((total, name) => total + statSync(resolve(chunks, name)).size, 0)
console.log(`[tui-startup] eager closure from ${basename(roots[0])}: ${closure.size} chunks, ${bytes}B of ${wholeBuild}B built (ceiling ${CEILING}B)`)

const names = [...closure].map((file) => basename(file))
const hit = (prefix) => names.filter((name) => name.startsWith(prefix))
const built = readdirSync(chunks)
const inBuild = (prefix) => built.some((name) => name.startsWith(prefix))

const offenders = DENYLIST.filter((prefix) => !KNOWN.includes(prefix) && hit(prefix).length)
for (const prefix of KNOWN.filter((p) => hit(p).length)) {
  console.log(`[tui-startup] KNOWN FAILURE: ${hit(prefix).join(', ')} is in the eager graph and must not be. Owned by the performance programme's phase 1.`)
}

const problems = []
if (offenders.length) {
  problems.push(
    `Denylisted chunks in the terminal client's eager graph: ${offenders.flatMap(hit).join(', ')}. `
    + 'That is a lazy surface reached statically — the table that names it should hold a loader, not the '
    + 'value (docs/frontend.md § Startup budget).',
  )
}
const fixed = KNOWN.filter((prefix) => !hit(prefix).length && inBuild(prefix))
if (fixed.length) {
  problems.push(
    `Out of the eager graph now: ${fixed.join(', ')}. Delete ${fixed.length === 1 ? 'it' : 'them'} from KNOWN in `
    + 'this script so the fix cannot regress.',
  )
}
if (bytes > CEILING) {
  problems.push(
    `The terminal client's eager graph is ${bytes}B, over its ${CEILING}B ceiling. Everything in it is `
    + 'evaluated before the first frame; move whatever grew behind a loader.',
  )
}
if (problems.length) throw new Error(problems.join('\n'))
