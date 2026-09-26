import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CodeRow, DiffSource } from '@acorn/plugin-api/ui/diff'
import { filePatchKey, fileSummariesKey, filesKey, type PullFile, type PullFilesResponse } from '../shared/api'
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
  Alert: (props: { children: string }) => {
    const element = document.createElement('p')
    element.textContent = props.children
    return element
  },
}))

const file: PullFile = {
  path: 'src/app.ts', status: 'modified', additions: 1, deletions: 0,
  sha: 'new-sha', viewed: false, position: 0, patchState: 'available', patchKey: 'sha256:new', patch: null,
}
const summaries = (files: PullFile[], completeness: PullFilesResponse['completeness'] = { kind: 'complete' }): PullFilesResponse =>
  ({ files, completeness })

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
    queryClient.setQueryData(fileSummariesKey('acorn', 'web', '42'), summaries([file]))
    // A patch cached for different patch content must not be drawn under the new summary, even with
    // the same head blob: the base moved.
    queryClient.setQueryData(filePatchKey('acorn', 'web', '42', file.path), { ...file, patchKey: 'sha256:old', patch: '@@ old' })
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

  it('resolves a file GitHub sent no patch for without fetching it', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
    const binary: PullFile = { ...file, path: 'logo.png', patchState: 'unavailable', patchKey: null }
    queryClient.setQueryData(fileSummariesKey('acorn', 'web', '42'), summaries([file, binary]))
    const host = document.createElement('div')
    const dispose = render(() => (
      <QueryClientProvider client={queryClient}>
        <DiffForPull route={{ owner: 'acorn', repo: 'web', number: '42', key: 'acorn/web#42' }} router={false} />
      </QueryClientProvider>
    ), host)
    expect(source?.cachedFile(binary.path)).toEqual(binary)
    // An available patch with no body in hand is content still to fetch, not a file without a diff.
    expect(source?.cachedFile(file.path)).toBeNull()
    dispose()
    queryClient.clear()
  })

  it('says when GitHub capped the file list, with and without its count', () => {
    const cases: [PullFilesResponse['completeness'], string | null][] = [
      [{ kind: 'complete' }, null],
      [
        { kind: 'incomplete', cause: 'upstream-cap', resource: 'files', received: 3000, reportedTotal: 3418, limit: 3000 },
        'GitHub returned 3,000 of 3,418 changed files. The remaining files are outside the GitHub API limit.',
      ],
      [
        { kind: 'incomplete', cause: 'upstream-cap', resource: 'files', received: 3000, reportedTotal: null, limit: 3000 },
        'GitHub may have more changed files than the 3,000 returned by its API.',
      ],
    ]
    for (const [completeness, message] of cases) {
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
      queryClient.setQueryData(fileSummariesKey('acorn', 'web', '42'), summaries([file], completeness))
      const host = document.createElement('div')
      const dispose = render(() => (
        <QueryClientProvider client={queryClient}>
          <DiffForPull route={{ owner: 'acorn', repo: 'web', number: '42', key: 'acorn/web#42' }} router={false} />
        </QueryClientProvider>
      ), host)
      expect(host.querySelector('p')?.textContent ?? null).toBe(message)
      dispose()
      queryClient.clear()
    }
  })
})
