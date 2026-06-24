import { afterEach, describe, expect, it, vi } from 'vitest'
import { closedPullsInfiniteOptions, compareOptions, filesOptions, meOptions, reposOptions } from './queries'

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
})
