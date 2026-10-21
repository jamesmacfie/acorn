import { readFile, stat } from 'node:fs/promises'
import { basename, resolve } from 'node:path'

// The phone's startup budget: every script and stylesheet the first screen loads, read from the
// manifest Vite writes into `dist/.vite`. The desktop's is apps/desktop/scripts/check-renderer-budget.mjs,
// and docs/frontend/startup-budget.md owns the contract for both.
//
//   node scripts/check-startup-budget.mjs
//
// The startup set is the entry's static closure plus STARTUP_IMPORTS. The roster and every pane load
// later, so they aren't counted.

const dist = resolve(import.meta.dirname, '../dist')

// About 5% above the measurement of 482,910 B of scripts and 121,692 B of styles on October 21, 2026.
// A change that needs more raises the limit in the same commit and says why. Under the floor, the
// check is reading the wrong graph.
const limits = { scripts: 507_000, styles: 128_000, floor: 100_000 }

// `main.tsx` installs the seam and then awaits this before it draws, so it is startup even though it
// is a dynamic import.
const STARTUP_IMPORTS = ['src/client/start.tsx']

// Lazy surfaces that must never load before the first screen, whatever they weigh: the desktop's list
// (check-renderer-budget.mjs), tested here against chunk names.
const DENYLIST = [
  'shiki', 'wasm', 'DiffPane', 'prModel', 'prSections', 'viewState', 'icon-nodes',
  'MemoryAddForm', 'draft-', 'draftStore', 'stepFields', 'GithubImporter', 'PreviewTaskPane', 'PreviewPane',
  'workerHost', 'chromeRegister', 'chromeData', 'PromoteToTaskModal',
]
// The built-in plugins, which `installRoster` imports after the first frame.
const PLUGINS = 'src/client/plugins.ts'

const manifest = JSON.parse(
  await readFile(resolve(dist, '.vite/manifest.json'), 'utf8').catch(() => {
    throw new Error(`No Vite manifest in ${dist}. Build the app with \`vite build\` before running this check.`)
  }),
)
const entry = Object.keys(manifest).find((key) => manifest[key].isEntry)
const keys = new Set()
const visit = (key) => {
  if (keys.has(key) || !manifest[key]) return
  keys.add(key)
  for (const next of manifest[key].imports ?? []) visit(next)
}
for (const key of [entry, ...STARTUP_IMPORTS]) visit(key)
const files = [...new Set([...keys].flatMap((key) => [manifest[key].file, ...(manifest[key].css ?? [])]))]

const bytes = async (paths) =>
  (await Promise.all(paths.map(async (path) => (await stat(resolve(dist, path))).size))).reduce((a, b) => a + b, 0)
const scripts = await bytes(files.filter((path) => !path.endsWith('.css')))
const styles = await bytes(files.filter((path) => path.endsWith('.css')))
console.log(`[mobile-budget] startup scripts=${scripts}B styles=${styles}B chunks=${keys.size}`)

const problems = []
if (!manifest[PLUGINS] || files.includes(manifest[PLUGINS].file))
  problems.push(`${PLUGINS} loads with the first screen. Import it only from installRoster, after the first frame.`)
const denied = files.filter((path) => DENYLIST.some((prefix) => basename(path).startsWith(prefix)))
if (denied.length)
  problems.push(
    `Lazy surfaces in the first screen's graph: ${denied.join(', ')}. The table that names them should hold ` +
      'a loader, not the value (docs/frontend/startup-budget.md § Startup budget).',
  )
if (scripts > limits.scripts || styles > limits.styles)
  problems.push(
    `Mobile startup budget exceeded (scripts ${scripts}/${limits.scripts}B, styles ${styles}/${limits.styles}B). ` +
      'Load what the first screen doesn’t draw after it, as the roster loads.',
  )
if (scripts < limits.floor)
  problems.push(
    `Mobile startup scripts total ${scripts}B, under the ${limits.floor}B floor, so this check is reading the ` +
      'wrong graph. If the entry now loads the app through another dynamic import, add it to STARTUP_IMPORTS.',
  )
if (problems.length) throw new Error(problems.join('\n'))
