import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { render } from 'solid-js/web'
import { afterEach, expect, it, vi } from 'vitest'
import type { Task } from '@acorn/plugin-api/client'
import { filesKey, membersKey, pullRequestKey, type PullRequestDetail } from '../../shared/api'
import { PrPane } from './PrPane'

// The `bitbucket-pr` pane draws a Bitbucket pull request with the shared review views, from the neutral
// detail the Node answers. What is pinned is that Bitbucket's words reach them: the `#` number, a
// request for changes as the review decision, the failed build as the checks, the merge strategies, and
// no Labels section, because Bitbucket has no labels.

vi.mock('@solidjs/router', () => ({ useNavigate: () => () => {}, useSearchParams: () => [{}, () => {}] }))
vi.mock('@acorn/plugin-api/client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  onPluginFrame: () => () => {},
}))
// The real diff needs the whole viewer.
vi.mock('../DiffForPullRequest', () => ({
  DiffForPullRequest: (props: { route: { key: string } }) => {
    const element = document.createElement('p')
    element.dataset.diff = props.route.key
    return element
  },
}))

const detail = (state: 'open' | 'closed'): PullRequestDetail => ({
  revision: 'b:a',
  request: {
    number: 12,
    title: 'Fix the importer',
    state,
    draft: false,
    author: 'ada',
    headRef: 'fix-importer',
    baseRef: 'main',
    updatedAt: null,
    body: '<p>Why</p>',
    headSha: 'a',
  },
  labels: [],
  reviews: [{ id: 'participant:linus', author: 'linus', state: 'changes-requested', body: null, submittedAt: 1 }],
  reviewers: ['grace'],
  comments: [{ id: '1', author: 'grace', body: '<p>Looks good</p>', createdAt: 2 }],
  commits: [],
  checks: [{ name: 'Build', status: 'failure', url: 'https://ci.example/build', runId: null }],
  threads: [],
  avatars: {},
  sourceRepository: null,
})

let dispose: (() => void) | undefined
afterEach(() => dispose?.())

const draw = (state: 'open' | 'closed') => {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
  client.setQueryData(pullRequestKey('acme/api', '12'), detail(state))
  client.setQueryData(filesKey('acme/api', '12'), { files: [], warning: null })
  client.setQueryData(membersKey('acme/api'), [])
  const task = {
    id: `t-${state}`,
    projectId: 'p1',
    title: 'Fix the importer',
    repository: { provider: 'bitbucket', host: 'bitbucket.org', path: 'acme/api', externalId: null },
    changeRequest: { provider: 'bitbucket', number: 12, pane: 'bitbucket-pr' },
  } as unknown as Task
  const host = document.createElement('div')
  document.body.append(host)
  dispose = render(
    () => (
      <QueryClientProvider client={client}>
        <PrPane task={task} />
      </QueryClientProvider>
    ),
    host,
  )
  return host
}

it("draws the task's pull request with the shared review views, in Bitbucket's words", () => {
  const host = draw('open')
  const text = host.textContent ?? ''
  expect(text).toContain('#12')
  expect(text).toContain('Fix the importer')
  expect(text).toContain('Changes requested')
  expect(text).toContain('1 check failing')
  expect(text).toContain('Squash and merge')
  expect(text).not.toContain('Labels')
  expect(host.querySelector('[data-diff]')?.getAttribute('data-diff')).toBe('acme/api#12')
  host.remove()
})

it('offers no Reopen on a declined pull request, because Bitbucket has none', () => {
  const host = draw('closed')
  expect(host.textContent).not.toContain('Reopen')
  host.remove()
})
