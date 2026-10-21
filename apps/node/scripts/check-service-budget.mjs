import { join, relative, resolve } from 'node:path'
import { chunkBytes, externalSpecifiers, readChunkGraph, staticClosure } from '../../../scripts/chunkGraph.mts'

// The node service's size budget, run after `vite build`: dist/service.js and every chunk it reaches
// through static imports, which is what a cold node reads and evaluates before its first boot mark.
// Dynamic imports are lazy and stay out of the count.
//
//   node scripts/check-service-budget.mjs [--dir <built dist>]
//
// The bytes are a tripwire against unnoticed growth, not a speed measure: bundling third-party
// dependencies (apps/node/externals.ts) adds bytes and makes evaluation faster. The boot test's timing
// is the number to watch (apps/desktop/test/boot.test.ts).
//
// The walk follows the chunk graph the build writes (scripts/chunkGraph.mts), never the text of the
// chunks, so minified and formatted output count the same way, and the bytes are each file's size on
// disk. It also lists the bare imports the graph leaves for Node to resolve at run time, so a new one
// shows up in the build output rather than as a missing package on somebody's machine.

const args = process.argv.slice(2)
const dirFlag = args.indexOf('--dir')
const dist = resolve(dirFlag === -1 ? resolve(import.meta.dirname, '../dist') : args[dirFlag + 1])

// `ceiling` is the figure this script prints plus about 2 KB, in minified bytes. More slack lets an
// import a boot doesn't need come back without failing. Before raising it, find what grew with
// `pnpm --filter @acorn/node measure:service-graph`, and say why in the commit message. `floor` is a
// lower bound, not a target: a graph that small means the walk below stopped following imports, and a
// check that passes on that is blind.
const limits = { ceiling: 1_931_900, floor: 1_000_000 }

const graph = readChunkGraph(dist)
const files = staticClosure(graph)
const bytes = chunkBytes(graph, files)
const { atLoad, onFirstUse, required } = externalSpecifiers(graph, files)
const list = (names) => (names.size ? [...names].sort().join(', ') : 'none')
console.log(`[service-budget] ${relative(process.cwd(), join(dist, graph.entry))} and ${files.size - 1} chunk(s): ${bytes}B (ceiling ${limits.ceiling}B)`)
console.log(`[service-budget] resolved at run time: ${list(atLoad)}; on first use: ${list(onFirstUse)}; through createRequire: ${list(required)}`)

if (bytes > limits.ceiling) {
  throw new Error(
    `The node service's static graph is ${bytes}B, over the ${limits.ceiling}B ceiling. Find what grew before raising it: `
    + 'run pnpm --filter @acorn/node measure:service-graph [--why <path fragment>]. '
    + 'Anything a boot does not need belongs behind a dynamic import in the plugin that owns it: '
    + 'lazyRouter or lazyFetch for a route, or an `await import()` inside the operation '
    + '(docs/plugin-authoring/the-node-half.md § Load a route on first use).',
  )
}
if (bytes < limits.floor) {
  throw new Error(
    `The node service's static graph is ${bytes}B, under the ${limits.floor}B floor. The node cannot boot on that little, `
    + 'so this check has stopped following the chunks service.js imports.',
  )
}
