import { afterEach, describe, expect, it, vi } from 'vitest'
import { closedPullsInfiniteOptions, compareOptions, fetchDiffSegments, fileSummariesOptions, forceRefreshPull, pullDiffOptions, reposOptions, searchDiff } from './queries'

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

// Moved here from @acorn/client-core/queries.test.ts with the factories it covers.
describe('github query options', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('passes TanStack query AbortSignal into regular reads', async () => {
    const fetchMock = vi.fn(async () => jsonResponse([]))
    vi.stubGlobal('fetch', fetchMock)
    const signal = new AbortController().signal

    await reposOptions(true).queryFn({ signal })

    expect(fetchMock).toHaveBeenCalledWith('/v1/p/github/repos', expect.objectContaining({ signal }))
  })

  it('passes TanStack query AbortSignal into infinite reads', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ pulls: [], nextPage: null }))
    vi.stubGlobal('fetch', fetchMock)
    const signal = new AbortController().signal

    await closedPullsInfiniteOptions('acorn', 'web', true).queryFn({ pageParam: 3, signal })

    expect(fetchMock).toHaveBeenCalledWith('/v1/p/github/repos/acorn/web/pulls?state=closed&page=3', expect.objectContaining({ signal }))
  })

  it('applies cancellation to heavy PR file and compare reads', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ aheadBy: 1, document: { files: [] }, completeness: { kind: 'complete' }, commits: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const signal = new AbortController().signal

    await compareOptions('acorn', 'web', 'main', 'feature', true).queryFn({ signal })
    await pullDiffOptions('acorn', 'web', '42', true).queryFn({ signal })

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/v1/p/github/repos/acorn/web/compare?base=main&head=feature', expect.objectContaining({ signal }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/v1/p/github/repos/acorn/web/pulls/42/diff', expect.objectContaining({ signal }))
  })

  it('force-refreshes PR detail and the diff document together', async () => {
    const detail = { pull: null, labels: [], reviews: [], requestedReviewers: [], comments: [], commits: [], checks: [], threads: [] }
    const diff = { document: { files: [] }, completeness: { kind: 'complete' } }
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(detail)).mockResolvedValueOnce(jsonResponse(diff))
    vi.stubGlobal('fetch', fetchMock)

    await expect(forceRefreshPull('acorn', 'web', '42')).resolves.toEqual({ detail, diff })
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/v1/p/github/repos/acorn/web/pulls/42?force=true', expect.anything())
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/v1/p/github/repos/acorn/web/pulls/42/diff?force=true', expect.anything())
  })

  it('reads summaries, and a document\'s segments and search pages from the repository routes', async () => {
    const complete = { kind: 'complete' }
    const patchKey = `sha256:${'a'.repeat(64)}`
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ files: [], completeness: complete }))
      .mockResolvedValueOnce(jsonResponse([{ path: 'src/app.ts', patchKey, ordinal: 0, rows: [] }]))
      .mockResolvedValueOnce(jsonResponse({ matches: [], nextCursor: null }))
    vi.stubGlobal('fetch', fetchMock)
    const signal = new AbortController().signal

    await fileSummariesOptions('acorn', 'web', '42', true).queryFn({ signal })
    await fetchDiffSegments('acorn', 'web', [{ path: 'src/app.ts', patchKey, ordinal: 0 }], signal)
    const document = {
      schemaVersion: 1, revision: 'r', totals: { files: 2, rows: 0, bands: 0, segments: 0, columns: 0 },
      files: [
        { path: 'src/app.ts', status: 'modified', additions: 1, deletions: 0, sha: null, viewed: false, patchKey, segments: [] },
        { path: 'logo.png', status: 'modified', additions: null, deletions: null, sha: null, viewed: false, patchKey: null, segments: [] },
      ],
    }
    await searchDiff('acorn', 'web', document, { query: 'needle', caseSensitive: false, cursor: null }, signal)

    expect(fileSummariesOptions('acorn', 'web', '42', true).queryKey).toEqual(['files', 'acorn', 'web', '42', 'summary', 'v2'])
    expect(pullDiffOptions('acorn', 'web', '42', true).queryKey).toEqual(['files', 'acorn', 'web', '42', 'diff'])
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/v1/p/github/repos/acorn/web/pulls/42/files?summary=1', expect.objectContaining({ signal }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/v1/p/github/repos/acorn/web/diff/segments', expect.objectContaining({ method: 'POST', signal }))
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/v1/p/github/repos/acorn/web/diff/search', expect.objectContaining({ method: 'POST', signal }))
    const body = (call: number) => JSON.parse(new TextDecoder().decode(fetchMock.mock.calls[call][1].body as Uint8Array))
    expect(body(1)).toEqual({ requests: [{ path: 'src/app.ts', patchKey, ordinal: 0 }] })
    // Only files with a patch are searched; the query rides in the body, never the URL.
    expect(body(2)).toEqual({ query: 'needle', caseSensitive: false, cursor: null, files: [{ path: 'src/app.ts', patchKey }] })
  })
})
