import { render } from 'solid-js/web'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { afterEach, expect, it, vi } from 'vitest'
import type { SuggestedTrigger } from './SuggestedTriggers'

const requests = vi.fn<(path: string, options?: { body?: string }) => Promise<unknown>>()
vi.mock('../../infra/node/apiClient', () => ({
  ApiError: class ApiError extends Error {},
  readJson: (path: string, options?: { body?: string }) => requests(path, options),
  writeJson: (path: string, options?: { body?: string }) => requests(path, options),
}))

const { default: SuggestedTriggers } = await import('./SuggestedTriggers')

const failing = {
  id: 'deploy-fails',
  label: 'A deploy fails',
  description: 'Starts when a deploy fails.',
  predicate: {
    kind: 'comparison',
    left: { address: { from: 'item', pointer: '/status' } },
    operator: 'eq',
    right: { address: { from: 'literal', value: 'failed' } },
  },
  change: { on: 'enters' },
}
const settle = async () => {
  for (let index = 0; index < 8; index += 1) await new Promise((resolve) => setTimeout(resolve, 0))
}
let dispose: (() => void) | undefined
afterEach(() => dispose?.())

it("lists each source's suggestions under its account, and picks one with its filter", async () => {
  requests.mockImplementation(async (path, options) => {
    if (path.endsWith('/data-sources/list'))
      return {
        discoveries: [],
        sources: [
          {
            pluginId: 'acme',
            sourceId: 'deploys',
            name: 'Deploys',
            singular: 'Deploy',
            plural: 'Deploys',
            identityScope: 'id',
          },
          {
            pluginId: 'github',
            sourceId: 'pull-requests',
            name: 'Pull requests',
            singular: 'Pull request',
            plural: 'Pull requests',
            identityScope: 'id',
            providerId: 'github',
          },
        ],
      }
    if (path.endsWith('/core/integrations'))
      return {
        providers: [],
        integrations: [{ id: 'work', providerId: 'github', name: 'Work', label: 'GitHub', status: 'connected' }],
      }
    const body = JSON.parse(options!.body!) as { source: { pluginId: string }; scope: { connectionId?: string } }
    if (body.source.pluginId === 'github') expect(body.scope.connectionId).toBe('work')
    return { starterTriggers: body.source.pluginId === 'acme' ? [failing] : [] }
  })
  const picked = vi.fn<(suggestion: SuggestedTrigger) => void>()
  const host = document.createElement('div')
  document.body.append(host)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  dispose = render(
    () => (
      <QueryClientProvider client={client}>
        <SuggestedTriggers workspaceId="w" projectId="p" onPick={picked} />
      </QueryClientProvider>
    ),
    host,
  )
  await settle()
  const row = [...host.querySelectorAll<HTMLElement>('.ui-row')].find((entry) =>
    entry.textContent?.includes('A deploy fails'),
  )
  expect(row?.textContent).toContain('Deploys')
  row!.click()
  expect(picked.mock.calls[0]![0]).toMatchObject({
    change: { on: 'enters' },
    reference: {
      kind: 'inline',
      content: {
        query: {
          source: { pluginId: 'acme', sourceId: 'deploys' },
          scope: { workspaceId: 'w', projectId: 'p' },
          predicate: failing.predicate,
        },
      },
    },
  })
  host.remove()
})
