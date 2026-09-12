import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Which Lucide icons the renderer draws without waiting, written down by a script so the list cannot
// rot.
//
// `Icon` resolves a name against a map at render time, so a bundler cannot see which of Lucide's 1,756
// icons are reachable and puts all 706 KB of geometry in a startup chunk. Dropping the unreachable ones
// is not on the table: a person can assign any icon to a task and a plugin manifest can name any one,
// and both choices are persisted (docs/performance.md § Dropping unreferenced icons).
//
// So the set is split. The names that appear as literals in this tree are the ones the chrome draws on
// the first frame, and they are written to iconNodes.eager.json, which the Icon chunk carries. Everything
// else arrives behind a dynamic import, which is what IconPicker and the task rail await.
//
// Run it two ways:
//
//   node scripts/icon-census.mjs           rewrite iconNodes.eager.json from the tree
//   node scripts/icon-census.mjs --check   fail if the tree names an icon the file does not carry
//
// The check runs in this package's `lint`, so a new literal icon cannot ship in the lazy half by
// accident and flash as its own name for a frame.

const CLIENT_CORE = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REPO = resolve(CLIENT_CORE, '../..')
const DEFAULT_ROOTS = ['packages', 'plugins', 'apps'].map((dir) => join(REPO, dir))
const DEFAULT_EAGER = join(CLIENT_CORE, 'src/kit/tokens/iconNodes.eager.json')
const LUCIDE = join(CLIENT_CORE, 'node_modules/lucide-static/icon-nodes.json')

// Build output and other checkouts, neither of which is "the tree". Every dot directory goes too, which
// is what keeps `.acorn/worktrees` — whole other repositories — out of the scan.
const SKIP_DIRS = new Set(['node_modules', 'dist', 'target', 'coverage', 'test', 'e2e', 'testkit'])
const SOURCE = /\.(ts|tsx|js|jsx|mjs)$/
// Product code only. A test's icon name is a fixture, nothing draws it, and counting them would put
// whatever a suite happened to invent in the startup chunk — the same reasoning the arch ratchets use.
const IS_TEST = /\.(test|test-d|spec)\.(ts|tsx|js|jsx|mjs)$/

// An icon name spelled at a call site: `<Icon name="pin" />`, `icon: 'pin'`, `glyph: 'pin'`. Broad on
// purpose — `name` catches attributes that have nothing to do with icons, and the Lucide membership
// test below throws those away. Over-inclusion costs a few hundred bytes; a miss costs a flash of text.
const KEYED = /(?:\b(?:name|icon|glyph|iconName)\s*[:=]\s*|\b(?:name|icon|glyph)=)['"`]([a-z0-9][a-z0-9-]{1,40})['"`]/g
// …and a name in a table of them, where the key beside it says nothing (`EXTENSION_KIND_ICON`,
// `LEAD`, a switch arm). Any short lowercase literal on a line that mentions an icon at all. Same
// membership test, same trade.
const LITERAL = /['"]([a-z][a-z0-9-]{1,40})['"]/g
const MENTIONS_ICON = /icon|glyph/i

function sourceFiles(root) {
  const out = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (SOURCE.test(entry.name) && !IS_TEST.test(entry.name)) out.push(path)
    }
  }
  walk(root)
  return out
}

export function censusNames(roots, lucideNames) {
  const found = new Set()
  for (const root of roots) {
    for (const file of sourceFiles(root)) {
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(KEYED)) if (lucideNames.has(match[1])) found.add(match[1])
      for (const line of source.split('\n')) {
        if (!MENTIONS_ICON.test(line)) continue
        for (const match of line.matchAll(LITERAL)) if (lucideNames.has(match[1])) found.add(match[1])
      }
    }
  }
  return [...found].sort()
}

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`)
  return at === -1 ? fallback : args[at + 1]
}
const check = args.includes('--check')
const roots = args.flatMap((arg, i) => (args[i - 1] === '--root' ? [resolve(arg)] : []))
const eagerPath = resolve(flag('eager', DEFAULT_EAGER))

const lucide = JSON.parse(readFileSync(flag('lucide', LUCIDE), 'utf8'))
const names = censusNames(roots.length ? roots : DEFAULT_ROOTS, new Set(Object.keys(lucide)))
// Sorted keys, so a regeneration that found nothing new is a no-op diff.
const eager = `${JSON.stringify(Object.fromEntries(names.map((name) => [name, lucide[name]])), null, 0)}\n`

if (!check) {
  writeFileSync(eagerPath, eager)
  console.log(`[icon-census] ${names.length} eager icons, ${eager.length}B -> ${eagerPath}`)
  process.exit(0)
}

const onDisk = (() => {
  try {
    return JSON.parse(readFileSync(eagerPath, 'utf8'))
  } catch {
    return null
  }
})()
const missing = onDisk ? names.filter((name) => !(name in onDisk)) : names
// Reported, not fatal. A name that left the tree only wastes bytes, and failing a build over it would
// mean every icon deletion is also a build break.
const stale = onDisk ? Object.keys(onDisk).filter((name) => !names.includes(name)) : []

if (missing.length) {
  console.error(
    `[icon-census] ${missing.length} icon name${missing.length === 1 ? '' : 's'} spelled in the tree but not in the eager set: ${missing.join(', ')}.\n`
    + '  Those would render as their own text for a frame. Run `pnpm --filter @acorn/client-core icons` to regenerate '
    + 'packages/client-core/src/kit/tokens/iconNodes.eager.json, and commit it.',
  )
  process.exit(1)
}
console.log(`[icon-census] ${names.length} eager icons, ${statSync(eagerPath).size}B${stale.length ? `, ${stale.length} no longer referenced` : ''}`)
