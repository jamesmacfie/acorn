import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { render } from 'solid-js/web'
import { afterEach, expect, it, vi } from 'vitest'
import type { Task } from '@acorn/plugin-api/client'
import { filesKey, labelsKey, membersKey, mergeRequestKey, type MergeRequestDetail } from '../../shared/api'
import { MrPane } from './MrPane'

// The `mr` pane draws a GitLab merge request with the shared review views, from the neutral detail the
// Node answers. What is pinned is that GitLab's words reach them: the `!` number, the approval as the
// review decision, the failed job as the checks, and a comment in the conversation.

vi.mock('@solidjs/router', () => ({ useNavigate: () => () => {}, useSearchParams: () => [{}, () => {}] }))
vi.mock('@acorn/plugin-api/client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  onPluginFrame: () => () => {},
}))
// The real diff needs the whole viewer.
vi.mock('../DiffForMergeRequest', () => ({
  DiffForMergeRequest: (props: { route: { key: string } }) => {
    const element = document.createElement('p')
    element.dataset.diff = props.route.key
    return element
  },
}))

const detail: MergeRequestDetail = {
  revision: 'b:a',
  request: {
    number: 12,
    title: 'Fix the importer',
    state: 'open',
    draft: false,
    author: 'ada',
    headRef: 'fix-importer',
    baseRef: 'main',
    updatedAt: null,
    body: '<p>Why</p>',
    headSha: 'a',
    conflicting: false,
  },
  labels: [{ name: 'bug', color: '#dc143c' }],
  reviews: [{ id: 'approval:grace', author: 'grace', state: 'approved', body: null, submittedAt: 1 }],
  reviewers: ['grace'],
  comments: [{ id: '1', author: 'grace', body: '<p>Looks good</p>', createdAt: 2 }],
  commits: [],
  checks: [{ name: 'test', status: 'failure', url: null, runId: 501 }],
  threads: [],
  avatars: {},
}

let dispose: (() => void) | undefined
afterEach(() => dispose?.())

it("draws the task's merge request with the shared review views", () => {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
  client.setQueryData(mergeRequestKey('gitlab.com/group/sub/api', '12'), detail)
  client.setQueryData(filesKey('gitlab.com/group/sub/api', '12'), { files: [], warning: null })
  client.setQueryData(membersKey('gitlab.com/group/sub/api'), [])
  client.setQueryData(labelsKey('gitlab.com/group/sub/api'), [])
  const task = {
    id: 't1',
    projectId: 'p1',
    title: 'Fix the importer',
    repository: { provider: 'gitlab', host: 'gitlab.com', path: 'group/sub/api', externalId: '42' },
    changeRequest: { provider: 'gitlab', number: 12, pane: 'mr' },
  } as unknown as Task
  const host = document.createElement('div')
  document.body.append(host)
  dispose = render(
    () => (
      <QueryClientProvider client={client}>
        <MrPane task={task} />
      </QueryClientProvider>
    ),
    host,
  )
  const text = host.textContent ?? ''
  expect(text).toContain('!12')
  expect(text).toContain('Fix the importer')
  expect(text).toContain('Approved')
  expect(text).toContain('1 check failing')
  expect(text).toContain('Squash and merge')
  expect(text).toContain('bug')
  expect(host.querySelector('[data-diff]')?.getAttribute('data-diff')).toBe('gitlab.com/group/sub/api!12')
  host.remove()
})
