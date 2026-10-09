import { appendFileSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'vite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  chunkBytes,
  describeChunks,
  externalSpecifiers,
  readChunkGraph,
  staticClosure,
  type ChunkGraph,
} from '../../../../scripts/chunkGraph.mts'

// The graph a real build writes, read back the way the service budget, the size report, and the
// standalone manifest check read it. Each case builds a small project formatted and minified, because
// the point of reading the bundler's graph is that the two must count the same thing.

const HEAVY = 40_000

const sources = (heavyImport: 'static' | 'lazy'): Record<string, string> => ({
  'service.js': [
    "import './sideEffect.js'",
    "import { shared } from './reexport.js'",
    "import { spawn } from 'node-pty'",
    "import { createRequire } from 'node:module'",
    heavyImport === 'static' ? "import { heavy } from './heavy.js'" : '',
    'const nodeRequire = createRequire(import.meta.url)',
    heavyImport === 'static' ? 'export const load = () => heavy' : "export const load = () => import('./heavy.js')",
    "export const browser = () => import('playwright-core')",
    "export const forge = () => nodeRequire('node-forge')",
    'export const run = () => [shared(), spawn]',
  ].join('\n'),
  // A second entry sharing a module, so the shared code lands in a chunk of its own.
  'mcp.js': "import { shared } from './shared.js'\nexport const tool = () => shared()",
  'reexport.js': "export { shared } from './shared.js'",
  'shared.js': `export function shared() { return '${'s'.repeat(2_000)}' }`,
  'sideEffect.js': `globalThis.acornFixture = '${'e'.repeat(1_000)}'`,
  'heavy.js': `export const heavy = '${'h'.repeat(HEAVY)}'`,
})

async function buildFixture(root: string, minify: boolean, heavyImport: 'static' | 'lazy' = 'lazy'): Promise<string> {
  for (const [file, source] of Object.entries(sources(heavyImport))) writeFileSync(join(root, file), source)
  const outDir = join(root, minify ? 'minified' : 'formatted')
  await build({
    configFile: false,
    root,
    logLevel: 'silent',
    plugins: [{
      name: 'fixture-graph',
      generateBundle(_options, bundle) {
        const chunks = describeChunks(this, bundle, root)
        this.emitFile({ type: 'asset', fileName: 'startup-graph.json', source: JSON.stringify({ entry: 'service.js', roots: ['service.js'], chunks }) })
      },
    }],
    build: {
      ssr: true,
      outDir,
      emptyOutDir: true,
      minify: minify ? 'oxc' : false,
      rollupOptions: {
        input: { service: join(root, 'service.js'), mcp: join(root, 'mcp.js') },
        external: (id) => id.startsWith('node:') || ['node-pty', 'playwright-core', 'node-forge'].includes(id),
        output: { format: 'es', keepNames: true, entryFileNames: '[name].js', chunkFileNames: 'chunks/[name]-[hash].js' },
      },
    },
  })
  return outDir
}

const startup = (graph: ChunkGraph) => {
  const closure = staticClosure(graph)
  const externals = externalSpecifiers(graph, closure)
  return {
    modules: [...closure].flatMap((file) => graph.chunks[file].modules).sort(),
    atLoad: [...externals.atLoad],
    onFirstUse: [...externals.onFirstUse],
    required: [...externals.required],
    bytes: chunkBytes(graph, closure),
  }
}

describe('chunk graph', () => {
  let root: string
  // The bundler reports real paths, and macOS's temporary directory is behind a symlink.
  beforeEach(() => { root = realpathSync(mkdtempSync(join(tmpdir(), 'chunk-graph-'))) })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('finds the same startup closure in formatted and minified output', async () => {
    const formatted = startup(readChunkGraph(await buildFixture(root, false)))
    const minified = startup(readChunkGraph(await buildFixture(root, true)))

    expect(formatted.modules).toEqual(['rolldown/runtime.js', 'service.js', 'shared.js', 'sideEffect.js'])
    expect(formatted.atLoad).toEqual(['node-pty'])
    expect(formatted.onFirstUse).toEqual(['playwright-core'])
    expect(formatted.required).toEqual(['node-forge'])
    expect({ ...minified, bytes: 0 }).toEqual({ ...formatted, bytes: 0 })
    expect(minified.bytes).toBeLessThan(formatted.bytes)
  })

  it('counts a lazy heavy module once a static import reaches it', async () => {
    const lazy = startup(readChunkGraph(await buildFixture(root, true, 'lazy')))
    const eager = startup(readChunkGraph(await buildFixture(root, true, 'static')))

    expect(lazy.modules).not.toContain('heavy.js')
    expect(eager.modules).toContain('heavy.js')
    // Less the few bytes of dynamic-import glue the eager build no longer needs.
    expect(eager.bytes - lazy.bytes).toBeGreaterThan(HEAVY - 100)
  })

  it('refuses a graph that no longer describes the build', async () => {
    const dist = await buildFixture(root, true)
    const graph = JSON.parse(readFileSync(join(dist, 'startup-graph.json'), 'utf8')) as ChunkGraph
    const shared = Object.keys(graph.chunks).find((file) => graph.chunks[file].modules.includes('shared.js'))!
    expect(shared).toMatch(/^chunks\//)

    appendFileSync(join(dist, 'service.js'), '\n')
    expect(() => readChunkGraph(dist)).toThrow(/stale: records \d+ B for service\.js, which has \d+ B/)

    const { [shared]: _dropped, ...rest } = graph.chunks
    writeFileSync(join(dist, 'startup-graph.json'), JSON.stringify({ ...graph, chunks: { ...rest, 'service.js': { ...graph.chunks['service.js'], bytes: graph.chunks['service.js'].bytes + 1 } } }))
    expect(() => readChunkGraph(dist)).toThrow(new RegExp(`import ${shared} without naming it.*does not name ${shared}`))

    rmSync(join(dist, 'startup-graph.json'))
    expect(() => readChunkGraph(dist)).toThrow(/ENOENT/)
  })
})
