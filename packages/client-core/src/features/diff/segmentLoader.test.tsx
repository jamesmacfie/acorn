import { createRoot } from 'solid-js'
import { describe, expect, it } from 'vitest'
import { segmentContentKey, type DiffDocumentFile, type DiffSegmentPayload, type DiffSegmentRequest } from '@acorn/diff-document/document'
import type { SegmentRef } from './documentView'
import { createSegmentCache, residentKey } from './segmentCache'
import { createSegmentLoader } from './segmentLoader'

// The loader's claim on the node cache (./segmentLoader.ts): what it holds, and that every way a
// request or a pane ends lets go. The cache here has no room at all, so what stays resident is
// exactly what some pane holds.

const file: DiffDocumentFile = {
  path: 'a.ts', status: 'modified', additions: 1, deletions: 0, sha: 'head', viewed: false, patchKey: 'sha256:aa',
  segments: Array.from({ length: 4 }, () => ({ rows: 1, bands: 1, gaps: 0, columns: 1, lines: [0, 0, 1, 1] as [number, number, number, number] })),
}
const ref = (ordinal: number): SegmentRef => ({ file, ordinal, descriptor: file.segments[ordinal]!, contentKey: segmentContentKey(file.patchKey!, ordinal) })
const keyOf = (ordinal: number) => residentKey(ref(ordinal).contentKey, file.path, file.sha)
const answer = (requests: DiffSegmentRequest[]): DiffSegmentPayload[] =>
  requests.map((request) => ({ ...request, rows: [{ kind: 'insert', oldNo: null, newNo: 1, raw: `line ${request.ordinal}` }] }))
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

type Pending = { requests: DiffSegmentRequest[]; signal: AbortSignal; resolve: () => void; reject: () => void }

function setup() {
  const cache = createSegmentCache({ rows: 0, bytes: 0 })
  const pending: Pending[] = []
  const outcomes: string[] = []
  const { loader, dispose } = createRoot((dispose) => ({
    dispose,
    loader: createSegmentLoader({
      cache,
      load: (requests, signal) => new Promise<DiffSegmentPayload[]>((resolve, reject) => {
        pending.push({ requests, signal, resolve: () => resolve(answer(requests)), reject: () => reject(new Error('gone')) })
      }),
      enrich: async (rows) => [...rows],
      firstPlain: (outcome) => outcomes.push(outcome),
    }),
  }))
  return { cache, loader, pending, outcomes, dispose }
}

describe('the segment loader', () => {
  it('holds what is on screen and near, and lets go of what leaves the range', async () => {
    const { cache, loader, pending, outcomes } = setup()
    loader.demand([ref(0)], [ref(1)])
    pending[0]!.resolve()
    await flush()
    expect(cache.has(keyOf(0)) && cache.has(keyOf(1))).toBe(true)
    expect(loader.rows(ref(0))?.[0]).toMatchObject({ raw: 'line 0' })
    expect(outcomes).toEqual(['miss'])
    loader.demand([ref(1)], [])
    expect(cache.has(keyOf(0))).toBe(false)
    expect(cache.has(keyOf(1))).toBe(true)
  })

  it('lets a segment that left the range while loading go once its request ends', async () => {
    const { cache, loader, pending } = setup()
    loader.demand([ref(0)], [ref(1)])
    loader.demand([ref(0)], [])
    pending[0]!.resolve()
    await flush()
    expect(cache.has(keyOf(0))).toBe(true)
    expect(cache.has(keyOf(1))).toBe(false)
  })

  it('aborts a request the reader scrolled away from, and a failure holds nothing', async () => {
    const { cache, loader, pending } = setup()
    loader.demand([ref(0)], [])
    loader.demand([ref(2)], [])
    expect(pending[0]!.signal.aborted).toBe(true)
    pending[0]!.resolve()
    pending[1]!.reject()
    await flush()
    expect(cache.stats().segments).toBe(0)
    expect(loader.status(ref(2))).toBe('error')
    loader.retry(ref(2))
    pending[2]!.resolve()
    await flush()
    expect(cache.has(keyOf(2))).toBe(true)
  })

  it('keeps a new revision from publishing the old one, and holds what it showed until the next demand', async () => {
    const { cache, loader, pending } = setup()
    loader.demand([ref(0)], [])
    pending[0]!.resolve()
    await flush()
    loader.demand([ref(0)], [ref(1)])
    loader.reset()
    expect(pending[1]!.signal.aborted).toBe(true)
    pending[1]!.resolve()
    await flush()
    expect(cache.has(keyOf(0))).toBe(true)
    expect(cache.has(keyOf(1))).toBe(false)
    loader.demand([ref(3)], [])
    expect(cache.has(keyOf(0))).toBe(false)
  })

  it('lets go of everything on unmount and draws a later pane from the cache', async () => {
    const roomy = createSegmentCache()
    const load = (requests: DiffSegmentRequest[]) => Promise.resolve(answer(requests))
    const outcomes: string[] = []
    const make = () => createRoot((dispose) => ({ dispose, loader: createSegmentLoader({ cache: roomy, load, enrich: async (rows) => [...rows], firstPlain: (outcome) => outcomes.push(outcome) }) }))
    const first = make()
    first.loader.demand([ref(0)], [])
    await flush()
    first.loader.dispose()
    first.dispose()

    const second = make()
    // Drawn before any demand, which is the first frame of a remounted pane.
    expect(second.loader.rows(ref(0))?.[0]).toMatchObject({ raw: 'line 0' })
    second.loader.demand([ref(0)], [])
    expect(second.loader.stats()).toMatchObject({ hits: 1, misses: 0, queued: [] })
    expect(outcomes).toEqual(['miss', 'hit'])

    // With no pane holding anything, the smallest budget empties the cache.
    const tiny = setup()
    tiny.loader.demand([ref(0)], [])
    tiny.pending[0]!.resolve()
    await flush()
    expect(tiny.cache.stats().segments).toBe(1)
    tiny.loader.dispose()
    expect(tiny.cache.stats().segments).toBe(0)
  })
})
