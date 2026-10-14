import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { For } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { integrationsKey } from '@acorn/protocol/api.ts'
import { contentLinkRegistry } from '@acorn/plugin-api/testkit/client'
import type { PluginRefResolution } from '@acorn/protocol/refResolvers.ts'
import { fileSummariesKey, mentionsKey, pullKey, repoLabelsKey, type PullDetail } from '../../shared/api'
import { _resetPrModels, prModel } from './prModel'
import { prSections } from './prSections'

const provider = vi.hoisted(() => ({
  resolve: vi.fn<(identifiers: readonly string[]) => Promise<PluginRefResolution[]>>(),
  openRefPanel: vi.fn(),
}))
vi.mock('@acorn/plugin-api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@acorn/plugin-api/client')>()),
  onPluginFrame: () => () => {},
  openRefPanel: provider.openRefPanel,
  // The external provider is stubbed; the PR model and TanStack query lifecycle stay real.
  refResolutionsOptions: (providerId: string, identifiers: readonly string[], enabled: boolean) => ({
    queryKey: ['test-ref-resolutions', providerId, ...identifiers],
    enabled: enabled && identifiers.length > 0,
    queryFn: () => provider.resolve(identifiers),
  }),
}))

const issue: PluginRefResolution = {
  providerId: 'linear',
  identifier: 'FAST-6529',
  label: 'Fix right clicking in the budget modal',
  url: 'https://linear.app/runn/issue/FAST-6529/fix-right-clicking',
  state: { name: 'In progress', color: '#abcdef', kind: 'started' },
}
const detail = (headRef: string, body: string | null = null): PullDetail => ({
  pull: {
    number: 7,
    title: 'Fix the budget modal',
    state: 'open',
    draft: false,
    author: 'dayna',
    headRef,
    baseRef: 'release/OPS-99',
    updatedAt: 0,
    mergeable: null,
    mergeStateStatus: null,
    autoMergeEnabled: false,
    body,
    headSha: 'abc',
  },
  labels: [],
  reviews: [],
  requestedReviewers: [],
  comments: [],
  commits: [],
  checks: [],
  threads: [],
})

let queryClient: QueryClient
let host: HTMLElement
let dispose: () => void
let recogniser: { dispose(): void }
const key = pullKey('runn-fast', 'acorn', '7')

beforeEach(() => {
  provider.resolve.mockReset()
  provider.openRefPanel.mockClear()
  queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
  queryClient.setQueryData(integrationsKey, {
    integrations: [{ id: 'work', providerId: 'linear', status: 'connected' }],
  })
  queryClient.setQueryData(fileSummariesKey('runn-fast', 'acorn', '7'), { files: [] })
  queryClient.setQueryData(mentionsKey('runn-fast', 'acorn'), [])
  queryClient.setQueryData(repoLabelsKey('runn-fast', 'acorn'), [])
  recogniser = contentLinkRegistry.register({
    id: 'linear.test.issue',
    providerId: 'linear',
    parse: (url) => {
      const match = /^https:\/\/linear\.app\/runn\/issue\/([A-Z]+-\d+)/i.exec(url)
      return match ? { kind: 'linear.issue', item: match[1] } : null
    },
  })
  host = document.createElement('div')
  document.body.append(host)
})

afterEach(() => {
  dispose?.()
  _resetPrModels()
  queryClient.clear()
  recogniser.dispose()
  host.remove()
})

function draw(pull: PullDetail, number = '7') {
  queryClient.setQueryData(pullKey('runn-fast', 'acorn', number), pull)
  queryClient.setQueryData(fileSummariesKey('runn-fast', 'acorn', number), { files: [] })
  dispose = render(
    () => (
      <QueryClientProvider client={queryClient}>
        {(() => {
          const model = prModel({ owner: 'runn-fast', repo: 'acorn', number, taskId: 't1', readOnly: number !== '7' })
          return (
            <For
              each={prSections({
                model,
                currentFile: () => undefined,
                onOpenFile: () => {},
                onLinkClick: () => {},
              }).filter((section) => section.id === 'integrations')}
            >
              {(section) => section.render()}
            </For>
          )
        })()}
      </QueryClientProvider>
    ),
    host,
  )
}

describe('branch issues in the PR rail', () => {
  it('shows a branch-only issue after confirmation, with its title, status, and issue action', async () => {
    let confirm!: (issues: PluginRefResolution[]) => void
    provider.resolve.mockImplementation(() => new Promise((resolve) => (confirm = resolve)))
    draw(detail('dayna/fast-6529-bug-right-clicking-in-budget-modal-opens-the-planner-885c'))

    await vi.waitFor(() => expect(provider.resolve).toHaveBeenCalledWith(['FAST-6529']))
    expect(host.textContent).toBe('')
    confirm([issue])
    await vi.waitFor(() => expect(host.textContent).toContain(issue.label))
    expect(host.textContent).toContain('FAST-6529')
    expect(host.textContent).toContain('In progress')
    host.querySelector<HTMLElement>('[aria-label="FAST-6529"]')!.click()
    expect(provider.openRefPanel).toHaveBeenCalledWith({ providerId: 'linear', displayId: 'FAST-6529' })
  })

  it('merges a branch reference with the same issue URL in the body', async () => {
    provider.resolve.mockResolvedValue([issue])
    draw(detail('dayna/fast-6529-fix', issue.url))
    await vi.waitFor(() => expect(host.textContent).toContain(issue.label))
    expect(host.querySelectorAll('[aria-label="FAST-6529"]')).toHaveLength(1)
  })

  it('omits unconfirmed branch fragments', async () => {
    provider.resolve.mockResolvedValue([])
    draw(detail('release-2026'))
    await vi.waitFor(() => expect(provider.resolve).toHaveBeenCalledWith(['RELEASE-2026']))
    await vi.waitFor(() => expect(queryClient.isFetching()).toBe(0))
    expect(host.textContent).toBe('')
  })

  it('does not resolve branch candidates with no connected Linear', async () => {
    queryClient.setQueryData(integrationsKey, { integrations: [] })
    draw(detail('dayna/fast-6529-fix'))
    await vi.waitFor(() => expect(queryClient.isFetching()).toBe(0))
    expect(provider.resolve).not.toHaveBeenCalled()
    expect(host.textContent).toBe('')
  })

  it('removes a branch issue when refreshed PR detail names another branch', async () => {
    provider.resolve.mockResolvedValue([issue])
    draw(detail('dayna/fast-6529-fix'))
    await vi.waitFor(() => expect(host.textContent).toContain(issue.label))
    queryClient.setQueryData(key, detail('feature/no-ticket'))
    await vi.waitFor(() => expect(host.textContent).toBe(''))
  })

  it('keeps a late response for the primary PR out of a related PR', async () => {
    let confirmPrimary!: (issues: PluginRefResolution[]) => void
    const related = { ...issue, identifier: 'OPS-9', label: 'Fix the related issue' }
    provider.resolve.mockImplementationOnce(() => new Promise((resolve) => (confirmPrimary = resolve)))
    provider.resolve.mockResolvedValue([related])
    draw(detail('dayna/fast-6529-fix'))
    await vi.waitFor(() => expect(provider.resolve).toHaveBeenCalledWith(['FAST-6529']))

    dispose()
    draw(detail('feature/ops-9'), '8')
    await vi.waitFor(() => expect(host.textContent).toContain(related.label))
    confirmPrimary([issue])
    await vi.waitFor(() => expect(queryClient.isFetching()).toBe(0))
    expect(host.textContent).not.toContain('FAST-6529')
    expect(host.textContent).toContain('OPS-9')
  })
})
