import { afterEach, describe, expect, it, vi } from 'vitest'
import { closedPullsInfiniteOptions, compareOptions, fetchFilePatches, filePatchOptions, fileSummariesOptions, filesOptions, forceRefreshPull, meOptions, reposOptions } from './queries'

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

describe('client query options', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('passes TanStack query AbortSignal into regular reads', async () => {
    const fetchMock = vi.fn(async () => jsonResponse([]))
    vi.stubGlobal('fetch', fetchMock)
    const signal = new AbortController().signal

    await reposOptions(true).queryFn({ signal })

    expect(fetchMock).toHaveBeenCalledWith('/api/repos', { signal })
  })

  it('passes TanStack query AbortSignal into infinite reads', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ pulls: [], nextPage: null }))
    vi.stubGlobal('fetch', fetchMock)
    const signal = new AbortController().signal

    await closedPullsInfiniteOptions('acorn', 'web', true).queryFn({ pageParam: 3, signal })

    expect(fetchMock).toHaveBeenCalledWith('/api/repos/acorn/web/pulls?state=closed&page=3', { signal })
  })

  it('keeps the logged-out me query as null while still passing AbortSignal', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: 'unauthenticated' }, 401))
    vi.stubGlobal('fetch', fetchMock)
    const signal = new AbortController().signal

    await expect(meOptions().queryFn({ signal })).resolves.toBeNull()
    expect(fetchMock).toHaveBeenCalledWith('/api/me', { signal })
  })

  it('applies cancellation to heavy PR file and compare reads', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ aheadBy: 1, files: [], commits: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const signal = new AbortController().signal

    await compareOptions('acorn', 'web', 'main', 'feature', true).queryFn({ signal })
    await filesOptions('acorn', 'web', '42', true).queryFn({ signal })

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/repos/acorn/web/compare?base=main&head=feature', { signal })
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/repos/acorn/web/pulls/42/files', { signal })
  })

  it('force-refreshes PR detail and changed files together', async () => {
    const detail = { pull: null, labels: [], reviews: [], requestedReviewers: [], comments: [], commits: [], checks: [], threads: [] }
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(detail)).mockResolvedValueOnce(jsonResponse([]))
    vi.stubGlobal('fetch', fetchMock)

    await expect(forceRefreshPull('acorn', 'web', '42')).resolves.toEqual({ detail, files: [] })
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/repos/acorn/web/pulls/42?force=true', {})
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/repos/acorn/web/pulls/42/files?force=true', {})
  })

  it('fetches file summaries and a single patch through distinct cache entries', async () => {
    const patchFile = { path: 'src/app file.ts', status: 'modified', additions: 1, deletions: 0, sha: 'abc', viewed: false, patch: '@@' }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([{ ...patchFile, patch: null }]))
      .mockResolvedValueOnce(jsonResponse([patchFile]))
      .mockResolvedValueOnce(jsonResponse([patchFile]))
    vi.stubGlobal('fetch', fetchMock)
    const signal = new AbortController().signal

    await fileSummariesOptions('acorn', 'web', '42', true).queryFn({ signal })
    await expect(filePatchOptions('acorn', 'web', '42', 'src/app file.ts').queryFn({ signal })).resolves.toEqual(patchFile)
    await expect(fetchFilePatches('acorn', 'web', '42', ['src/app file.ts'], signal)).resolves.toEqual([patchFile])

    expect(fileSummariesOptions('acorn', 'web', '42', true).queryKey).toEqual(['files', 'acorn', 'web', '42', 'summary'])
    expect(filePatchOptions('acorn', 'web', '42', 'src/app file.ts').queryKey).toEqual(['files', 'acorn', 'web', '42', 'patch', 'src/app file.ts'])
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/repos/acorn/web/pulls/42/files?summary=1', { signal })
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/repos/acorn/web/pulls/42/files?path=src%2Fapp%20file.ts', { signal })
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/repos/acorn/web/pulls/42/files/patches', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paths: ['src/app file.ts'] }),
      signal,
    })
  })
})
