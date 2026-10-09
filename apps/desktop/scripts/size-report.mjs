#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runtimeBinaryName, runtimeTarget, targetTriple } from './node-runtime.mjs'
import { readRendererGraph } from './renderer-graph.mjs'

// What the desktop build ships and what each runtime loads before it can draw, as one versioned JSON
// report (docs/local-development/profiling.md § Measuring shipped bytes).
//
//   node scripts/size-report.mjs [--out <file>] [--bundle <tauri bundle dir>]
//
// It answers four separate questions, and keeps them separate because they move independently:
//
//   startup        bytes each runtime loads before its first frame or its first answer
//   registration   bytes the renderer loads right after its first frame, the compiled plugin roster
//   components     installed bytes per app-owned component, JavaScript counted apart
//   artifacts      compressed release files, only when a packaged bundle is on disk
//
// Every file is counted once, by device and inode, and symlinks are never followed. A link that points
// outside its component is listed, not counted. Build metadata is excluded by name. A component or
// graph the build did not produce is listed under `missing` rather than counted as zero, and a graph
// that names a file the build does not have, or misses one it does, fails the report as stale.
//
// The default output goes beside the helper, so the packaged Node can read the build's numbers at run
// time without measuring them again (packages/node-core/src/server/telemetry/installedBytes.ts). The
// report is in its own exclusion list, so it never counts itself.

export const SIZE_REPORT_SCHEMA = 1

const PKG = resolve(import.meta.dirname, '..')
const ROOT = resolve(PKG, '../..')

/** Installed path under the app's resource root, the staged directory it comes from, and any
 *  subdirectory that belongs to a different component. Mirrors `bundle.resources` in
 *  src-tauri/tauri.conf.json. */
export const COMPONENTS = [
  { component: 'renderer', path: 'client', staged: 'dist/client' },
  { component: 'frame-bridge', path: 'bridge', staged: 'dist/bridge' },
  { component: 'node-service', path: 'helper', staged: 'dist/helper', skip: ['node_modules'] },
  { component: 'runtime-dependencies', path: 'helper/node_modules', staged: 'dist/helper/node_modules' },
  { component: 'cli', path: 'cli', staged: 'dist/cli' },
  { component: 'bundled-plugins', path: 'plugins', staged: 'dist/bundled-plugins' },
]

export const EXCLUDED_METADATA = ['*.map', '.DS_Store', 'size-report.json', 'startup-graph.json']
const isMetadata = (name) => name.endsWith('.map') || EXCLUDED_METADATA.includes(name)
const isJavaScript = (name) => /\.[cm]?js$/.test(name)
const inside = (root, path) => path === root || path.startsWith(root + sep)

/**
 * Bytes under one directory. `seen` is shared across components, so a file reached twice, through a
 * hard link or a second component, is counted the first time only.
 */
export function inventory(root, { skip = [], seen = new Set() } = {}) {
  const result = { bytes: 0, files: 0, javascriptBytes: 0, duplicates: 0, excluded: [] }
  const realRoot = realpathSync(root)
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      const rel = relative(root, path)
      if (skip.includes(rel)) continue
      if (entry.isSymbolicLink()) {
        let target = null
        try { target = realpathSync(path) } catch { /* a dangling link is an escape too */ }
        if (!target || !inside(realRoot, target)) result.excluded.push({ path: rel, reason: 'symlink outside its component' })
        continue
      }
      if (entry.isDirectory()) { walk(path); continue }
      if (!entry.isFile()) continue
      if (isMetadata(entry.name)) { result.excluded.push({ path: rel, reason: 'build metadata' }); continue }
      const stats = statSync(path)
      const key = `${stats.dev}:${stats.ino}`
      if (seen.has(key)) { result.duplicates += 1; continue }
      seen.add(key)
      result.bytes += stats.size
      result.files += 1
      if (isJavaScript(entry.name)) result.javascriptBytes += stats.size
    }
  }
  walk(root)
  return result
}

/**
 * The static closure of a `startup-graph.json` (apps/tui/startupGraph.ts, apps/node/vite.config.ts).
 * Stale when the graph names a chunk that is not on disk, or a chunk folder holds a script the graph
 * never saw, which is what a graph left over from an earlier build looks like. Only folders the graph
 * already uses are checked, because a worker bundle lands in its own folder and is not a chunk.
 */
export function graphStartupBytes(dist) {
  const graph = JSON.parse(readFileSync(join(dist, 'startup-graph.json'), 'utf8'))
  const named = new Set(Object.keys(graph.chunks))
  const chunkFolders = new Set([...named].map((file) => dirname(file)).filter((folder) => folder !== '.'))
  const onDisk = filesUnder(dist).map((path) => relative(dist, path).split(sep).join('/')).filter(isJavaScript)
  const unknown = onDisk.filter((file) => chunkFolders.has(dirname(file)) && !named.has(file))
  const absent = [...named].filter((file) => !existsSync(join(dist, file)))
  if (unknown.length || absent.length || !named.has(graph.entry)) {
    throw new Error(`${join(dist, 'startup-graph.json')} is stale: ${[
      ...absent.map((file) => `names missing ${file}`),
      ...unknown.map((file) => `does not name ${file}`),
    ].join(', ') || `does not name its entry ${graph.entry}`}. Rebuild it.`)
  }
  const closure = new Set()
  const visit = (file) => {
    if (closure.has(file) || !graph.chunks[file]) return
    closure.add(file)
    for (const next of graph.chunks[file].imports) visit(next)
  }
  for (const root of graph.roots) visit(root)
  return [...closure].reduce((sum, file) => sum + statSync(join(dist, file)).size, 0)
}

const filesUnder = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const path = join(dir, entry.name)
  return entry.isDirectory() ? filesUnder(path) : entry.isFile() ? [path] : []
})

async function rendererStartup(clientDir) {
  const graph = await readRendererGraph(clientDir)
  // Every file the manifest names must exist, or the manifest describes another build.
  const absent = Object.values(graph.manifest).flatMap((chunk) => [chunk.file, ...chunk.css ?? []]).filter((file) => !existsSync(join(clientDir, file)))
  if (absent.length) throw new Error(`renderer-manifest.json is stale: names missing ${absent.join(', ')}. Rebuild the renderer.`)
  const size = (files) => [...files].reduce((sum, file) => sum + statSync(join(clientDir, file)).size, 0)
  const scripts = [...graph.startupFiles].filter((file) => !file.endsWith('.css'))
  const styles = [...graph.startupFiles].filter((file) => file.endsWith('.css'))
  // The compiled roster, imported by ./src/client/activate.ts after the first frame.
  const roster = 'src/client/plugins.ts'
  const registration = graph.manifest[roster]
    ? [...graph.filesOf(graph.closure([roster]))].filter((file) => !graph.startupFiles.has(file))
    : null
  return { scripts: size(scripts), styles: size(styles), registration: registration && size(registration) }
}

const RELEASE_KINDS = ['dmg', 'macos', 'nsis', 'msi', 'appimage', 'deb', 'rpm']

/** Build the report. Every location is an argument, so a test can point it at a fixture. */
export async function buildSizeReport({ pkg = PKG, nodeDist, tuiDist, nativeRuntime, shellBinary, bundleDir, release, checkout, platform, arch }) {
  const missing = []
  const excluded = []
  const startup = []
  const attempt = async (label, run) => {
    try { return await run() } catch (error) {
      if (error.code !== 'ENOENT') throw error
      missing.push(`${label}: ${error.path ?? 'not built'}`)
      return null
    }
  }

  const renderer = await attempt('renderer startup graph', () => rendererStartup(join(pkg, 'dist/client')))
  if (renderer) {
    startup.push({ runtime: 'renderer', phase: 'startup', bytes: renderer.scripts + renderer.styles, scriptBytes: renderer.scripts, styleBytes: renderer.styles })
    if (renderer.registration === null) missing.push('renderer registration: the compiled roster has no chunk of its own')
    else startup.push({ runtime: 'renderer', phase: 'registration', bytes: renderer.registration })
  }
  for (const [runtime, dist] of [['node', nodeDist], ['tui', tuiDist]]) {
    const bytes = await attempt(`${runtime} startup graph`, () => graphStartupBytes(dist))
    if (bytes !== null) startup.push({ runtime, phase: 'startup', bytes })
  }

  const seen = new Set()
  const components = []
  for (const { component, path, staged, skip } of COMPONENTS) {
    const dir = join(pkg, staged)
    if (!existsSync(dir)) { missing.push(`${component}: ${staged}`); continue }
    const counted = inventory(dir, { skip, seen })
    excluded.push(...counted.excluded.map((entry) => ({ ...entry, path: `${path}/${entry.path}` })))
    components.push({ component, path, bytes: counted.bytes, files: counted.files, javascriptBytes: counted.javascriptBytes, duplicates: counted.duplicates })
  }
  for (const [component, file] of [['native-runtime', nativeRuntime], ['shell', shellBinary]]) {
    if (!file || !existsSync(file)) { missing.push(`${component}: ${file ? relative(pkg, file) : 'not located'}`); continue }
    components.push({ component, path: null, bytes: statSync(file).size, files: 1, javascriptBytes: 0, duplicates: 0 })
  }

  const releaseArtifacts = []
  for (const kind of RELEASE_KINDS) {
    const dir = bundleDir && join(bundleDir, kind)
    if (!dir || !existsSync(dir)) continue
    for (const name of readdirSync(dir)) {
      const stats = lstatSync(join(dir, name))
      if (stats.isFile()) releaseArtifacts.push({ kind, name, bytes: stats.size })
    }
  }
  if (!releaseArtifacts.length) missing.push('release artifacts: no packaged bundle on disk; CI reports them after packaging')

  return {
    schema: SIZE_REPORT_SCHEMA,
    generatedAt: new Date().toISOString(),
    release,
    checkout,
    platform,
    arch,
    buildMode: 'production',
    method: 'Apparent file sizes from stat. Each file counted once by device and inode. Symlinks not followed.',
    excludedMetadata: EXCLUDED_METADATA,
    startup,
    components,
    javascriptBytes: components.reduce((sum, entry) => sum + entry.javascriptBytes, 0),
    installedBytes: components.reduce((sum, entry) => sum + entry.bytes, 0),
    releaseArtifacts,
    excluded,
    missing,
  }
}

const formatBytes = (bytes) => `${bytes.toLocaleString('en')} B`.padStart(16)

/** The readable half: one line per number, for a terminal. */
export function describeSizeReport(report) {
  return [
    `[size-report] ${report.release} ${report.platform}-${report.arch} at ${report.checkout}`,
    ...report.startup.map((entry) => `${formatBytes(entry.bytes)}  ${entry.runtime} ${entry.phase}`),
    ...report.components.map((entry) => `${formatBytes(entry.bytes)}  ${entry.component} (${entry.files} files, ${entry.javascriptBytes.toLocaleString('en')} B JavaScript)`),
    `${formatBytes(report.installedBytes)}  installed total`,
    ...report.releaseArtifacts.map((entry) => `${formatBytes(entry.bytes)}  ${entry.kind}/${entry.name}`),
    ...report.missing.map((entry) => `  missing: ${entry}`),
    ...(report.excluded.length ? [`  excluded: ${report.excluded.length} files (${report.excludedMetadata.join(', ')}, links outside a component)`] : []),
  ].join('\n')
}

async function main() {
  const args = process.argv.slice(2)
  const flag = (name) => { const index = args.indexOf(name); return index === -1 ? undefined : resolve(args[index + 1]) }
  const triple = targetTriple()
  const { platform, arch } = runtimeTarget(triple)
  const git = (...gitArgs) => { try { return execFileSync('git', gitArgs, { cwd: ROOT, encoding: 'utf8' }).trim() } catch { return 'unknown' } }
  const shellName = `acorn-desktop${platform === 'win32' ? '.exe' : ''}`
  const report = await buildSizeReport({
    nodeDist: join(ROOT, 'apps/node/dist'),
    tuiDist: join(ROOT, 'apps/tui/dist'),
    nativeRuntime: join(PKG, 'src-tauri/binaries', runtimeBinaryName(triple)),
    shellBinary: join(PKG, 'src-tauri/target/release', shellName),
    bundleDir: flag('--bundle') ?? join(PKG, 'src-tauri/target/release/bundle'),
    release: JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')).version,
    checkout: git('rev-parse', '--short=12', 'HEAD') + (git('status', '--porcelain') ? '-dirty' : ''),
    platform,
    arch,
  })
  const out = flag('--out') ?? join(PKG, 'dist/helper/size-report.json')
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`)
  console.log(describeSizeReport(report))
  console.log(`[size-report] wrote ${relative(process.cwd(), out)}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
