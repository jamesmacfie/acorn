import { expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startHelperTelemetry } from '../../packages/custody/src/telemetry'
import { resetTelemetryForTest, telemetrySummary } from '../../packages/node-core/src/server/telemetry/collector'
const delay = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
it('records a pending preference read rearming the collector after helper disposal', async () => {
  const tag = process.env.ACORN_PERF_TAG ?? 'sample'; const output = `plans/performance/16-helper-telemetry-${tag}.json`
  if (tag.startsWith('before') && existsSync(output)) throw new Error('Before exists')
  resetTelemetryForTest(); const dir = mkdtempSync(join(tmpdir(), 'acorn-perf-telemetry-')); let release: any; let reads = 0; let posts = 0
  const helper = startHelperTelemetry({ userDataDir: dir, version: 'synthetic', broker: { fetch: async (_node: string, request: any) => { if (request.method === 'POST') { posts++; return { status: 202, headers: {}, body: new Uint8Array() } } reads++; return new Promise((resolve) => { release = () => resolve({ status: 200, headers: {}, body: new TextEncoder().encode('{"telemetry.enabled":"1"}') }) }) } } as any })
  helper.setNode('node-a'); await delay(); helper.dispose(); const before = telemetrySummary(); release(); for (let i = 0; i < 4; i++) await delay(); const after = telemetrySummary()
  expect(after.collecting).toBe(true)
  writeFileSync(output, JSON.stringify({ fixture: 'Actual startHelperTelemetry and collector, held synthetic preference GET; no real Node, no private crash file', reads, posts, summaryImmediatelyAfterDispose: before, summaryAfterLatePreferenceRead: after }, null, 2) + '\n')
  resetTelemetryForTest(); rmSync(dir, { recursive: true, force: true })
})
