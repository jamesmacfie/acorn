import { readFileSync, statSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'

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
// It also lists the bare imports the graph leaves for Node to resolve at run time, so a new one shows
// up in the build output rather than as a missing package on somebody's machine.

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
const limits = { ceiling: 3_119_000, floor: 1_000_000 }

const builtins = new Set(builtinModules)
const isBuiltin = (specifier) => builtins.has(specifier) || builtins.has(specifier.replace(/^node:/, ''))

// Rolldown writes one import or re-export per line at the top of a chunk, with double quotes.
const STATIC = /^(?:import|export)\b[^;]*?\bfrom\s*"([^"]+)"|^import\s*"([^"]+)"/gm
const DYNAMIC = /\bimport\(\s*"([^"]+)"\s*\)/g

const files = new Set()
const staticBare = new Set()
const lazyBare = new Set()
const visit = (file) => {
  if (files.has(file)) return
  files.add(file)
  const source = readFileSync(file, 'utf8')
  for (const match of source.matchAll(STATIC)) {
    const specifier = match[1] ?? match[2]
    if (specifier.startsWith('.')) visit(resolve(dirname(file), specifier))
    else if (!isBuiltin(specifier)) staticBare.add(specifier)
  }
  for (const [, specifier] of source.matchAll(DYNAMIC)) {
    if (!specifier.startsWith('.') && !isBuiltin(specifier)) lazyBare.add(specifier)
  }
}
visit(join(dist, 'service.js'))

const bytes = [...files].reduce((total, file) => total + statSync(file).size, 0)
const list = (names) => (names.size ? [...names].sort().join(', ') : 'none')
console.log(`[service-budget] ${relative(process.cwd(), join(dist, 'service.js'))} and ${files.size - 1} chunk(s): ${bytes}B (ceiling ${limits.ceiling}B)`)
console.log(`[service-budget] resolved at run time: ${list(staticBare)}; on first use: ${list(lazyBare)}`)

if (bytes > limits.ceiling) {
  throw new Error(
    `The node service's static graph is ${bytes}B, over the ${limits.ceiling}B ceiling. Find what grew before raising it: `
    + 'run pnpm --filter @acorn/node measure:service-graph [--why <path fragment>]. '
    + 'Anything a boot does not need belongs behind a dynamic import in the plugin that owns it.',
  )
}
if (bytes < limits.floor) {
  throw new Error(
    `The node service's static graph is ${bytes}B, under the ${limits.floor}B floor. The node cannot boot on that little, `
    + 'so this check has stopped following the chunks service.js imports.',
  )
}
