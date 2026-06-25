import { QueryClient } from '@tanstack/solid-query'
import { createRoot } from 'solid-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PullFile } from '../../queries'
import { createDiffHydrator } from './hydration'
import type { ParsedFile, TokenizeLine } from './model'

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

const pullFile = (path: string, patch: string | null): PullFile => ({
  path,
  status: 'modified',
  additions: 1,
  deletions: 1,
  sha: `sha-${path}`,
  viewed: false,
  patch,
})

const plain: TokenizeLine = (_path, content) => [{ content, light: '', dark: '' }]

const waitFor = async (assertion: () => void) => {
  let last: unknown
  for (let i = 0; i < 20; i++) {
    try {
      assertion()
      return
    } catch (error) {
      last = error
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
  }
  throw last
}

describe('diff hydrator', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('automatically batch-fetches patches and parses the prioritized file first', async () => {
    const fileA = pullFile('src/a.ts', '@@ a')
    const fileB = pullFile('src/b.ts', '@@ b')
    const fetchMock = vi.fn(async () => jsonResponse([fileA, fileB]))
    vi.stubGlobal('fetch', fetchMock)

    const queryClient = new QueryClient()
    const parsed: ParsedFile[] = []
    let disposeRoot!: () => void
    const hydrator = createRoot((dispose) => {
      disposeRoot = dispose
      return createDiffHydrator({
        owner: 'acorn',
        repo: 'web',
        number: '42',
        queryClient,
        tokenizerForFile: async () => plain,
        parseFile: (file) => ({ file, diff: [] }),
        onParsed: (file) => parsed.push(file),
      })
    })

    try {
      hydrator.reset([pullFile('src/a.ts', null), pullFile('src/b.ts', null)], 'src/b.ts')

      await waitFor(() => {
        expect(parsed.map((file) => file.file.path)).toEqual(['src/b.ts', 'src/a.ts'])
      })
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock).toHaveBeenCalledWith('/api/repos/acorn/web/pulls/42/files/patches', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ paths: ['src/b.ts', 'src/a.ts'] }),
        signal: expect.any(AbortSignal),
      })
      expect(hydrator.status('src/a.ts')).toBe('loaded')
      expect(hydrator.status('src/b.ts')).toBe('loaded')
    } finally {
      hydrator.dispose()
      disposeRoot()
    }
  })
})
