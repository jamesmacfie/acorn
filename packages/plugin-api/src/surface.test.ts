import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

// The plugin API is a contract, and a contract that can grow by accident is not one. This test
// pins the exported NAMES of every entrypoint against a committed list: adding, removing or
// renaming an export fails until the snapshot is updated, which is the deliberate act of changing
// the contract. Regenerate with `UPDATE_SURFACE=1 pnpm --filter @acorn/plugin-api test`, and say
// in the commit message why the surface moved.
//
// Names, not a rolled-up .d.ts. Every package here is consumed as TypeScript SOURCE — noEmit is
// set globally and nothing in the repo emits declarations — so a real rollup would mean adding a
// declaration build and API Extractor to a monorepo that deliberately has neither. What the
// snapshot cannot catch is an upstream type CHANGING shape underneath a stable name; `tsc
// --noEmit` across the seventeen plugins that consume this package already catches that, loudly.

const HERE = dirname(fileURLToPath(import.meta.url))

const ENTRYPOINTS = {
  node: 'node/index.ts',
  client: 'client/index.ts',
  ui: 'ui/index.ts',
  'ui/diff': 'ui/diff.ts',
}

// `export { a, b as c, type D } from '…'` and `export type { E, F } from '…'`. The entrypoints are
// re-export lists by construction — the boundaries test asserts this package adds no behaviour —
// so there is no local declaration to find.
const EXPORT_CLAUSE_RE = /\bexport\s+(type\s+)?\{([^}]*)\}\s*from\s*['"][^'"]+['"]/g

function exportedNames(source: string): string[] {
  const names: string[] = []
  EXPORT_CLAUSE_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = EXPORT_CLAUSE_RE.exec(source))) {
    for (const raw of match[2].split(',')) {
      const entry = raw.trim().replace(/^type\s+/, '')
      if (!entry) continue
      // `default as Icon` and `x as y` both export the right-hand name.
      const alias = entry.split(/\s+as\s+/)
      names.push(alias[alias.length - 1].trim())
    }
  }
  return names
}

it('the plugin API surface matches its snapshot', () => {
  const actual = Object.entries(ENTRYPOINTS)
    .flatMap(([entry, file]) => exportedNames(readFileSync(join(HERE, file), 'utf8')).map((name) => `${entry}: ${name}`))
    .sort()

  // Anti-vacuity: the assertion below is an exact match against a file, so a parser that stopped
  // matching would pass against an empty snapshot without anyone noticing.
  expect(actual.length).toBeGreaterThan(150)
  expect(actual).toContain('node: NodePlugin')
  expect(actual).toContain('client: ClientPlugin')
  expect(actual).toContain('ui: Button')
  expect(actual).toContain('ui/diff: buildDiffRows')
  expect(new Set(actual).size).toBe(actual.length) // no entrypoint exports the same name twice

  const snapshotPath = join(HERE, 'surface.snapshot.txt')
  if (process.env.UPDATE_SURFACE) writeFileSync(snapshotPath, actual.join('\n') + '\n')
  expect(actual).toEqual(readFileSync(snapshotPath, 'utf8').trim().split('\n'))
})
