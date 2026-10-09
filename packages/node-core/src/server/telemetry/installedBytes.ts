import { lstat, readdir, readFile, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type { TelemetryAttrs } from '@acorn/protocol/telemetry.ts'
import { emitMetric, telemetryEnabled } from './collector'
import { createLogger, describeError } from './logger'

// The packaged app's bytes, reported once per launch as `app.bundle.bytes` and `app.startup.bytes`
// gauges (docs/telemetry/runtimes.md § Shipped bytes).
//
// Two sources, kept apart by their `method` label:
//
//   build  the numbers apps/desktop/scripts/size-report.mjs wrote into helper/size-report.json when
//          the app was built. Immutable, so they are read, never measured again.
//   walk   the component directories that report names, measured on this machine. That is what the
//          owner actually has on disk after an update, a partial install, or a development build.
//
// The walk stays inside the resource root, never follows a symlink, skips any data root and any
// repository, and stops at a file and depth limit. Final installer sizes are not here. CI reports
// them after packaging, and a release label is how the two are joined.

const log = createLogger('installed-bytes')

/** The shape size-report.mjs writes, as far as this module reads it. */
type SizeReport = {
  schema: 1
  release: string
  platform: string
  arch: string
  buildMode: string
  startup: { runtime: string; phase: string; bytes: number }[]
  components: { component: string; path: string | null; bytes: number }[]
  missing: string[]
}

export type InstalledBytesOptions = {
  /** The app's resource directory: the folder holding client, helper, plugins, and the rest. */
  resourceRoot: string
  release: string
  packaged: boolean
  /** The bundled Node executable. Counted as `native-runtime` when the app is packaged. */
  nativeRuntime?: string
  /** Directories never walked even if they sit under the resource root, such as the data root. */
  excludedRoots: readonly string[]
  limits?: { files: number; depth: number }
}

const DEFAULT_LIMITS = { files: 200_000, depth: 32 }

const inside = (root: string, path: string): boolean => {
  const rel = relative(root, path)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function readReport(raw: string): SizeReport | null {
  const report = JSON.parse(raw) as Partial<SizeReport>
  if (report.schema !== 1 || !Array.isArray(report.startup) || !Array.isArray(report.components) || !Array.isArray(report.missing)) return null
  return report as SizeReport
}

type Walk = { bytes: number; files: number; truncated: boolean }

/**
 * Bytes under one component. `seen` is shared across components so a hard-linked file counts once,
 * and `skip` holds the directories that belong to another component or to nobody.
 */
async function walkComponent(root: string, skip: readonly string[], seen: Set<string>, budget: { files: number; depth: number }): Promise<Walk> {
  const result: Walk = { bytes: 0, files: 0, truncated: false }
  const visit = async (dir: string, depth: number): Promise<void> => {
    if (depth > budget.depth) { result.truncated = true; return }
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (budget.files <= 0) { result.truncated = true; return }
      const path = join(dir, entry.name)
      if (entry.name === '.git' || skip.some((excluded) => inside(excluded, path))) continue
      // A symlink is never followed, so nothing outside the root can be read through one.
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) { await visit(path, depth + 1); continue }
      if (!entry.isFile() || entry.name === 'size-report.json' || entry.name.endsWith('.map')) continue
      const stats = await lstat(path)
      budget.files -= 1
      const key = `${stats.dev}:${stats.ino}`
      if (seen.has(key)) continue
      seen.add(key)
      result.bytes += stats.size
      result.files += 1
    }
  }
  await visit(root, 0)
  return result
}

/**
 * Read the build's numbers and measure the installed components, emitting a gauge for each. Returns
 * false when there is nothing to report: no build report, or telemetry off.
 */
export async function reportInstalledBytes(options: InstalledBytesOptions): Promise<boolean> {
  if (!telemetryEnabled()) return false
  const root = resolve(options.resourceRoot)
  let report: SizeReport | null
  try {
    report = readReport(await readFile(join(root, 'helper', 'size-report.json'), 'utf8'))
  } catch {
    // `pnpm dev` stages without writing the report. Nothing to label, so nothing to send.
    log.debug('no build size report to read')
    return false
  }
  if (!report) return false

  const installation = options.packaged ? 'packaged' : 'development'
  const gauge = (name: string, value: number, attrs: TelemetryAttrs) => emitMetric('core', {
    name,
    type: 'gauge',
    value,
    unit: 'byte',
    attrs: { release: options.release, installation, ...attrs },
  })

  const built = { platform: report.platform, arch: report.arch, 'build.mode': report.buildMode, method: 'build', complete: report.missing.length === 0 }
  for (const entry of report.startup) gauge('app.startup.bytes', entry.bytes, { ...built, 'startup.runtime': entry.runtime, phase: entry.phase })
  for (const entry of report.components) gauge('app.bundle.bytes', entry.bytes, { ...built, artifact: 'build', component: entry.component })

  const here = { platform: process.platform, arch: process.arch, method: 'walk', artifact: 'installed' }
  const owned = report.components.flatMap((entry) => {
    if (entry.path === null) return []
    const path = resolve(root, entry.path)
    return inside(root, path) ? [{ component: entry.component, path }] : []
  })
  const seen = new Set<string>()
  const budget = { ...(options.limits ?? DEFAULT_LIMITS) }
  const excluded = options.excludedRoots.map((path) => resolve(path))
  for (const { component, path } of owned) {
    // A component nested in this one is measured on its own, the way the build counted it.
    const skip = [...excluded, ...owned.map((other) => other.path).filter((other) => other !== path && inside(path, other))]
    let measured: Walk
    try {
      // The component itself must be a directory here, not a link to somewhere else.
      if (!(await lstat(path)).isDirectory()) throw Object.assign(new Error('not a directory'), { code: 'ENOENT' })
      measured = await walkComponent(path, skip, seen, budget)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') log.warn(`could not measure ${component}`, { 'error.name': describeError(error).name })
      gauge('app.bundle.bytes', 0, { ...here, component, complete: false })
      continue
    }
    gauge('app.bundle.bytes', measured.bytes, { ...here, component, complete: !measured.truncated })
  }
  if (options.packaged && options.nativeRuntime) {
    const runtime = await stat(options.nativeRuntime).catch(() => null)
    if (runtime) gauge('app.bundle.bytes', runtime.size, { ...here, method: 'stat', component: 'native-runtime', complete: true })
  }
  return true
}

/**
 * Report once, after startup has settled. The Node cannot see the window become usable, so it waits
 * a fixed minute instead, which keeps the walk off every launch's critical path. With telemetry off
 * it checks again every ten minutes until it has reported once. The timers never hold the process open.
 */
export function scheduleInstalledBytesReport(options: InstalledBytesOptions, delays = { first: 60_000, retry: 600_000 }): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  const attempt = () => {
    void reportInstalledBytes(options).catch((error: unknown) => {
      log.warn('installed bytes report failed', { 'error.name': describeError(error).name })
      return true
    }).then((done) => {
      if (done || stopped) return
      timer = setTimeout(attempt, delays.retry)
      timer.unref?.()
    })
  }
  timer = setTimeout(attempt, delays.first)
  timer.unref?.()
  return () => {
    stopped = true
    clearTimeout(timer)
  }
}
