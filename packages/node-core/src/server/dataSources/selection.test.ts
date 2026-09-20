import { afterEach, expect, it, vi } from 'vitest'
import { createDataSelectionPager } from './selection'
import type { DataSourcePage, DataSourceRequest } from '@acorn/protocol/dataSources.ts'

const request: Extract<DataSourceRequest, { operation: 'query' }> = { operation: 'query', query: { source: { pluginId: 'test', sourceId: 'items' }, scope: { parameters: {} }, sort: [] }, evaluationTime: 100, mode: 'execution', pageSize: 1 }
const selected: DataSourcePage = { records: [{ recordId: 'a', data: {} }, { recordId: 'b', data: {} }], revision: '1', readTime: 100, completeness: { kind: 'bounded' } }
afterEach(() => vi.useRealTimers())
it('binds retained pages to the owner, query and expiry while retaining final completeness', async () => {
  vi.useFakeTimers()
  const page = createDataSelectionPager(), read = vi.fn(async () => selected)
  const first = await page('owner', request, read)
  if (first.completeness.kind !== 'more') throw new Error('missing cursor')
  const next = { ...request, cursor: first.completeness.cursor }
  await expect(page('foreign', next, read)).rejects.toThrow('invalid_cursor')
  await expect(page('owner', { ...next, query: { ...next.query, scope: { connectionId: 'foreign', parameters: {} } } }, read)).rejects.toThrow('invalid_cursor')
  expect(await page('owner', next, read)).toMatchObject({ records: [{ recordId: 'b' }], completeness: { kind: 'bounded' } })
  expect(read).toHaveBeenCalledOnce()
  vi.advanceTimersByTime(60_001)
  await expect(page('owner', next, read)).rejects.toThrow('invalid_cursor')
})
it('returns honest incompleteness when retention slots are exhausted', async () => {
  const page = createDataSelectionPager()
  for (let i = 0; i < 16; i++) expect((await page('owner', { ...request, evaluationTime: i }, async () => selected)).completeness.kind).toBe('more')
  expect(await page('owner', request, async () => selected)).toMatchObject({ records: [], completeness: { kind: 'incomplete', cause: 'host-budget' } })
})
it('refuses retention above the shared byte budget', async () => {
  const page = createDataSelectionPager()
  const large = { ...selected, records: Array.from({ length: 100 }, (_, index) => ({ recordId: String(index), data: 'x'.repeat(180_000) })) }
  expect(await page('owner', request, async () => large)).toMatchObject({ records: [], completeness: { kind: 'incomplete', cause: 'host-budget' } })
})
