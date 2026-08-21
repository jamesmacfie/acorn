import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeTestDb, type TestDb } from '../../testkit/db'
import {
  appendSample,
  compactHistory,
  DAY_MS,
  HOUR_MS,
  HOURLY_RETENTION_MS,
  hourBucket,
  readSeries,
} from './history'

// The store's own arithmetic, against a fake clock. Nothing here samples anything: the pass that
// produces values is sampler.test.ts. These are the retention and invalidation rules on their own,
// which is where getting them wrong silently loses a fortnight of someone's history.

let test: TestDb
beforeEach(async () => (test = await makeTestDb()))
afterEach(() => test.cleanup())

const NOW = 1_800_000_000_000
const write = (panelId: string, bucket: number, value: number, signature = 'sig') =>
  appendSample(test.db, { panelId, signature, bucket, value, recordedAt: bucket })

describe('buckets', () => {
  it('floors to the UTC hour', () => {
    expect(hourBucket(NOW)).toBe(Math.floor(NOW / HOUR_MS) * HOUR_MS)
    expect(hourBucket(hourBucket(NOW) + HOUR_MS - 1)).toBe(hourBucket(NOW))
  })
})

describe('appending', () => {
  it('serves an empty series rather than failing, because absence is data', async () => {
    expect(await readSeries(test.db, 'never-sampled')).toEqual({ signature: '', samples: [] })
  })

  it('keeps one sample per bucket, and a later look wins', async () => {
    const bucket = hourBucket(NOW)
    await write('p1', bucket, 6)
    await write('p1', bucket, 7)
    expect(await readSeries(test.db, 'p1')).toEqual({ signature: 'sig', samples: [{ bucket, value: 7 }] })
  })

  it('returns samples ascending, and honours `since`', async () => {
    const base = hourBucket(NOW)
    await write('p1', base - 2 * HOUR_MS, 1)
    await write('p1', base - HOUR_MS, 2)
    await write('p1', base, 3)
    expect((await readSeries(test.db, 'p1')).samples.map((s) => s.value)).toEqual([1, 2, 3])
    expect((await readSeries(test.db, 'p1', base - HOUR_MS)).samples.map((s) => s.value)).toEqual([2, 3])
  })

  it('resets the whole series when the panel means something else now', async () => {
    const base = hourBucket(NOW)
    await write('p1', base - HOUR_MS, 1, 'before')
    await write('p1', base, 2, 'before')
    const { reset } = await appendSample(test.db, {
      panelId: 'p1', signature: 'after', bucket: base + HOUR_MS, value: 9, recordedAt: base + HOUR_MS,
    })
    expect(reset).toBe(true)
    // The old series is gone rather than left beside the new one: a filter added yesterday makes
    // last week's samples a lie, and a visibly restarting trend is the honest rendering of that.
    expect(await readSeries(test.db, 'p1')).toEqual({ signature: 'after', samples: [{ bucket: base + HOUR_MS, value: 9 }] })
  })

  it('leaves other panels alone when one resets', async () => {
    const base = hourBucket(NOW)
    await write('p1', base, 1, 'a')
    await write('p2', base, 2, 'a')
    await write('p1', base + HOUR_MS, 3, 'b')
    expect((await readSeries(test.db, 'p2')).samples).toHaveLength(1)
  })
})

describe('compaction', () => {
  it('collapses old hourly samples to the last value of each UTC day', async () => {
    const old = hourBucket(NOW) - HOURLY_RETENTION_MS - 5 * DAY_MS
    const day = Math.floor(old / DAY_MS) * DAY_MS
    await write('p1', day + 1 * HOUR_MS, 10)
    await write('p1', day + 9 * HOUR_MS, 20)
    await write('p1', day + 23 * HOUR_MS, 30)
    // And one inside the hourly window, which must survive untouched.
    const recent = hourBucket(NOW) - HOUR_MS
    await write('p1', recent, 99)

    const result = await compactHistory(test.db, NOW, null)
    expect(result.collapsed).toBe(2)
    const samples = (await readSeries(test.db, 'p1')).samples
    // The day's last value, not an average (docs/dashboards.md § Sampling and retention).
    expect(samples).toEqual([{ bucket: day + 23 * HOUR_MS, value: 30 }, { bucket: recent, value: 99 }])
  })

  it('drops daily samples past the long window', async () => {
    await write('p1', hourBucket(NOW) - 500 * DAY_MS, 1)
    await write('p1', hourBucket(NOW), 2)
    const result = await compactHistory(test.db, NOW, null)
    expect(result.dropped).toBeGreaterThanOrEqual(1)
    expect((await readSeries(test.db, 'p1')).samples.map((s) => s.value)).toEqual([2])
  })

  it('removes a series whose panel is gone, and keeps one that is merely unplaced', async () => {
    await write('deleted-panel', hourBucket(NOW), 1)
    await write('unplaced-but-defined', hourBucket(NOW), 2)
    // The live set is what the prefs blob defines, not what is placed (docs/dashboards.md § Sampling
    // and retention).
    const result = await compactHistory(test.db, NOW, new Set(['unplaced-but-defined']))
    expect(result.orphaned).toBe(1)
    expect((await readSeries(test.db, 'deleted-panel')).samples).toEqual([])
    expect((await readSeries(test.db, 'unplaced-but-defined')).samples).toHaveLength(1)
  })

  it('skips the orphan sweep entirely when the blob could not be read', async () => {
    await write('p1', hourBucket(NOW), 1)
    // `null` means "unknown", not "none" (docs/dashboards.md § Sampling and retention).
    const result = await compactHistory(test.db, NOW, null)
    expect(result.orphaned).toBe(0)
    expect((await readSeries(test.db, 'p1')).samples).toHaveLength(1)
  })
})
