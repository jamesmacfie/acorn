import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { TelemetryBatch, TelemetryMetric } from '@acorn/protocol/telemetry.ts'
import { flushTelemetry, onTelemetryBatch, resetTelemetryForTest, startTelemetry } from './collector'
import { reportInstalledBytes, scheduleInstalledBytesReport } from './installedBytes'

let root: string
let batches: TelemetryBatch[]

const file = (path: string, bytes: number) => {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), 'x'.repeat(bytes))
}

const report = {
  schema: 1,
  release: '1.2.3',
  platform: 'darwin',
  arch: 'arm64',
  buildMode: 'production',
  startup: [
    { runtime: 'renderer', phase: 'startup', bytes: 800 },
    { runtime: 'renderer', phase: 'registration', bytes: 200 },
  ],
  components: [
    { component: 'renderer', path: 'client', bytes: 30 },
    { component: 'node-service', path: 'helper', bytes: 10 },
    { component: 'runtime-dependencies', path: 'helper/node_modules', bytes: 5 },
    { component: 'escaping', path: '../outside', bytes: 0 },
    { component: 'native-runtime', path: null, bytes: 99 },
  ],
  missing: [],
}

const gauges = (): TelemetryMetric[] => {
  flushTelemetry()
  return batches
    .flatMap((batch) => batch.records)
    .filter((record): record is TelemetryMetric => record.kind === 'metric' && record.name.startsWith('app.'))
}
const walked = (component: string) =>
  gauges().find((metric) => metric.attrs.method === 'walk' && metric.attrs.component === component)

const enable = async () => {
  startTelemetry({ node: 'node-1', version: '9', readPref: async () => '1' })
  onTelemetryBatch((batch) => void batches.push(batch))
  for (let index = 0; index < 5; index += 1) await Promise.resolve()
}

beforeEach(() => {
  resetTelemetryForTest()
  batches = []
  const scratch = mkdtempSync(join(tmpdir(), 'acorn-installed-bytes-'))
  root = join(scratch, 'Resources')
  file('helper/size-report.json', 10_000)
  writeFileSync(join(root, 'helper/size-report.json'), JSON.stringify(report))
  file('client/index.html', 30)
  file('client/index.js.map', 900)
  file('helper/service.js', 10)
  file('helper/node_modules/dep/index.js', 5)
  file('helper/.git/HEAD', 400)
  file('helper/data/agents.sqlite', 7_000)
  mkdirSync(join(scratch, 'outside'))
  writeFileSync(join(scratch, 'outside/secret'), 'x'.repeat(5_000))
  symlinkSync(join(scratch, 'outside'), join(root, 'client/escape'))
  file('node', 64)
})
afterEach(() => {
  resetTelemetryForTest()
  rmSync(dirname(root), { recursive: true, force: true })
  vi.useRealTimers()
})

const options = (overrides = {}) => ({
  resourceRoot: root,
  release: '1.2.3',
  packaged: true,
  nativeRuntime: join(root, 'node'),
  excludedRoots: [join(root, 'helper/data')],
  ...overrides,
})

it('sends the build numbers as they were written and measures each installed component once', async () => {
  await enable()
  expect(await reportInstalledBytes(options())).toBe(true)
  const all = gauges()
  expect(
    all
      .filter((metric) => metric.name === 'app.startup.bytes')
      .map((metric) => [metric.value, metric.attrs.phase, metric.attrs.method]),
  ).toEqual([
    [800, 'startup', 'build'],
    [200, 'registration', 'build'],
  ])
  for (const metric of all)
    expect(metric).toMatchObject({ type: 'gauge', unit: 'byte', attrs: { release: '1.2.3', installation: 'packaged' } })
  // The map, the symlink's target, the repository, and the data root are all left out.
  expect(walked('renderer')).toMatchObject({
    value: 30,
    attrs: { artifact: 'installed', complete: true, platform: process.platform },
  })
  // The nested component is measured on its own rather than inside the service.
  expect(walked('node-service')?.value).toBe(10)
  expect(walked('runtime-dependencies')?.value).toBe(5)
  // A component path that leaves the resource root is never walked.
  expect(walked('escaping')).toBeUndefined()
  expect(
    all.find((metric) => metric.attrs.component === 'native-runtime' && metric.attrs.method === 'stat')?.value,
  ).toBe(64)
})

it('labels a development build and a walk cut short by its limit', async () => {
  await enable()
  await reportInstalledBytes(options({ packaged: false, limits: { files: 1, depth: 32 } }))
  // One file fits the budget, so the renderer counts it and then reports that it stopped early.
  expect(walked('renderer')).toMatchObject({ value: 30, attrs: { installation: 'development', complete: false } })
  expect(walked('node-service')).toMatchObject({ value: 0, attrs: { complete: false } })
  // A development build's Node is the developer's own, so it is not counted as the app's.
  expect(gauges().some((metric) => metric.attrs.component === 'native-runtime' && metric.attrs.method === 'stat')).toBe(
    false,
  )
})

it('does nothing with telemetry off, and the schedule tries again later until it reports once', async () => {
  vi.useFakeTimers()
  expect(await reportInstalledBytes(options())).toBe(false)
  const stop = scheduleInstalledBytesReport(options(), { first: 10, retry: 100 })
  await vi.advanceTimersByTimeAsync(10)
  expect(gauges()).toEqual([])
  await enable()
  await vi.advanceTimersByTimeAsync(100)
  await vi.waitFor(() => expect(walked('renderer')).toBeDefined())
  const count = gauges().length
  await vi.advanceTimersByTimeAsync(1_000)
  expect(gauges()).toHaveLength(count)
  stop()
})
