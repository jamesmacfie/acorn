import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NodeFetchRequest, NodeFetchResponse } from '@acorn/protocol/broker.ts'
import type { PostedTelemetryBatch } from '@acorn/protocol/telemetry.ts'
import { emitEvent, flushTelemetry, onTelemetryBatch, setTelemetryPref, startTelemetry, telemetryEnabled } from '@acorn/node-core/server/telemetry'
import type { NodeBroker } from './broker/nodeBroker'
import { startHelperTelemetry, type HelperTelemetry } from './telemetry'

type HeldRequest = { node: string; request: NodeFetchRequest; batch?: PostedTelemetryBatch; answer(status: number, consent?: string): void }
let root: string
let helper: HelperTelemetry
let requests: HeldRequest[]
let aborts: string[]
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
const posts = () => requests.filter(row => row.batch)
const reads = () => requests.filter(row => !row.batch)
const eventNames = (rows = posts()) => rows.flatMap(row => row.batch?.records ?? []).flatMap(record => record.kind === 'event' ? [record.name] : [])

beforeEach(() => {
  vi.useFakeTimers()
  root = mkdtempSync(join(tmpdir(), 'acorn-telemetry-lifecycle-'))
  requests = []
  aborts = []
  startTelemetry({ node: 'test', version: '0' })
  const broker = {
    fetch: (node: string, request: NodeFetchRequest) => new Promise<NodeFetchResponse>(resolve => {
      requests.push({ node, request,
        ...(request.method === 'POST' ? { batch: JSON.parse(new TextDecoder().decode((request.body as { kind: 'bytes'; bytes: Uint8Array }).bytes)) as PostedTelemetryBatch } : {}),
        answer: (status, consent = '1') => resolve({ status, headers: {}, body: new TextEncoder().encode(JSON.stringify({ 'telemetry.enabled': consent })) }),
      })
    }),
    abort: (id: string) => { aborts.push(id) },
  } as unknown as NodeBroker
  helper = startHelperTelemetry({ broker, userDataDir: root, version: '0', platform: 'darwin', requestFootprint: vi.fn() })
})
afterEach(async () => {
  helper.dispose()
  await vi.advanceTimersByTimeAsync(5_000)
  for (const request of requests) request.answer(202)
  await settle()
  startTelemetry({ node: 'test', version: '0' })
  rmSync(root, { recursive: true, force: true })
  vi.useRealTimers()
})
const enable = async () => {
  helper.setNode('A')
  reads().at(-1)!.answer(200)
  await settle()
  flushTelemetry()
  for (const post of posts()) post.answer(202)
  await settle()
}

describe('helper preference ownership', () => {
  it('ignores the actual held preference result after repeated disposal', async () => {
    helper.setNode('A')
    const held = reads()[0]
    helper.dispose()
    helper.dispose()
    held.answer(200)
    await settle()
    helper.setNode('B')
    helper.footprint({ renderer: 12, helper: 12 })
    expect(telemetryEnabled()).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    expect(aborts).toEqual([held.request.requestId])
    expect(requests).toHaveLength(1)
  })

  it('joins overlapping polls and never applies A consent to B', async () => {
    helper.setNode('A')
    const tickSink = onTelemetryBatch(() => {}, 'other')
    await vi.advanceTimersByTimeAsync(5_000)
    tickSink.dispose()
    expect(reads()).toHaveLength(1)
    helper.setNode('B')
    expect(aborts).toEqual([reads()[0].request.requestId])
    reads()[0].answer(200)
    await settle()
    expect(telemetryEnabled()).toBe(false)
    reads()[1].answer(200, '0')
    await settle()
    expect(telemetryEnabled()).toBe(false)
    expect(posts()).toEqual([])
  })

  it('reads revoked remote consent before exporting the buffered tick window', async () => {
    await enable()
    emitEvent('core', 'before-revocation')
    const count = posts().length
    await vi.advanceTimersByTimeAsync(5_000)
    expect(posts()).toHaveLength(count)
    reads().at(-1)!.answer(200, '0')
    await settle()
    expect(telemetryEnabled()).toBe(false)
    expect(eventNames()).not.toContain('before-revocation')
  })

  it('allows a later B answer to stay enabled when the held A answer says off', async () => {
    helper.setNode('A')
    helper.setNode('B')
    reads()[1].answer(200)
    await settle()
    reads()[0].answer(200, '0')
    await settle()
    expect(telemetryEnabled()).toBe(true)
    expect(posts().every(row => row.node === 'B')).toBe(true)
  })

  it('does not remove another live collector sink on retirement', async () => {
    await enable()
    const rows: string[] = []
    const other = onTelemetryBatch(batch => rows.push(...batch.records.flatMap(record => record.kind === 'event' ? [record.name] : [])), 'other')
    try {
      helper.dispose()
      setTelemetryPref(true)
      emitEvent('core', 'other-live')
      flushTelemetry()
      expect(rows).toContain('other-live')
      expect(eventNames()).not.toContain('other-live')
      expect(telemetryEnabled()).toBe(true)
      const readCount = reads().length
      await vi.advanceTimersByTimeAsync(10_000)
      expect(reads()).toHaveLength(readCount)
      expect(telemetryEnabled()).toBe(true)
    } finally { other.dispose() }
  })
})

describe('helper post ownership', () => {
  it('discards a failed prior-consent post through revoke and re-enable', async () => {
    await enable()
    emitEvent('core', 'prior-consent')
    flushTelemetry()
    const old = posts().at(-1)!
    await vi.advanceTimersByTimeAsync(5_000)
    reads().at(-1)!.answer(200, '0')
    await settle()
    expect(aborts).toContain(old.request.requestId)
    old.answer(500)
    await settle()
    await vi.advanceTimersByTimeAsync(60_000)
    reads().at(-1)!.answer(200)
    await settle()
    const before = posts().length
    emitEvent('core', 'after-consent')
    flushTelemetry()
    await settle()
    expect(eventNames(posts().slice(before))).toContain('after-consent')
    expect(eventNames(posts().slice(before))).not.toContain('prior-consent')
  })

  it.each([202, 500])('settles an admitted post with status %i across shutdown without retrying it', async status => {
    await enable()
    emitEvent('core', 'admitted')
    flushTelemetry()
    const old = posts().at(-1)!
    emitEvent('core', 'final-window')
    helper.dispose()
    helper.dispose()
    old.answer(status)
    await settle()
    expect(eventNames().filter(name => name === 'admitted')).toHaveLength(1)
    expect(eventNames().filter(name => name === 'final-window')).toHaveLength(1)
    const final = posts().at(-1)!
    final.answer(500)
    await settle()
    const count = posts().length
    await vi.advanceTimersByTimeAsync(60_000)
    expect(posts()).toHaveLength(count)
    expect(telemetryEnabled()).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels a hung final post at the shutdown deadline using its request ID', async () => {
    await enable()
    emitEvent('core', 'admitted')
    flushTelemetry()
    const hung = posts().at(-1)!
    helper.dispose()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(aborts).toContain(hung.request.requestId)
    const count = posts().length
    hung.answer(500)
    await settle()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(posts()).toHaveLength(count)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['B', 'A'])('never sends remaining encoded batches to a replacement adoption of %s', async replacement => {
    await enable()
    const attrs = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`label${i}`, 'z'.repeat(500)]))
    for (let i = 0; i < 150; i++) emitEvent('core', `large-${i}`, attrs)
    flushTelemetry()
    const first = posts().at(-1)!
    expect(first.batch!.records.length).toBeLessThan(150)
    const before = posts().length
    helper.setNode(replacement)
    reads().at(-1)!.answer(200)
    first.answer(202)
    await settle()
    expect(eventNames(posts().slice(before))).not.toContain('large-149')
    expect(aborts).toContain(first.request.requestId)
  })

  it('retries only failed and unattempted encoded batches', async () => {
    await enable()
    const attrs = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`label${i}`, 'z'.repeat(500)]))
    for (let i = 0; i < 150; i++) emitEvent('core', `large-${i}`, attrs)
    flushTelemetry()
    const first = posts().at(-1)!
    first.answer(202)
    await settle()
    const failed = posts().at(-1)!
    expect(failed).not.toBe(first)
    failed.answer(500)
    await settle()
    const before = posts().length
    await vi.advanceTimersByTimeAsync(5_000)
    reads().at(-1)!.answer(200)
    await settle()
    for (let i = before; i < posts().length; i++) { posts()[i].answer(202); await settle() }
    const successful = [first, ...posts().slice(before)]
    const names = eventNames(successful).filter(name => name.startsWith('large-'))
    expect(names).toHaveLength(150)
    expect(new Set(names).size).toBe(150)
    expect(posts().slice(before).every(row => row.node === 'A')).toBe(true)
  })
})
