import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiffDocumentFile, DiffSegmentRequest } from '@acorn/plugin-api/ui/diff'
import type { PullDetail, Thread } from '../../shared/api'
import { buildConversationEntries, type ConversationEntry } from './model'
import type { PrModel } from './prModel'

// A pull request's conversation opens without building every turn's body (docs/github-integration.md
// § Conversation): each turn keeps its element by `kind:id` key, draws GitHub's HTML once it comes
// near the viewport, and quotes a thread's code from the one diff segment that holds its line.

const segment = { rows: 10, bands: 10, gaps: 0, columns: 20, lines: [1, 10, 1, 10] as [number, number, number, number] }
const document: DiffDocumentFile[] = ['a.ts', 'b.ts', 'c.ts'].map((path) => ({
  path, status: 'modified', additions: 1, deletions: 0, sha: `sha-${path}`, viewed: false, patchKey: `sha256:${path}`, segments: [segment],
}))
const asked: DiffSegmentRequest[][] = []

vi.mock('../queries', () => ({
  pullDiffOptions: (owner: string, repo: string, number: string, enabled: boolean) => ({
    queryKey: ['files', owner, repo, number, 'diff'],
    enabled,
    queryFn: async () => ({ document: { files: document }, completeness: { state: 'complete' } }),
  }),
  fetchDiffSegments: async (_owner: string, _repo: string, requests: DiffSegmentRequest[]) => {
    asked.push(requests)
    return requests.map((request) => ({
      ...request,
      rows: Array.from({ length: 10 }, (_, index) => ({ kind: 'normal', oldNo: index + 1, newNo: index + 1, raw: `${request.path} line ${index + 1}` })),
    }))
  },
}))

const { PrConversation } = await import('./Conversation')

// The observer the kit's Timeline uses to say a turn is near. Nothing is near until a test says so.
let watched: Element[] = []
let notify: ((entries: { target: Element; isIntersecting: boolean }[]) => void) | undefined
class TestIntersectionObserver {
  constructor(run: typeof notify) { notify = run }
  observe(element: Element) { watched.push(element) }
  unobserve(element: Element) { watched = watched.filter((item) => item !== element) }
  disconnect() { watched = [] }
}
const bringNear = (key: string) => notify!([{ target: host.querySelector(`[data-turn="${key}"]`)!, isIntersecting: true }])

const thread = (id: string, path: string, line: number | null, createdAt: number): Thread => ({
  threadId: id, path, line, side: 'RIGHT', resolved: false,
  comments: [{ id: `${id}:c1`, databaseId: 1, author: 'octo', body: `<p>note ${id}</p>`, createdAt }],
})
const detail = (overrides: Partial<PullDetail>): PullDetail => ({
  pull: null, labels: [], reviews: [], requestedReviewers: [], comments: [], commits: [], checks: [], threads: [], ...overrides,
})

let host: HTMLElement
let dispose: (() => void) | undefined
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  asked.length = 0
  watched = []
  ;(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = TestIntersectionObserver
  host = globalThis.document.createElement('div')
  globalThis.document.body.append(host)
})
afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
  delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver
})

const mount = (initial: PullDetail) => {
  const [data, setData] = createSignal(initial)
  const entries = () => buildConversationEntries(data())
  const model = {
    scope: { owner: 'acorn', repo: 'web', number: '42' },
    readOnly: true,
    conversationEntries: entries,
  } as unknown as PrModel
  dispose = render(() => (
    <QueryClientProvider client={new QueryClient()}>
      <PrConversation model={model} onOpenFile={() => {}} onLinkClick={() => {}} />
    </QueryClientProvider>
  ), host)
  return { setData, entries: entries as () => ConversationEntry[] }
}

describe('the pull request conversation', () => {
  it('keys every turn by kind and id', () => {
    mount(detail({ comments: [{ id: 'c1', author: 'a', body: '<p>hi</p>', createdAt: 1 }], threads: [thread('t1', 'a.ts', 3, 2)] }))
    expect([...host.querySelectorAll('.ui-timeline-turn')].map((row) => row.getAttribute('data-turn'))).toEqual(['comment:c1', 'thread:t1'])
  })

  it('draws a summary until a turn comes near, then its body and snippet in the same element', async () => {
    mount(detail({ threads: [thread('t1', 'a.ts', 3, 1)] }))
    const turn = host.querySelector('[data-turn="thread:t1"]')!
    expect(turn.textContent).toContain('Shown when you scroll to it.')
    expect(turn.querySelector('.ui-markdown')).toBeNull()

    bringNear('thread:t1')
    await flush()
    await flush()
    expect(host.querySelector('[data-turn="thread:t1"]')).toBe(turn)
    expect(turn.querySelector('.ui-markdown')?.textContent).toBe('note t1')
    expect(turn.textContent).toContain('a.ts line 3')
  })

  it('reads the segments of near threads only, and says when a file has none to read', async () => {
    mount(detail({
      threads: [thread('t1', 'a.ts', 3, 1), thread('t2', 'b.ts', 4, 2), thread('t3', 'capped.ts', 5, 3)],
    }))
    bringNear('thread:t2')
    bringNear('thread:t3')
    await flush()
    await flush()
    expect(asked.flat()).toEqual([{ path: 'b.ts', patchKey: 'sha256:b.ts', ordinal: 0 }])
    expect(host.querySelector('[data-turn="thread:t3"]')?.textContent).toContain('Snippet unavailable.')
  })

  it('keeps every turn element when a refetch brings an older comment and a reply', () => {
    const view = mount(detail({ threads: [thread('t1', 'a.ts', 3, 10)], comments: [{ id: 'c2', author: 'a', body: '<p>b</p>', createdAt: 20 }] }))
    const before = [...host.querySelectorAll('.ui-timeline-turn')]
    expect(before[0]?.textContent).not.toContain('Bea')
    const reply = { id: 't1:c2', databaseId: 2, author: 'Bea', body: '<p>reply</p>', createdAt: 15 }
    view.setData(detail({
      threads: [{ ...thread('t1', 'a.ts', 3, 10), comments: [...thread('t1', 'a.ts', 3, 10).comments, reply] }],
      comments: [{ id: 'c0', author: 'z', body: '<p>early</p>', createdAt: 1 }, { id: 'c2', author: 'a', body: '<p>b</p>', createdAt: 20 }],
    }))
    const after = [...host.querySelectorAll('.ui-timeline-turn')]
    expect(after.map((row) => row.getAttribute('data-turn'))).toEqual(['comment:c0', 'thread:t1', 'comment:c2'])
    expect(after[1]).toBe(before[0])
    expect(after[2]).toBe(before[1])
    // The reply lands in the turn that was already there.
    expect(after[1]?.textContent).toContain('Bea')
  })
})
