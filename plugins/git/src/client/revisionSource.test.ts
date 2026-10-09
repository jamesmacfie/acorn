import { expect, it, vi } from 'vitest'
import { diffScopeKey } from '@acorn/plugin-api/ui/diff'
import type { RevisionDetail } from '../shared/api'

function pending<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

const segments = pending<never[]>()
const search = pending<{ matches: never[]; nextCursor: null }>()
const file = pending<{ text: string }>()
const reads = {
  segments: vi.fn(() => segments.promise), search: vi.fn(() => search.promise), file: vi.fn(() => file.promise),
}
vi.mock('./historyClient', () => ({ revisionApi: reads }))
const { revisionSource } = await import('./revisionSource')

it('discards delayed patch, search, and gap results after the revision target changes', async () => {
  const detail = { topology: { revision: 'same-object' } } as RevisionDetail
  const oldLifetime = new AbortController()
  const old = revisionSource({ nodeId: 'node-a', taskId: 'task-a', projectId: 'project', id: 'commit', base: null },
    detail, () => '', () => {}, oldLifetime.signal)
  const browse = revisionSource({ nodeId: 'node-a', projectId: 'project', id: 'commit', base: null },
    detail, () => '', () => {}, new AbortController().signal)
  expect(diffScopeKey(old.scope)).toMatch(/^task:task-a:/)
  expect(diffScopeKey(browse.scope)).toMatch(/^browse:/)
  expect(diffScopeKey(old.scope)).not.toBe(diffScopeKey(browse.scope))
  const segmentRead = old.loadSegments([], new AbortController().signal)
  const searchRead = old.search({ query: 'word', caseSensitive: false, cursor: null }, new AbortController().signal)
  const gapRead = old.fileText!({ path: 'file.txt', sha: 'blob' })
  oldLifetime.abort()
  segments.resolve([])
  search.resolve({ matches: [], nextCursor: null })
  file.resolve({ text: 'old text' })
  await expect(segmentRead).rejects.toMatchObject({ name: 'AbortError' })
  await expect(searchRead).rejects.toMatchObject({ name: 'AbortError' })
  await expect(gapRead).rejects.toMatchObject({ name: 'AbortError' })
  const callsAfterAbort = [reads.segments.mock.calls.length, reads.search.mock.calls.length, reads.file.mock.calls.length]
  await expect(old.loadSegments([], new AbortController().signal)).rejects.toMatchObject({ name: 'AbortError' })
  await expect(old.search({ query: 'word', caseSensitive: false, cursor: null }, new AbortController().signal)).rejects.toMatchObject({ name: 'AbortError' })
  await expect(old.fileText!({ path: 'file.txt', sha: 'blob' })).rejects.toMatchObject({ name: 'AbortError' })
  expect([reads.segments.mock.calls.length, reads.search.mock.calls.length, reads.file.mock.calls.length]).toEqual(callsAfterAbort)

  const selected = revisionSource({ nodeId: 'node-b', taskId: 'task-b', projectId: 'project', id: 'commit', base: null },
    detail, () => '', () => {}, new AbortController().signal)
  expect(selected.scope).not.toEqual(old.scope)
  expect(selected.signature()).not.toBe(old.signature())
  expect(selected.draftPrefix).not.toBe(old.draftPrefix)
  expect(reads.file).toHaveBeenCalledWith('project', 'commit', null, 'file.txt', 'blob', oldLifetime.signal, undefined)

  const nextCommit = revisionSource({ nodeId: 'node-b', taskId: 'task-b', projectId: 'project', id: 'next-commit', base: null },
    detail, () => '', () => {}, new AbortController().signal)
  expect(nextCommit.scope).not.toEqual(selected.scope)

  const lateSegment = pending<never[]>()
  const lateSearch = pending<{ matches: never[]; nextCursor: null }>()
  reads.segments.mockImplementationOnce(() => lateSegment.promise)
  reads.search.mockImplementationOnce(() => lateSearch.promise)
  const viewport = new AbortController()
  const segmentFromOldViewport = selected.loadSegments([], viewport.signal)
  const searchFromOldViewport = selected.search({ query: 'word', caseSensitive: false, cursor: null }, viewport.signal)
  viewport.abort()
  lateSegment.resolve([])
  lateSearch.resolve({ matches: [], nextCursor: null })
  await expect(segmentFromOldViewport).rejects.toMatchObject({ name: 'AbortError' })
  await expect(searchFromOldViewport).rejects.toMatchObject({ name: 'AbortError' })
})
