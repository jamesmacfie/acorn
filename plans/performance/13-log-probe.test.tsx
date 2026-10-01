import { existsSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import { expect, it, vi } from 'vitest'

const stream = vi.hoisted(() => ({ listeners: new Map<string, (event: { kind: string; data?: string }) => void>(), detached: 0 }))
vi.mock('../../plugins/docker/src/client/wsChannel', () => ({ wsDockerAttach: (_kind: string, target: string, cb: (event: { kind: string; data?: string }) => void) => {
  stream.listeners.set(target, cb)
  return () => { stream.listeners.delete(target); stream.detached++ }
} }))
import { dockerLogBuffer } from '../../plugins/docker/src/client/dockerLogStore'

it('measures hidden retained buffers during small output chunks', () => {
  const buffers = Array.from({ length: 8 }, (_, index) => dockerLogBuffer(`synthetic-${index}`))
  for (const cb of stream.listeners.values()) cb({ kind: 'log', data: 'x'.repeat(512 * 1024) })
  const chars = 'synthetic output\n'
  const cpu = process.cpuUsage()
  const started = performance.now()
  const chunksPerBuffer = 3000
  for (let index = 0; index < chunksPerBuffer; index++) {
    for (const cb of stream.listeners.values()) cb({ kind: 'log', data: chars })
  }
  const used = process.cpuUsage(cpu)
  const values = buffers.map(buffer => buffer.text())
  const output = {
    owner: 'actual dockerLogStore, mocked stream transport; no components mounted',
    buffers: buffers.length, chunksPerBuffer, totalChunks: buffers.length * chunksPerBuffer,
    prefilledCharacters: buffers.length * 512 * 1024,
    sourceBytes: Buffer.byteLength(chars) * buffers.length * chunksPerBuffer,
    retainedCharacters: values.reduce((sum, value) => sum + value.length, 0),
    elapsedMs: performance.now() - started, cpuMs: (used.user + used.system) / 1000,
    nominalWholeBufferConcatenationCharacters: buffers.length * chunksPerBuffer * (512 * 1024 + chars.length),
    note: 'Logical copied text calculation, not measured physical copied bytes; V8 may optimize ropes. CPU excludes DOM and native painting.',
  }
  const tag = process.env.ACORN_PERF_TAG ?? 'sample'
  const path = join(dirname(fileURLToPath(import.meta.url)), `13-logs-${tag}.json`)
  if (tag.startsWith('before') && existsSync(path)) throw new Error('Use another before tag.')
  writeFileSync(path, JSON.stringify(output, null, 2) + '\n')
  expect(values.every(value => value.length === 512 * 1024)).toBe(true)
  for (let index = 0; index < 8; index++) dockerLogBuffer(`cleanup-${index}`)
  expect(stream.detached).toBe(8)
})
