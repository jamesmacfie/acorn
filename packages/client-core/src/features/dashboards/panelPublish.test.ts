import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DashboardDraft, PanelPlan } from '@acorn/protocol/dashboards.ts'

const requests = vi.fn<(path: string, options?: { body?: string }) => Promise<unknown>>()
vi.mock('../../infra/node/apiClient', () => ({ writeJson: (path: string, options?: { body?: string }) => requests(path, options) }))
vi.mock('../queries/queriesClient', () => ({
  queriesClient: () => ({ resolve: async (reference: { source: { pluginId: string; sourceId: string } }) => ({ query: { source: reference.source, scope: {} } }) }),
}))

const { hasUnpublishedEdits, PanelHasUnpublishedEdits, PanelRegionRefusal, publishNewPanel, publishPanelPlan, publishQuickEdit } = await import('./panelPublish')
const { panelRegion } = await import('./region')

const source = (id: string, pluginId: string, sourceId: string) => ({ id, label: id, role: 'primary', reference: { source: { pluginId, sourceId } } })
const plan = { version: 2, title: 'Mine', view: { kind: 'list' }, sources: [source('a', 'github', 'pulls'), source('b', 'github', 'pulls'), source('c', 'core', 'tasks')] } as unknown as PanelPlan
const roles: Record<string, string[]> = { 'github/pulls': ['title', 'status'], 'core/tasks': ['title', 'assignee'] }
const saved = { id: 'd1', draftRevision: 3 } as DashboardDraft
const context = { nodeId: 'n', scope: { workspaceId: 'w' }, queryClient: { invalidateQueries: async () => {} } as never }
const recovery = (content?: unknown) => ({ read: () => content === undefined ? undefined : { content }, discard: vi.fn() }) as never
let stored: { draft: unknown; published: unknown }
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
    if (path.endsWith('/dashboards/create')) return { id: 'new', draftRevision: 1 }
    if (path.endsWith('/dashboards/get')) return stored.draft
    if (path.endsWith('/dashboards/published')) return stored.published
    if (path.endsWith('/dashboards/save')) return { id: 'd1', draftRevision: 4 }
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

describe('hasUnpublishedEdits', () => {
  const draft = (content: unknown, publishedRevision: number | null = 2) => ({ content, publishedRevision }) as never
  it('compares the draft with the published revision', () => {
    expect(hasUnpublishedEdits(draft(plan), { content: plan })).toBe(false)
    expect(hasUnpublishedEdits(draft({ ...plan, title: 'Changed' }), { content: plan })).toBe(true)
    expect(hasUnpublishedEdits(draft(plan, null), undefined)).toBe(true)
  })
})

describe('publishQuickEdit', () => {
  const published = () => requests.mock.calls.filter(([path]) => path.endsWith('/dashboards/publish'))
  beforeEach(() => { stored = { draft: { id: 'd1', draftRevision: 3, publishedRevision: 2, content: plan }, published: { revision: 2, content: plan } } })

  it('saves the one change to the draft and publishes it', async () => {
    const result = await publishQuickEdit({ ...context, recovery: recovery(), dashboardId: 'd1', edit: current => ({ ...current, title: 'Renamed' }) })
    expect(result.plan.title).toBe('Renamed')
    const saved = requests.mock.calls.find(([path]) => path.endsWith('/dashboards/save'))
    expect(JSON.parse(saved![1]!.body!)).toMatchObject({ id: 'd1', expectedRevision: 3, content: { title: 'Renamed' } })
    expect(JSON.parse(published()[0]![1]!.body!)).toMatchObject({ id: 'd1', expectedRevision: 4 })
  })

  it('refuses a panel with unpublished edits on the Node or on this device', async () => {
    const edit = (current: PanelPlan) => ({ ...current, title: 'Renamed' })
    stored.draft = { id: 'd1', draftRevision: 3, publishedRevision: 2, content: { ...plan, title: 'Studio edit' } }
    await expect(publishQuickEdit({ ...context, recovery: recovery(), dashboardId: 'd1', edit })).rejects.toBeInstanceOf(PanelHasUnpublishedEdits)
    stored.draft = { id: 'd1', draftRevision: 3, publishedRevision: 2, content: plan }
    await expect(publishQuickEdit({ ...context, recovery: recovery({ ...plan, title: 'Unsaved' }), dashboardId: 'd1', edit })).rejects.toBeInstanceOf(PanelHasUnpublishedEdits)
    expect(published()).toEqual([])
  })
})

describe('publishNewPanel', () => {
  it('derives its own sources and field roles, as the drill-down needs once a summary changes them', async () => {
    const drilled = { ...plan, sources: [source('c', 'core', 'tasks')] } as unknown as PanelPlan
    expect(await publishNewPanel({ ...context, recovery: recovery(), plan: drilled })).toMatchObject({ id: 'new', sources: ['core:tasks'], fieldRoles: ['title', 'assignee'] })
  })
})
