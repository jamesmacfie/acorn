import { createEffect, createRoot } from 'solid-js'
import { existsSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import { expect, it, vi } from 'vitest'
const stream = vi.hoisted(() => ({ listeners: new Map<string, (event: any) => void>() }))
vi.mock('../../plugins/docker/src/client/wsChannel', () => ({ wsDockerAttach: (_kind: string, target: string, callback: (event: any) => void) => {
  stream.listeners.set(target, callback)
  return () => { stream.listeners.delete(target) }
} }))
import { dockerLogBuffer as before } from './evidence/unit19-dockerLogStore-before'
import { dockerLogBuffer as after } from '../../plugins/docker/src/client/dockerLogStore'
import { LogTail } from '../../plugins/docker/src/shared/logTail'
const tag = process.env.ACORN_PERF_TAG ?? 'sample'
const baseline = tag.includes('before')
const dockerLogBuffer = baseline ? before : after
const records: unknown[] = []

for (const consumer of [false, true]) it(`measures eight tails and 24,000 chunks, consumers=${consumer}`, () => {
  vi.useFakeTimers()
  const buffers = Array.from({ length: 8 }, (_, i) => dockerLogBuffer(`fixture-${consumer}-${i}`))
  const callbacks = [...stream.listeners.values()]
  callbacks.forEach(cb => cb({ kind: 'log', data: 'x'.repeat(524288) }))
  let projections = 0, dispose!: () => void
  if (consumer) createRoot(stop => { dispose = stop; for (const buffer of buffers) createEffect(() => { buffer.text(); projections++ }) })
  const cpu = process.cpuUsage(), start = performance.now()
  for (let batch = 0; batch < 100; batch++) {
    for (let chunk = 0; chunk < 30; chunk++) callbacks.forEach(cb => cb({ kind: 'log', data: 'synthetic output\n' }))
    vi.advanceTimersByTime(50)
  }
  const used = process.cpuUsage(cpu), elapsedMs = performance.now() - start
  const values = buffers.map(buffer => buffer.text())
  expect(values.every(value => value === ('x'.repeat(524288) + 'synthetic output\n'.repeat(3000)).slice(-524288))).toBe(true)
  if (consumer) expect(projections).toBe(baseline ? 24008 : 808)
  records.push({ consumer, buffers: 8, chunks: 24000, projections, retainedCharacters: values.reduce((n, value) => n + value.length, 0), cpuMs: (used.user + used.system) / 1000, elapsedMs })
  dispose?.()
  for (let i = 0; i < 8; i++) dockerLogBuffer(`cleanup-${consumer}-${i}`)
  vi.clearAllTimers(); vi.useRealTimers()
  const dest = join(dirname(fileURLToPath(import.meta.url)), `unit19-logs-${tag}.json`)
  if (records.length === 1 && baseline && existsSync(dest)) throw new Error('Baseline exists')
  writeFileSync(dest, JSON.stringify({ runtime: process.version, owner: baseline ? 'captured production before store' : 'production dockerLogStore', fixture: 'one Solid browser runtime, mocked stream, fake 50ms cadence; no DOM', records }, null, 2) + '\n')
})

it('measures bounded backing segments after a huge input and small appends', () => {
  const tail = new LogTail()
  tail.append('x'.repeat(4 * 1024 * 1024))
  for (let i = 0; i < 24000; i++) tail.append('x')
  const blocks = (tail as unknown as { chunks: string[] }).chunks
  expect(blocks.length).toBeLessThanOrEqual(129)
  expect(blocks.reduce((n, block) => n + block.length, 0)).toBeLessThanOrEqual(524288 + 4096)
  const dest = join(dirname(fileURLToPath(import.meta.url)), `unit19-segments-${tag}.json`)
  writeFileSync(dest, JSON.stringify({ segments: blocks.length, backingCharacters: blocks.reduce((n, block) => n + block.length, 0), retainedCharacters: tail.text().length }, null, 2) + '\n')
})
