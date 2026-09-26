import { describe, expect, it } from 'vitest'
import { QueryClient } from '@tanstack/solid-query'
import { segmentContentKey } from '@acorn/diff-document/document'
import type { CodeRow, DiffRow } from '../../kit/diff/diffModel'
import { createSegmentCache, dropSegmentCache, enrichmentWeight, plainWeight, residentKey, segmentCacheFor } from './segmentCache'

// The node's weighted segment cache on its own (./segmentCache.ts): what it keeps, what it lets go,
// and in which order. The pane wiring is covered in DiffPane.test.tsx.

const code = (raw: string): CodeRow => ({ kind: 'insert', path: 'a.ts', oldNo: null, newNo: 1, raw, toks: [{ content: raw, light: '', dark: '' }] })
const rows = (count: number, raw = 'x'): DiffRow[] => Array.from({ length: count }, () => code(raw))
const coloured = (plain: readonly DiffRow[]): DiffRow[] =>
  plain.map((row) => (row.kind === 'insert' ? { ...row, toks: [{ content: row.raw, light: '#111111', dark: '#eeeeee' }] } : row))
const put = (cache: ReturnType<typeof createSegmentCache>, key: string, plain: DiffRow[], path = 'a.ts', patchKey = 'p') =>
  cache.insert([{ key, path, patchKey, plain }])
const keys = (cache: ReturnType<typeof createSegmentCache>) => ['a', 'b', 'c', 'd', 'e'].filter((key) => cache.has(key))

describe('the weight estimator', () => {
  it('is deterministic and counts text, rows and colour apart', () => {
    const plain = rows(2, 'abcd')
    expect(plainWeight(plain)).toBe(plainWeight(rows(2, 'abcd')))
    expect(plainWeight(rows(2, 'abcdefgh'))).toBe(plainWeight(plain) + 2 * 4 * 2)
    expect(plainWeight(rows(3, 'abcd'))).toBeGreaterThan(plainWeight(plain))
    // Colour weighs its tokens, their colours and word spans; a plain row has none of it.
    const withWords = coloured(plain).map((row) => (row.kind === 'insert' ? { ...row, words: [{ content: 'ab', kind: 'add' as const }] } : row))
    expect(enrichmentWeight(withWords)).toBeGreaterThan(enrichmentWeight(coloured(plain)))
    expect(enrichmentWeight(coloured(plain))).toBeGreaterThan(0)
  })
})

describe('the segment cache', () => {
  const one = plainWeight(rows(10))

  it('evicts the least recently wanted first, and a touch makes a segment recent', () => {
    const cache = createSegmentCache({ rows: 30, bytes: 1e9 })
    put(cache, 'a', rows(10))
    put(cache, 'b', rows(10))
    put(cache, 'c', rows(10))
    cache.touch(['a'])
    put(cache, 'd', rows(10))
    expect(keys(cache)).toEqual(['a', 'c', 'd'])
    expect(cache.stats()).toMatchObject({ segments: 3, rows: 30, evictions: 1, inserts: 4 })
  })

  it('keeps both ceilings: rows evict under the byte ceiling, and bytes under the row ceiling', () => {
    const byRows = createSegmentCache({ rows: 25, bytes: 1e9 })
    put(byRows, 'a', rows(10))
    put(byRows, 'b', rows(10))
    put(byRows, 'c', rows(10))
    expect(keys(byRows)).toEqual(['b', 'c'])
    expect(byRows.stats().rows).toBeLessThanOrEqual(25)

    const byBytes = createSegmentCache({ rows: 1e9, bytes: one * 2 + 1 })
    put(byBytes, 'a', rows(10))
    put(byBytes, 'b', rows(10))
    put(byBytes, 'c', rows(10))
    expect(keys(byBytes)).toEqual(['b', 'c'])
    expect(byBytes.stats().plainBytes).toBeLessThanOrEqual(one * 2 + 1)
  })

  it('never evicts what a pane holds, and lets it go once released', () => {
    const cache = createSegmentCache({ rows: 20, bytes: 1e9 })
    const holder = cache.holder(() => {})
    put(cache, 'a', rows(10))
    holder.hold(new Set(['a']))
    put(cache, 'b', rows(10))
    put(cache, 'c', rows(10))
    expect(keys(cache)).toEqual(['a', 'c'])
    // Released: it is the oldest, and the next insert takes it.
    holder.release()
    put(cache, 'd', rows(10))
    expect(keys(cache)).toEqual(['c', 'd'])
  })

  it('keeps one held oversize segment as the only resident, and drops it when released', () => {
    const cache = createSegmentCache({ rows: 1e9, bytes: one * 3 })
    const holder = cache.holder(() => {})
    put(cache, 'a', rows(10))
    put(cache, 'b', rows(10))
    holder.hold(new Set(['e']))
    put(cache, 'e', rows(50))
    expect(keys(cache)).toEqual(['e'])
    expect(cache.peek('e')?.plain).toHaveLength(50)
    expect(cache.stats().oversize).toBe(1)
    holder.hold(new Set())
    expect(keys(cache)).toEqual([])
  })

  it('lets older colour go before the plain rows first paint needs', () => {
    const cache = createSegmentCache({ rows: 1e9, bytes: 1e9 })
    const a = rows(10, 'const value = 1')
    const b = rows(10, 'const value = 2')
    put(cache, 'a', a)
    put(cache, 'b', b)
    expect(cache.enrich('a', a, coloured(a))).toBe(true)
    const withColour = cache.stats().plainBytes + cache.stats().enrichmentBytes
    // Room for both segments' plain rows and one segment's colour, not two.
    const tight = createSegmentCache({ rows: 1e9, bytes: withColour + 10 })
    const changed: string[] = []
    const holder = tight.holder((key) => changed.push(key))
    put(tight, 'a', a)
    put(tight, 'b', b)
    tight.enrich('a', a, coloured(a))
    holder.hold(new Set(['b']))
    expect(tight.enrich('b', b, coloured(b))).toBe(true)
    // a's colour went; a's rows, and b's rows and colour, stayed.
    expect(keys(tight)).toEqual(['a', 'b'])
    expect(tight.peek('a')?.enriched).toBeNull()
    expect(tight.peek('b')?.enriched).not.toBeNull()
    expect(changed).toContain('a')
  })

  it('keeps the entry it holds when the same segment arrives twice', () => {
    const cache = createSegmentCache()
    const first = rows(3)
    put(cache, 'a', first)
    expect(cache.enrich('a', first, coloured(first))).toBe(true)
    put(cache, 'a', rows(3))
    expect(cache.peek('a')?.plain).toBe(first)
    expect(cache.peek('a')?.enriched).not.toBeNull()
  })

  it('refuses colour built from rows it no longer holds', () => {
    const cache = createSegmentCache()
    const first = rows(3)
    put(cache, 'a', first)
    cache.clear()
    put(cache, 'a', rows(3))
    expect(cache.enrich('a', first, coloured(first))).toBe(false)
    expect(cache.peek('a')?.enriched).toBeNull()
  })

  it('drops a superseded patch of one file only, unless another pane holds it', () => {
    const cache = createSegmentCache()
    const mine = cache.holder(() => {})
    const other = cache.holder(() => {})
    put(cache, 'a', rows(2), 'one.ts', 'old')
    put(cache, 'b', rows(2), 'one.ts', 'old')
    put(cache, 'c', rows(2), 'two.ts', 'old')
    put(cache, 'd', rows(2), 'one.ts', 'new')
    mine.hold(new Set(['a', 'b']))
    other.hold(new Set(['b']))
    mine.supersede('one.ts', 'old')
    expect(keys(cache)).toEqual(['b', 'c', 'd'])
  })

  it('keys rows by content, parser version, path and sha, and by nothing else', () => {
    const content = segmentContentKey('sha256:aa', 0)
    expect(content).toContain('v')
    expect(residentKey(content, 'a.ts', 'head')).toBe(residentKey(segmentContentKey('sha256:aa', 0), 'a.ts', 'head'))
    // The same head blob with another patch, or another segment of it, is another entry.
    expect(residentKey(segmentContentKey('sha256:bb', 0), 'a.ts', 'head')).not.toBe(residentKey(content, 'a.ts', 'head'))
    expect(residentKey(segmentContentKey('sha256:aa', 1), 'a.ts', 'head')).not.toBe(residentKey(content, 'a.ts', 'head'))
    // The same patch under another name or read through another sha is too.
    expect(residentKey(content, 'b.ts', 'head')).not.toBe(residentKey(content, 'a.ts', 'head'))
    expect(residentKey(content, 'a.ts', 'other')).not.toBe(residentKey(content, 'a.ts', 'head'))
  })

  it('is one per query client, and dropping one leaves the other', () => {
    const a = new QueryClient()
    const b = new QueryClient()
    const key = residentKey(segmentContentKey('sha256:aa', 0), 'a.ts', null)
    put(segmentCacheFor(a), key, rows(2))
    put(segmentCacheFor(b), key, rows(3))
    expect(segmentCacheFor(a)).toBe(segmentCacheFor(a))
    expect(segmentCacheFor(a).peek(key)?.plain).toHaveLength(2)
    expect(segmentCacheFor(b).peek(key)?.plain).toHaveLength(3)
    const dropped = segmentCacheFor(a)
    dropSegmentCache(a)
    expect(dropped.stats().segments).toBe(0)
    expect(segmentCacheFor(a).has(key)).toBe(false)
    expect(segmentCacheFor(b).has(key)).toBe(true)
  })
})
