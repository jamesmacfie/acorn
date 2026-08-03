import { QueryClient } from '@tanstack/solid-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fileSummariesKey, filesKey, pullKey } from '@acorn/protocol/api.ts'
import { INITIAL_PREFETCH_LIMIT, prefetchOpenPulls, prefetchPullSummary } from './prefetch'

// Bodies cross the transport as bytes now, so assert the decoded payload rather than a JSON string.
const batchBodyOf = (mock: { mock: { calls: unknown[][] } }, call: number): unknown =>
  JSON.parse(new TextDecoder().decode((mock.mock.calls[call][1] as { body: Uint8Array }).body))

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

const detail = {
  pull: {
    number: 42,
    title: 'Speed pass',
    body: null,
    state: 'open',
    draft: false,
    author: 'james',
    headSha: 'head-sha',
    headRef: 'speed',
    baseRef: 'main',
    updatedAt: 1,
  },
  labels: [],
  reviews: [],
  requestedReviewers: [],
  comments: [],
  commits: [],
  checks: [],
  threads: [],
}

const files = [
  {
    path: 'src/app.ts',
    status: 'modified',
    additions: 10,
    deletions: 2,
    sha: 'sha-app',
    viewed: false,
    patch: null,
  },
]

describe('open PR warmup', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('warms PR detail and file summaries without seeding full patch payloads', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([{ number: 42, title: 'Speed pass', state: 'open', draft: false, author: 'james', headRef: 'speed', baseRef: 'main', updatedAt: 1 }]))
      .mockResolvedValueOnce(jsonResponse([{ number: 42, detail, files }]))
    vi.stubGlobal('fetch', fetchMock)

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const signal = new AbortController().signal

    await prefetchOpenPulls(queryClient, 'acorn', 'web', signal)

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/repos/acorn/web/pulls?state=open', expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/repos/acorn/web/pulls/batch', expect.objectContaining({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal,
    }))
    expect(batchBodyOf(fetchMock, 1)).toEqual({ numbers: [42], files: 'summary' })
    expect(queryClient.getQueryData(pullKey('acorn', 'web', '42'))).toEqual(detail)
    expect(queryClient.getQueryData(fileSummariesKey('acorn', 'web', '42'))).toEqual(files)
    expect(queryClient.getQueryData(filesKey('acorn', 'web', '42'))).toBeUndefined()
  })

  it('prefetches one hovered PR through the same summary-only batch path', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse([{ number: 42, detail, files }]))
    vi.stubGlobal('fetch', fetchMock)

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const signal = new AbortController().signal

    await prefetchPullSummary(queryClient, 'acorn', 'web', 42, signal)

    expect(fetchMock).toHaveBeenCalledWith('/api/repos/acorn/web/pulls/batch', expect.objectContaining({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal,
    }))
    expect(batchBodyOf(fetchMock, 0)).toEqual({ numbers: [42], files: 'summary' })
    expect(queryClient.getQueryData(pullKey('acorn', 'web', '42'))).toEqual(detail)
    expect(queryClient.getQueryData(fileSummariesKey('acorn', 'web', '42'))).toEqual(files)
    expect(queryClient.getQueryData(filesKey('acorn', 'web', '42'))).toBeUndefined()
  })

  it('bounds automatic warm-up and leaves the remaining PRs intent-driven', async () => {
    const pulls = Array.from({ length: INITIAL_PREFETCH_LIMIT + 3 }, (_, index) => ({
      number: index + 1,
      title: `PR ${index + 1}`,
      state: 'open',
      draft: false,
      author: 'james',
      headRef: `branch-${index + 1}`,
      baseRef: 'main',
      updatedAt: index + 1,
    }))
    const warmed = pulls.slice(0, INITIAL_PREFETCH_LIMIT).map((pull) => ({
      number: pull.number,
      detail: { ...detail, pull: { ...detail.pull, number: pull.number } },
      files,
    }))
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(pulls))
      .mockResolvedValueOnce(jsonResponse(warmed))
    vi.stubGlobal('fetch', fetchMock)

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    await prefetchOpenPulls(queryClient, 'acorn', 'web', new AbortController().signal)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(batchBodyOf(fetchMock, 1)).toEqual({
      numbers: [1, 2, 3, 4, 5],
      files: 'summary',
    })
    expect(queryClient.getQueryData(pullKey('acorn', 'web', String(INITIAL_PREFETCH_LIMIT + 1)))).toBeUndefined()
  })

  it('does not refetch a hovered PR when detail and summaries are already cached', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(pullKey('acorn', 'web', '42'), detail)
    queryClient.setQueryData(fileSummariesKey('acorn', 'web', '42'), files)

    await prefetchPullSummary(queryClient, 'acorn', 'web', 42, new AbortController().signal)

    expect(fetchMock).not.toHaveBeenCalled()
  })
})
