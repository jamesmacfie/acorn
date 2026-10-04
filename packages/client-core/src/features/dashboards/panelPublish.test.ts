import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DashboardDraft, PanelPlan } from '@acorn/protocol/dashboards.ts'

const requests = vi.fn<(path: string, options?: { body?: string }) => Promise<unknown>>()
vi.mock('../../infra/node/apiClient', () => ({ writeJson: (path: string, options?: { body?: string }) => requests(path, options) }))
vi.mock('../queries/queriesClient', () => ({
  queriesClient: () => ({ resolve: async (reference: { source: { pluginId: string; sourceId: string } }) => ({ query: { source: reference.source, scope: {} } }) }),
}))

const { publishPanelPlan, PanelRegionRefusal } = await import('./panelPublish')
const { panelRegion } = await import('./region')

const source = (id: string, pluginId: string, sourceId: string) => ({ id, label: id, role: 'primary', reference: { source: { pluginId, sourceId } } })
const plan = { version: 2, title: 'Mine', view: { kind: 'list' }, sources: [source('a', 'github', 'pulls'), source('b', 'github', 'pulls'), source('c', 'core', 'tasks')] } as unknown as PanelPlan
const roles: Record<string, string[]> = { 'github/pulls': ['title', 'status'], 'core/tasks': ['title', 'assignee'] }
const saved = { id: 'd1', draftRevision: 3 } as DashboardDraft
const publish = (region?: ReturnType<typeof panelRegion>) => publishPanelPlan({
  nodeId: 'n', scope: { workspaceId: 'w' }, plan, ...(region ? { region } : {}), flush: async () => saved,
  queryClient: { invalidateQueries: async () => {} } as never, recovery: { discard: vi.fn() } as never,
})

beforeEach(() => {
  requests.mockReset()
  requests.mockImplementation(async (path, options) => {
    const body = JSON.parse(options?.body ?? '{}') as { source?: { pluginId: string; sourceId: string } }
    if (path.endsWith('/data-sources/describe')) return { fields: (roles[`${body.source!.pluginId}/${body.source!.sourceId}`] ?? []).map(role => ({ display: { role } })) }
    if (path.endsWith('/dashboards/publish')) return {}
    throw new Error(`Unexpected ${path}`)
  })
})

describe('publishPanelPlan', () => {
  it('derives each distinct source and field role, then publishes the saved draft', async () => {
    expect(await publish()).toEqual({ id: 'd1', sources: ['github:pulls', 'core:tasks'], fieldRoles: ['title', 'status', 'assignee'] })
    const published = requests.mock.calls.find(([path]) => path.endsWith('/dashboards/publish'))
    expect(JSON.parse(published![1]!.body!)).toMatchObject({ id: 'd1', expectedRevision: 3 })
  })

  it("refuses a panel the region wouldn't show, before publishing it", async () => {
    await expect(publish(panelRegion('github', { views: ['board'], max: 4 }))).rejects.toThrow('This area only shows Board panels.')
    await expect(publish(panelRegion('github', { max: 4 }))).rejects.toBeInstanceOf(PanelRegionRefusal)
    expect(requests.mock.calls.some(([path]) => path.endsWith('/dashboards/publish'))).toBe(false)
  })
})
