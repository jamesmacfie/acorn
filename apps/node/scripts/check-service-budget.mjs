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

// The measured figure plus about 5%: 2,916,482 B on 2026-09-29. The ceiling was 2,910,000 B, and the
// last 48 KB over it is jsdiff, which the agent drivers use to write each file change's hunks
// (plugins/agents/src/server/drivers/patchText.ts). `floor` is a lower bound, not a target: a graph
// that small means the walk below stopped following imports, and a check that passes on that is blind.
const limits = { ceiling: 3_062_000, floor: 1_000_000 }

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
    + 'anything a boot does not need belongs behind a dynamic import in the plugin that owns it.',
  )
}
if (bytes < limits.floor) {
  throw new Error(
    `The node service's static graph is ${bytes}B, under the ${limits.floor}B floor. The node cannot boot on that little, `
    + 'so this check has stopped following the chunks service.js imports.',
  )
}
