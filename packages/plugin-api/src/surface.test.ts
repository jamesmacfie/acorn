import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
// This private workspace facade is consumed as source by compiled plugins. Pin its exported names so
// a barrel edit is visible in review. Its snapshot has no loaded-plugin API major: removing a
// compiled-only export does not change the published SDK, declarations, or manifest contract. See
// docs/plugins/package-shape.md § The plugin API for the two compatibility boundaries.

const HERE = dirname(fileURLToPath(import.meta.url))

const ENTRYPOINTS = {
  node: 'node.ts',
  client: 'client.ts',
  // The test seam is a contract too, and a more fragile one: a plugin's suite is the first thing that
  // breaks when it moves, and third-party authors have no other door into the host from a test.
  testkit: 'testkit.ts',
  'testkit/client': 'testkit/client.ts',
  'testkit/ws-client': 'testkit/wsClient.client.ts',
  ui: 'ui/index.ts',
  'ui/data-sources': 'ui/data-sources.ts',
  'ui/diff': 'ui/diff.ts',
  'ui/editor': 'ui/editor.ts',
  'ui/host': 'ui/host.ts',
  'ui/model-provider-failure': 'ui/model-provider-failure.ts',
  // The kit's vocabulary as data. Its own entrypoint so a node-environment consumer can read the
  // role enums without loading a component.
  'ui/tokens': 'ui/tokens.ts',
  'ui/sdk': 'ui/sdk.ts',
  // The tree path's kit: one node per name, plus the universal-renderer calls the JSX preset emits.
  'ui/tree': 'ui/tree.ts',
}

// `export { a, b as c, type D } from '…'` and `export type { E, F } from '…'`. The entrypoints are
// re-export lists by construction (the boundaries test asserts this package adds no behaviour), so
// there is no local declaration to find.
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

const SNAPSHOT_HEADER = '# private workspace facade'

function readSnapshot(path: string): string[] {
  const lines = readFileSync(path, 'utf8').trim().split('\n')
  if (lines[0] !== SNAPSHOT_HEADER) throw new Error(`${path} must start with "${SNAPSHOT_HEADER}"`)
  return lines.slice(1)
}

it('the private plugin facade matches its snapshot', () => {
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

  if (process.env.UPDATE_SURFACE) {
    writeFileSync(snapshotPath, [SNAPSHOT_HEADER, ...actual].join('\n') + '\n')
  }

  expect(actual).toEqual(readSnapshot(snapshotPath))
})
