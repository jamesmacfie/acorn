import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CodeRow, DiffDocumentTopology, DiffSource } from '@acorn/plugin-api/ui/diff'
import { pullDiffKey, pullKey, type PullDiffResponse, type Thread } from '../shared/api'
import { DiffForPull } from './DiffForPull'

const { openPane } = vi.hoisted(() => ({ openPane: vi.fn() }))
vi.mock('@acorn/plugin-api/client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  openPane,
}))
vi.mock('@solidjs/router', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
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

const patchKey = `sha256:${'b'.repeat(64)}`
const topology: DiffDocumentTopology = {
  schemaVersion: 1,
  revision: '2:abc',
  totals: { files: 2, rows: 3, bands: 3, segments: 1, columns: 3 },
  files: [
    {
      path: 'src/app.ts',
      status: 'modified',
      additions: 1,
      deletions: 0,
      sha: 'new-sha',
      viewed: false,
      patchKey,
      segments: [{ rows: 3, bands: 3, gaps: 1, columns: 3, lines: [0, 0, 1, 1] }],
    },
    {
      path: 'logo.png',
      status: 'modified',
      additions: null,
      deletions: null,
      sha: null,
      viewed: false,
      patchKey: null,
      segments: [],
    },
  ],
}
const diff = (completeness: PullDiffResponse['completeness'] = { kind: 'complete' }): PullDiffResponse => ({
  document: topology,
  completeness,
})
const file = topology.files[0]!

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
    const dispose = render(
      () => (
        <QueryClientProvider client={queryClient}>
          <DiffForPull route={route} router={false} taskId="task-1" />
        </QueryClientProvider>
      ),
      host,
    )

    expect(source?.openLine).toBeTypeOf('function')
    source?.openLine?.(added)
    expect(openPane).toHaveBeenCalledExactlyOnceWith(
      'task-1',
      'editor',
      { kind: 'editor:reveal', path: 'src/app.ts', line: 48 },
      'add',
    )
    source?.openLine?.(deleted)
    expect(openPane).toHaveBeenCalledTimes(1)
    dispose()

    const disposeBrowse = render(
      () => (
        <QueryClientProvider client={queryClient}>
          <DiffForPull route={route} router />
        </QueryClientProvider>
      ),
      host,
    )
    expect(source?.openLine).toBeUndefined()
    disposeBrowse()
    queryClient.clear()
  })

  it('hands the viewer the document and reads segments and search pages by patch digest', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
    queryClient.setQueryData(pullDiffKey('acorn', 'web', '42'), diff())
    queryClient.setQueryData(pullKey('acorn', 'web', '42'), {
      pull: null,
      labels: [],
      reviews: [],
      requestedReviewers: [],
      comments: [],
      commits: [],
      checks: [],
      threads: [],
    })
    const fetchMock = vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url.endsWith('/diff/segments')
              ? [
                  {
                    path: file.path,
                    patchKey,
                    ordinal: 0,
                    rows: [{ kind: 'insert', oldNo: null, newNo: 1, raw: 'new' }],
                  },
                ]
              : { matches: [], nextCursor: null },
          ),
          { headers: { 'content-type': 'application/json' } },
        ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const host = document.createElement('div')
    const dispose = render(
      () => (
        <QueryClientProvider client={queryClient}>
          <DiffForPull
            route={{ owner: 'acorn', repo: 'web', number: '42', key: 'acorn/web#42' }}
            router={false}
            taskId="task-1"
          />
        </QueryClientProvider>
      ),
      host,
    )

    try {
      expect(source?.topology()).toEqual(topology)
      expect(source?.signature()).toBe('2:abc')
      expect(source?.loading()).toBe(false)
      const segments = await source!.loadSegments(
        [{ path: file.path, patchKey, ordinal: 0 }],
        new AbortController().signal,
      )
      expect(segments[0]?.rows).toHaveLength(1)
      await source!.search({ query: 'new', caseSensitive: false, cursor: null }, new AbortController().signal)
      expect(fetchMock).toHaveBeenCalledWith(
        '/v1/p/github/repos/acorn/web/diff/segments',
        expect.objectContaining({ method: 'POST' }),
      )
      expect(fetchMock).toHaveBeenCalledWith(
        '/v1/p/github/repos/acorn/web/diff/search',
        expect.objectContaining({ method: 'POST' }),
      )
      // No whole patch is read for the diff: not the files route, not a patches batch.
      expect(fetchMock.mock.calls.some(([url]) => url.includes('/files'))).toBe(false)
    } finally {
      dispose()
      queryClient.clear()
    }
  })

  it('withholds outdated, legacy, unlocated and incompatible threads, and updates an open pane', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
    const thread = (threadId: string, overrides: Partial<Thread> = {}): Thread => ({
      threadId,
      path: file.path,
      line: 1,
      originalLine: 275,
      side: 'RIGHT',
      outdated: false,
      resolved: false,
      comments: [],
      ...overrides,
    })
    const current = thread('moved')
    const deleted = thread('deleted', { side: 'LEFT', resolved: true })
    const threads = [
      current,
      deleted,
      thread('outdated-null', { outdated: true, line: null }),
      thread('outdated-numeric', { outdated: true }),
      thread('unlocated', { line: null }),
      thread('unknown', { outdated: null }),
      thread('older-response', { outdated: undefined }),
      thread('bad-side', { side: 'OTHER' }),
      thread('missing-path', { path: null }),
      thread('missing-file', { path: 'missing.ts' }),
      thread('binary', { path: 'logo.png' }),
    ]
    const detail = {
      revision: 'base:head',
      pull: null,
      labels: [],
      reviews: [],
      requestedReviewers: [],
      comments: [],
      commits: [],
      checks: [],
      threads,
    }
    queryClient.setQueryData(pullDiffKey('acorn', 'web', '42'), { ...diff(), revision: 'base:head' })
    queryClient.setQueryData(pullKey('acorn', 'web', '42'), detail)
    const host = document.createElement('div')
    const dispose = render(
      () => (
        <QueryClientProvider client={queryClient}>
          <DiffForPull route={{ owner: 'acorn', repo: 'web', number: '42', key: 'acorn/web#42' }} router={false} />
        </QueryClientProvider>
      ),
      host,
    )
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
    try {
      expect(source?.threads?.()).toEqual([current, deleted])
      queryClient.setQueryData(pullKey('acorn', 'web', '42'), {
        ...detail,
        threads: threads.map((t) => ({ ...t, outdated: true })),
      })
      await flush()
      expect(source?.threads?.()).toEqual([])
      queryClient.setQueryData(pullKey('acorn', 'web', '42'), { ...detail, revision: 'base:force-pushed' })
      await flush()
      expect(source?.threads?.()).toEqual([])
      queryClient.setQueryData(pullDiffKey('acorn', 'web', '42'), { ...diff(), revision: 'base:force-pushed' })
      await flush()
      expect(source?.threads?.()).toEqual([current, deleted])
      queryClient.setQueryData(pullDiffKey('acorn', 'web', '42'), diff())
      await flush()
      expect(source?.threads?.()).toEqual([])
    } finally {
      dispose()
      queryClient.clear()
    }
  })

  it('says when GitHub capped the file list, with and without its count', () => {
    const cases: [PullDiffResponse['completeness'], string | null][] = [
      [{ kind: 'complete' }, null],
      [
        {
          kind: 'incomplete',
          cause: 'upstream-cap',
          resource: 'files',
          received: 3000,
          reportedTotal: 3418,
          limit: 3000,
        },
        'GitHub sent 3,000 of 3,418 changed files, which is the most it sends for one pull request.',
      ],
      [
        {
          kind: 'incomplete',
          cause: 'upstream-cap',
          resource: 'files',
          received: 3000,
          reportedTotal: null,
          limit: 3000,
        },
        'GitHub might have more changed files than the 3,000 it sent.',
      ],
    ]
    for (const [completeness, message] of cases) {
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
      queryClient.setQueryData(pullDiffKey('acorn', 'web', '42'), diff(completeness))
      const host = document.createElement('div')
      const dispose = render(
        () => (
          <QueryClientProvider client={queryClient}>
            <DiffForPull route={{ owner: 'acorn', repo: 'web', number: '42', key: 'acorn/web#42' }} router={false} />
          </QueryClientProvider>
        ),
        host,
      )
      expect(host.querySelector('p')?.textContent ?? null).toBe(message)
      dispose()
      queryClient.clear()
    }
  })
})
