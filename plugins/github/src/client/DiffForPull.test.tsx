import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CodeRow, DiffSource } from '@acorn/plugin-api/ui/diff'
import { filePatchKey, fileSummariesKey, filesKey, type PullFile } from '../shared/api'
import { DiffForPull } from './DiffForPull'

const { openPane } = vi.hoisted(() => ({ openPane: vi.fn() }))
vi.mock('@acorn/plugin-api/client', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  openPane,
}))
vi.mock('@solidjs/router', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  useSearchParams: () => [{}],
}))

let source: DiffSource | undefined
vi.mock('@acorn/plugin-api/ui', () => ({
  DiffPane: (props: { source: DiffSource }) => {
    source = props.source
    return document.createElement('div')
  },
}))

const file: PullFile = {
  path: 'src/app.ts', status: 'modified', additions: 1, deletions: 0,
  sha: 'new-sha', viewed: false, patch: null,
}

describe('task pull diff', () => {
  afterEach(() => {
    source = undefined
    openPane.mockClear()
    vi.unstubAllGlobals()
  })

  it('opens a PR addition in the task editor and omits the action in repository browse', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const host = document.createElement('div')
    const route = { owner: 'acorn', repo: 'web', number: '42', key: 'acorn/web#42' }
    const added: CodeRow = { kind: 'insert', path: file.path, oldNo: null, newNo: 48, raw: 'new', toks: [] }
    const deleted: CodeRow = { ...added, kind: 'delete', oldNo: 47, newNo: null }
    const dispose = render(() => (
      <QueryClientProvider client={queryClient}>
        <DiffForPull route={route} router={false} taskId="task-1" />
      </QueryClientProvider>
    ), host)

    expect(source?.openLine).toBeTypeOf('function')
    source?.openLine?.(added)
    expect(openPane).toHaveBeenCalledExactlyOnceWith(
      'task-1', 'editor', { kind: 'editor:reveal', path: 'src/app.ts', line: 48 }, 'add',
    )
    source?.openLine?.(deleted)
    expect(openPane).toHaveBeenCalledTimes(1)
    dispose()

    const disposeBrowse = render(() => (
      <QueryClientProvider client={queryClient}>
        <DiffForPull route={route} router />
      </QueryClientProvider>
    ), host)
    expect(source?.openLine).toBeUndefined()
    disposeBrowse()
    queryClient.clear()
  })

  it('draws from warmed summaries and fetches only the missing patch', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
    queryClient.setQueryData(fileSummariesKey('acorn', 'web', '42'), [file])
    // A patch cached for an older head must not be drawn under the new summary.
    queryClient.setQueryData(filePatchKey('acorn', 'web', '42', file.path), { ...file, sha: 'old-sha', patch: '@@ old' })
    const fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify(
      url.endsWith('/files/patches') ? [{ ...file, patch: '@@ new' }] : [],
    ), { headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    const host = document.createElement('div')
    const dispose = render(() => (
      <QueryClientProvider client={queryClient}>
        <DiffForPull route={{ owner: 'acorn', repo: 'web', number: '42', key: 'acorn/web#42' }} router={false} taskId="task-1" />
      </QueryClientProvider>
    ), host)

    try {
      expect(source?.files()).toEqual([file])
      expect(source?.cachedFile(file.path)).toBeNull()
      expect(queryClient.getQueryData(filesKey('acorn', 'web', '42'))).toBeUndefined()

      const patched = await source?.fetchPatches?.([file.path], new AbortController().signal)
      expect(patched?.[0]?.patch).toBe('@@ new')
      expect(source?.cachedFile(file.path)?.patch).toBe('@@ new')
      expect(fetchMock).toHaveBeenCalledWith(
        '/v1/p/github/repos/acorn/web/pulls/42/files/patches',
        expect.objectContaining({ method: 'POST' }),
      )
      expect(fetchMock.mock.calls.some(([url]) => url === '/v2/p/github/repos/acorn/web/pulls/42/files')).toBe(false)
    } finally {
      dispose()
      queryClient.clear()
    }
  })
})
