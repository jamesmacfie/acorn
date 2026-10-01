import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/solid-query'
import type { TelemetryRecord } from '@acorn/protocol/telemetry.ts'
import { segmentCaches } from '../../features/diff/segmentCaches'
import type { SegmentCache } from '../../features/diff/segmentCache'
import { _resetClientTelemetry, flushTelemetry, setTelemetryEnabled, startClientTelemetry } from './emitter'
import { _resetPageFacts, PAGE_FACTS_MS, registerPageFact, startPageFacts } from './pageFacts'

// The page counts beside the renderer's memory (docs/telemetry.md § Diagnosing an unresponsive view).

let posted: TelemetryRecord[]
let stop: (() => void) | undefined
let visibility: DocumentVisibilityState
const client = new QueryClient()

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  posted = []
  visibility = 'visible'
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
  startClientTelemetry({ runtime: 'renderer', post: async (records) => void posted.push(...records) })
  document.body.innerHTML = '<ol><li class="ui-timeline-turn"></li><li class="ui-timeline-turn"></li></ol>'
  client.getQueryCache().clear()
  client.setQueryData(['one'], 1)
  client.setQueryData(['two'], 2)
})

afterEach(() => {
  stop?.()
  stop = undefined
  _resetPageFacts()
  _resetClientTelemetry()
  segmentCaches.delete(client)
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  vi.useRealTimers()
})

const gauges = async (): Promise<Record<string, number>> => {
  await flushTelemetry()
  return Object.fromEntries(posted.flatMap((record) =>
    record.kind === 'metric' && record.type === 'gauge' && typeof record.value === 'number' ? [[record.name, record.value]] : []))
}

it('counts the page every thirty seconds, and not before', async () => {
  setTelemetryEnabled(true)
  registerPageFact('ui.page.workers.tree', () => 3)
  stop = startPageFacts(() => client)
  vi.advanceTimersByTime(PAGE_FACTS_MS - 1)
  expect(await gauges()).toEqual({})

  vi.advanceTimersByTime(1)
  const counted = await gauges()
  expect(counted).toMatchObject({ 'ui.page.timeline_turns': 2, 'ui.page.query_entries': 2, 'ui.page.workers.tree': 3 })
  expect(counted['ui.page.elements']).toBe(document.getElementsByTagName('*').length)
  // No diff has been opened on this client, so there is no cache to describe.
  expect(counted).not.toHaveProperty('ui.page.diff_cache.rows')
})

it("reports the active client's diff cache in rows and bytes", async () => {
  setTelemetryEnabled(true)
  segmentCaches.set(client, { stats: () => ({ rows: 120, plainBytes: 4_000, enrichmentBytes: 1_000 }) } as unknown as SegmentCache)
  stop = startPageFacts(() => client)
  vi.advanceTimersByTime(PAGE_FACTS_MS)
  expect(await gauges()).toMatchObject({ 'ui.page.diff_cache.rows': 120, 'ui.page.diff_cache.bytes': 5_000 })
  expect(posted.find((record) => record.kind === 'metric' && record.name === 'ui.page.diff_cache.bytes')).toMatchObject({ unit: 'byte' })
})

it('counts nothing while the window is hidden, and nothing while collection is off', async () => {
  const read = vi.fn(() => 1)
  registerPageFact('ui.page.workers.highlight', read)
  stop = startPageFacts(() => client)

  setTelemetryEnabled(true)
  visibility = 'hidden'
  vi.advanceTimersByTime(PAGE_FACTS_MS * 3)
  expect(await gauges()).toEqual({})

  setTelemetryEnabled(false)
  visibility = 'visible'
  vi.advanceTimersByTime(PAGE_FACTS_MS * 3)
  expect(read).not.toHaveBeenCalled()
  expect(posted).toEqual([])
})

it('a reader that throws costs only its own count', async () => {
  setTelemetryEnabled(true)
  registerPageFact('ui.page.workers.highlight', () => {
    throw new Error('gone')
  })
  registerPageFact('ui.page.workers.word_diff', () => 1)
  stop = startPageFacts(() => client)
  vi.advanceTimersByTime(PAGE_FACTS_MS)
  const counted = await gauges()
  expect(counted).toMatchObject({ 'ui.page.workers.word_diff': 1 })
  expect(counted).not.toHaveProperty('ui.page.workers.highlight')
})
