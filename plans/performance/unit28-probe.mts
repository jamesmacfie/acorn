import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import * as node from '../../packages/node-core/src/server/telemetry/collector.ts'
import * as client from '../../packages/client-core/src/infra/telemetry/emitter.ts'
const tag = process.env.ACORN_PERF_TAG ?? 'sample'
const output = `plans/performance/unit28-${tag}.json`
if (existsSync(output)) throw new Error('Evidence already exists')
const files = ['packages/custody/src/telemetry.ts', 'packages/node-core/src/server/telemetry/collector.ts', 'packages/client-core/src/infra/telemetry/emitter.ts', 'plans/performance/unit28-probe.mts']
const cpu = (run: () => void) => { const start = performance.now(); const from = process.cpuUsage(); run(); const cost = process.cpuUsage(from); return { cpuMs: (cost.user + cost.system) / 1000, wallMs: performance.now() - start } }
const result: Record<string, unknown> = { fixture: 'Production emitters, synthetic sinks/posters in one Node isolate; no network, UI, or private records', node: process.version, hashes: Object.fromEntries(files.map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')])) }
for (const kind of ['node', 'client'] as const) {
  let rows: any[] = []
  const emitter = kind === 'node' ? node : client
  if (kind === 'node') { node.resetTelemetryForTest(); node.onTelemetryBatch(batch => rows.push(...batch.records)); node.setTelemetryPref(true) }
  else { client._resetClientTelemetry(); client.startClientTelemetry({ runtime: 'tui', post: async records => { rows.push(...records) } }); client.setTelemetryEnabled(true) }
  result[`${kind}Stable100k`] = cpu(() => { for (let i = 0; i < 100_000; i++) emitter.measure('synthetic', 'stable', () => 1) })
  await emitter.flushTelemetry()
  result[`${kind}StableCount`] = rows.find(row => row.name === 'stable')?.value.count
  rows = []
  for (let i = 0; i < 1000; i++) emitter.recordDuration('synthetic', `operation-${i}`, 1)
  await emitter.flushTelemetry()
  result[`${kind}Distinct`] = { histograms: rows.filter(row => row.type === 'histogram').length, refused: rows.find(row => row.name === 'telemetry.histogram.refused')?.value ?? 0 }
  rows = []
  for (const attrs of [{ label: 1 }, { label: '1' }, { 'a=b': 'c' }, { a: 'b=c' }]) emitter.recordDuration('synthetic', 'collision', 1, attrs)
  await emitter.flushTelemetry()
  result[`${kind}CollisionSeries`] = rows.filter(row => row.type === 'histogram').length
  if (kind === 'node') node.resetTelemetryForTest(); else client._resetClientTelemetry()
}
writeFileSync(output, JSON.stringify(result, null, 2) + '\n')
