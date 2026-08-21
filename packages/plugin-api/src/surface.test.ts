import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { PLUGIN_API_MAJOR } from '@acorn/protocol/pluginApiVersion.ts'

// The plugin API is a contract: this test pins the exported names of every entrypoint against a
// committed list, so a surface change is always something someone decided rather than something
// that slipped in. See docs/plugins.md § The plugin API for the snapshot, the regeneration command,
// and why adding a name still needs to weigh the same question as taking on a new dependency.
//
// Removing a name is a major bump. See docs/plugins.md § The plugin API for why PLUGIN_API_MAJOR is
// compared by exact string match at three places, and for why regeneration refuses to drop a name
// silently.
//
// Out of scope for this test: `@deprecated` markers, a removal schedule, a compatible-change commit
// trailer. See docs/plugins.md § What is published, and what acorn promises about it for why there
// is no deprecation program.
//
// Names, not a rolled-up .d.ts: every package here is consumed as source, since `noEmit` is set
// globally and nothing in the repo emits declarations (the same reasoning applies to the published
// surface, docs/plugins.md § What is published, and what acorn promises about it). What the snapshot
// cannot catch is an upstream type changing shape underneath a stable name; `tsc --noEmit` across
// the seventeen plugins that consume this package already catches that, loudly.

const HERE = dirname(fileURLToPath(import.meta.url))

const ENTRYPOINTS = {
  node: 'node/index.ts',
  client: 'client/index.ts',
  // The test seam is a contract too, and a more fragile one: a plugin's suite is the first thing that
  // breaks when it moves, and third-party authors have no other door into the host from a test.
  testkit: 'testkit/index.ts',
  ui: 'ui/index.ts',
  'ui/diff': 'ui/diff.ts',
  'ui/editor': 'ui/editor.ts',
  'ui/host': 'ui/host.ts',
  'ui/sdk': 'ui/sdk.ts',
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

// The snapshot's first line, e.g. `# plugin API major: 2`. It is in the snapshot rather than beside it
// so that one file answers both questions a reader has: what the surface is, and which major it is.
const MAJOR_LINE = /^# plugin API major: (.+)$/

function readSnapshot(path: string): { major: string; names: string[] } {
  const lines = readFileSync(path, 'utf8').trim().split('\n')
  const major = MAJOR_LINE.exec(lines[0])?.[1]
  if (!major) throw new Error(`${path} must start with "# plugin API major: <n>"`)
  return { major, names: lines.slice(1) }
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
  const committed = readSnapshot(snapshotPath)

  if (process.env.UPDATE_SURFACE) {
    // The gate, and the only place it can live: after regeneration there is nothing left to compare a
    // removal against, so the refusal has to happen instead of the write.
    const gone = committed.names.filter((name) => !actual.includes(name))
    if (gone.length && committed.major === PLUGIN_API_MAJOR) {
      throw new Error(
        `Regenerating this snapshot would remove ${gone.length} name(s) from the plugin API while `
          + `PLUGIN_API_MAJOR is still '${PLUGIN_API_MAJOR}'. Every plugin package pins that major by exact `
          + `string match, so a shrunken surface under an unchanged number is a break nothing announces.\n\n`
          + `Either put the name(s) back, or bump PLUGIN_API_MAJOR in packages/protocol/src/pluginApiVersion.ts `
          + `and rebuild the loaded packages (docs/plugins.md § The plugin API).\n\n`
          + gone.map((name) => `  - ${name}`).join('\n'),
      )
    }
    writeFileSync(snapshotPath, [`# plugin API major: ${PLUGIN_API_MAJOR}`, ...actual].join('\n') + '\n')
  }

  // Both halves of the pair, so neither can drift alone: the names, and the major they were pinned under.
  // Bumping the major without regenerating fails here too, which is what stops a bump from being a way to
  // launder a removal that never got written down.
  expect(actual).toEqual(readSnapshot(snapshotPath).names)
  expect(readSnapshot(snapshotPath).major).toBe(PLUGIN_API_MAJOR)
})
