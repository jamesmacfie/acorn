import { linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { buildSizeReport, describeSizeReport, graphStartupBytes, inventory, SIZE_REPORT_SCHEMA } from './size-report.mjs'

const scratch = []
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const fixture = () => {
  const dir = mkdtempSync(join(tmpdir(), 'acorn-size-report-test-'))
  scratch.push(dir)
  return dir
}

/** A file of exactly `bytes` bytes. */
const file = (root, path, bytes) => {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), 'x'.repeat(bytes))
}

const json = (root, path, value) => {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), JSON.stringify(value))
}

/** A built renderer: an entry, one static import, a stylesheet, and a roster loaded after the frame. */
function renderer(pkg) {
  const client = join(pkg, 'dist/client')
  mkdirSync(client, { recursive: true })
  writeFileSync(join(client, 'index.html'), '<script type="module" src="/assets/index.js"></script>')
  file(client, 'assets/index.js', 100)
  file(client, 'assets/shared.js', 20)
  file(client, 'assets/index.css', 10)
  file(client, 'assets/roster.js', 50)
  file(client, 'assets/index.js.map', 999)
  json(pkg, 'dist/renderer-manifest.json', {
    'src/client/index.html': { file: 'assets/index.js', isEntry: true, imports: ['_shared'], css: ['assets/index.css'], dynamicImports: ['src/client/plugins.ts'] },
    _shared: { file: 'assets/shared.js' },
    'src/client/plugins.ts': { file: 'assets/roster.js', imports: ['_shared'] },
  })
  json(pkg, 'dist/renderer-modules.json', {})
}

/** A Node or terminal dist with its startup graph: the entry, one static chunk, one dynamic one. */
function graphDist(dist, entry) {
  file(dist, entry, 30)
  file(dist, 'chunks/static.js', 7)
  file(dist, 'chunks/lazy.js', 500)
  json(dist, 'startup-graph.json', {
    entry,
    roots: [entry],
    chunks: {
      [entry]: { imports: ['chunks/static.js'], dynamicImports: ['chunks/lazy.js'], requires: [], modules: [], bytes: 30 },
      'chunks/static.js': { imports: [], dynamicImports: [], requires: [], modules: [], bytes: 7 },
      'chunks/lazy.js': { imports: [], dynamicImports: [], requires: [], modules: [], bytes: 500 },
    },
  })
}

const report = (pkg, overrides = {}) => buildSizeReport({
  pkg,
  nodeDist: join(pkg, 'node-dist'),
  tuiDist: join(pkg, 'tui-dist'),
  nativeRuntime: join(pkg, 'binaries/node'),
  shellBinary: join(pkg, 'target/acorn-desktop'),
  bundleDir: join(pkg, 'bundle'),
  release: '1.2.3',
  checkout: 'abc123',
  platform: 'darwin',
  arch: 'arm64',
  ...overrides,
})

it('separates startup, registration, components, and artifacts, and names what it did not count', async () => {
  const pkg = fixture()
  renderer(pkg)
  graphDist(join(pkg, 'node-dist'), 'service.js')
  file(pkg, 'dist/helper/service.js', 40)
  file(pkg, 'dist/helper/node_modules/dep/index.js', 60)
  file(pkg, 'dist/helper/size-report.json', 5_000)
  file(pkg, 'binaries/node', 1_000)
  file(pkg, 'bundle/dmg/acorn.dmg', 700)

  const result = await report(pkg)
  expect(result).toMatchObject({ schema: SIZE_REPORT_SCHEMA, release: '1.2.3', platform: 'darwin', arch: 'arm64', buildMode: 'production' })
  expect(result.startup).toEqual([
    { runtime: 'renderer', phase: 'startup', bytes: 130, scriptBytes: 120, styleBytes: 10 },
    // The shared chunk is already startup, so registration counts only what the roster adds.
    { runtime: 'renderer', phase: 'registration', bytes: 50 },
    { runtime: 'node', phase: 'startup', bytes: 37 },
  ])
  const bytesOf = (name) => result.components.find((entry) => entry.component === name)?.bytes
  // index.html and the four assets. The source map and the report itself are metadata, so neither counts.
  expect(bytesOf('renderer')).toBe(54 + 180)
  // node_modules belongs to the runtime dependencies, not to the service as well.
  expect(bytesOf('node-service')).toBe(40)
  expect(bytesOf('runtime-dependencies')).toBe(60)
  expect(bytesOf('native-runtime')).toBe(1_000)
  expect(result.installedBytes).toBe(54 + 180 + 40 + 60 + 1_000)
  expect(result.releaseArtifacts).toEqual([{ kind: 'dmg', name: 'acorn.dmg', bytes: 700 }])
  expect(result.excluded.map((entry) => entry.path).sort()).toEqual(['client/assets/index.js.map', 'helper/size-report.json'])
  expect(result.missing).toEqual([
    expect.stringMatching(/^tui startup graph: /),
    'frame-bridge: dist/bridge',
    'cli: dist/cli',
    'bundled-plugins: dist/bundled-plugins',
    'shell: target/acorn-desktop',
  ])
  expect(describeSizeReport(result)).toContain('installed total')
})

it('counts a file reached twice only once', () => {
  const root = fixture()
  file(root, 'a/one.js', 10)
  mkdirSync(join(root, 'b'))
  linkSync(join(root, 'a/one.js'), join(root, 'b/same.js'))
  const seen = new Set()
  const first = inventory(join(root, 'a'), { seen })
  const second = inventory(join(root, 'b'), { seen })
  expect([first.bytes, second.bytes, second.duplicates]).toEqual([10, 0, 1])
})

it('never follows a symlink, and lists one that leaves its component', () => {
  const root = fixture()
  file(root, 'outside/secret.bin', 1_000)
  file(root, 'component/real.js', 10)
  symlinkSync(join(root, 'outside'), join(root, 'component/escape'))
  symlinkSync(join(root, 'component/real.js'), join(root, 'component/alias.js'))
  const counted = inventory(join(root, 'component'))
  expect(counted.bytes).toBe(10)
  expect(counted.excluded).toEqual([{ path: 'escape', reason: 'symlink outside its component' }])
})

it('fails on a startup graph that does not describe the build beside it', () => {
  const dist = fixture()
  graphDist(dist, 'main.js')
  expect(graphStartupBytes(dist)).toBe(37)
  file(dist, 'chunks/rebuilt-abc.js', 1)
  expect(() => graphStartupBytes(dist)).toThrow(/stale: does not name chunks\/rebuilt-abc\.js/)
  rmSync(join(dist, 'chunks/rebuilt-abc.js'))
  rmSync(join(dist, 'chunks/static.js'))
  expect(() => graphStartupBytes(dist)).toThrow(/stale: names missing chunks\/static\.js/)
})

it('fails on a renderer manifest that names a file the build does not have', async () => {
  const pkg = fixture()
  renderer(pkg)
  rmSync(join(pkg, 'dist/client/assets/roster.js'))
  await expect(report(pkg)).rejects.toThrow(/renderer-manifest\.json is stale: names missing assets\/roster\.js/)
})
