import { join, relative, resolve } from 'node:path'
import { chunkBytes, externalSpecifiers, readChunkGraph, staticClosure } from '../../../scripts/chunkGraph.mts'

// The node service's size budget, run after `vite build`: dist/service.js and every chunk it reaches
// through static imports, which is what a cold node reads and evaluates before its first boot mark.
// Dynamic imports are lazy and stay out of the count.
//
//   node scripts/check-service-budget.mjs [--dir <built dist>]
//
// The node build had no size check, and its service chunk grew from 1.1 MB to 1.9 MB in three weeks
// with nobody noticing. The count went up again, to about 2.9 MB, when third-party dependencies moved
// inside the bundle (./externals.ts), because that made evaluation faster, not slower. So the bytes are
// a tripwire, and the boot test's timing is the number to watch (apps/desktop/test/boot.test.ts).
//
// The walk follows the chunk graph the build writes (scripts/chunkGraph.mts), never the text of the
// chunks, so minified and formatted output count the same way, and the bytes are each file's size on
// disk. It also lists the bare imports the graph leaves for Node to resolve at run time, so a new one
// shows up in the build output rather than as a missing package on somebody's machine.

const args = process.argv.slice(2)
const dirFlag = args.indexOf('--dir')
const dist = resolve(dirFlag === -1 ? resolve(import.meta.dirname, '../dist') : args[dirFlag + 1])

// 3,063,547 B on 2026-10-02, when the old 3,062,000 B ceiling
// stopped `pnpm dev:agent` from starting. Before that it was 2,916,482 B on 2026-09-29, and 48 KB of
// that rise is jsdiff, which the agent drivers use to write each file change's hunks
// (plugins/agents/src/server/drivers/patchText.ts). `floor` is a lower bound, not a target: a graph
// that small means the walk below stopped following imports, and a check that passes on that is blind.
// 2026-10-04: dataset capture, storage, SQL reduction, and workflow writes are lazy; the remaining
// core route, tool, source, and schema registration adds about 21 KB over the previous ceiling.
// 2026-10-05: 3,277,281 B. Derived sources (dashboards phases 8 to 11) took the graph to 3,267,364 B,
// which already stopped `pnpm dev:agent`, and the development mode of phase 12 adds about 10 KB. Both
// are registration and checks a boot runs, so the ceiling moves rather than the code.
// 2026-10-06: 3,296,190 -> 3,099,374 B after workflow AI authoring, Codex session code, the dashboard
// sampler, and the plugin authoring renderer moved to first use. Ceiling: 3,290,000 -> 3,115,000 B.
// The former 5% allowance bought about two weeks of growth at the measured rate. Even 2% would let
// the 18,012 B authoring import return without failing, so about 0.5% keeps all four cuts protected.
// 2026-10-07: 3,115,487 B with startup phase call sites. Timing helpers and CLI auth/version probes
// load on first use; the remaining labels and callbacks stay beside their operations. Add 1 KB,
// keeping the previous lazy-import cuts protected.
// 2026-10-07: 3,118,217 B with setup run by hand: the rule core checks before admitting it, the
// terminal route and bridge verb that spawn it, and the status flag the palette reads. All three are
// registered at boot, so the ceiling moves by 3 KB.
// 2026-10-07: 3,148,767 B with the pi programme: the permission veto, session
// messages, plugin model grants, unattended follow-ups, plugin skills, the activity feed and session
// control, and harness bridges. Each feature's runtime loads on first use, and `agents.sessionExecute`
// moved to the first workflow step. What stays at boot is the hook and extension point declarations,
// the device routes, the boot charge for interrupted model calls, and the per-event checks that decide
// whether any of that work is needed. About 1 KB of margin keeps the lazy-load cuts protected.
// 2026-10-07: 3,151,546 B with workspace icons. Image handlers, decoding, and appearance validation
// load on first use. The additive tables and route callbacks add about 3 KB to registration.
// 2026-10-08: TEMPORARY. 3,154,767 B with the uncommitted task archive work. The growth isn't traced
// yet. Put the ceiling back to 3,153,000 once it is, or record the reason here.
// 2026-10-08: session goals add durable row fields, two device routes, and the engine's settlement
// and recovery calls. Verdict parsing and evaluation stay behind a dynamic import. The remaining
// registration grows the static graph to 3,159,369 B, so the ceiling moves by 4 KB.
// Delegation check contracts and durable report assembly add about 7 KiB to the boot graph.
// 2026-10-08: host attendance validation, store acceptance/recovery, and per-event routing add about
// 4 KB. Prompt text and request handling load on first use; static graph: about 3,174,000 B.
// 2026-10-08: 3,156,347 B with the instruction file check. The scan loads on first use. What runs at
// boot is the agents `before-send` handler registration, the `checkInstructionFiles` field's
// validation, and the `core:security` point id, so the ceiling moves by 1 KB.
// 2026-10-08: 3,176,006 B after combining the instruction check, goal admission callbacks, and
// reconnect Stop handling. The measured graph adds no dependency; the feature operations remain
// lazy. Add 2 KB for these acceptance and lifecycle paths, keeping less than 1 KB of margin.
// 2026-10-08: command restart recovery adds event attribution checks, client read projection calls,
// and lifecycle settlement calls. The command policy and reconciliation queries load on first use.
// No dependency is added. Static graph: 3,179,747 B. Add 4 KB for the owning runtime's call sites.
// 2026-10-09: the build minifies with Oxc and keeps function and class names (../vite.config.ts), and
// this check reads the build's chunk graph instead of the chunk text. Every figure above is
// unminified. The same graph went from 3,193,213 B to 1,824,878 B on macOS arm64; keeping names costs
// about 122 KB of that. The new ceiling keeps about 2 KB of minified margin. A floor of 1 MB still
// catches a walk that stops at service.js.
// 2026-10-09: 1,824,878 -> 1,702,960 B (minified) after performance phase 06 moved four optional paths
// to first use: the GitHub mirror routers (about 37 KB), the tunnel's `ws` server, the workflow file
// authoring and export module, and the Claude and Codex usage probes. The ceiling keeps about 2 KB of
// margin, so any one of those imports returning fails the build.
const limits = { ceiling: 1_705_000, floor: 1_000_000 }

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
