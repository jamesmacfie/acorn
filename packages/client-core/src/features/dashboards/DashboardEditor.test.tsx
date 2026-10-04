import { render } from 'solid-js/web'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DashboardDraft, PanelPlan } from '@acorn/protocol/dashboards.ts'

const requests = vi.fn<(path: string, options?: { body?: string }) => Promise<unknown>>()
vi.mock('../../infra/node/apiClient', () => ({
  ApiError: class ApiError extends Error {},
  readJson: (path: string, options?: { body?: string }) => requests(path, options),
  writeJson: (path: string, options?: { body?: string }) => requests(path, options),
}))

const { default: DashboardEditor } = await import('./DashboardEditor')

// A plan with a source but an empty title, which the schema refuses.
const invalid: PanelPlan = {
  version: 2, title: '', time: { zone: 'UTC', mode: 'fixed', weekStart: 'monday' }, columns: [], stages: [], view: { kind: 'list' },
  sources: [{ id: 'tasks', label: 'Tasks', role: 'primary', reference: { kind: 'inline', bindings: {}, content: {
    name: 'Tasks', parameters: { type: 'object', properties: {}, additionalProperties: false }, sourceParameters: {},
    query: { source: { pluginId: 'core', sourceId: 'tasks' }, scope: { workspaceId: 'w', parameters: {} }, sort: [] },
  } } }],
}
const draft = (content: PanelPlan): DashboardDraft => ({ id: 'd1', workspaceId: 'w', content, draftRevision: 1, basePublishedRevision: null, publishedRevision: null, updatedAt: Date.now() } as DashboardDraft)

let host: HTMLDivElement
let dispose: (() => void) | undefined
let client: QueryClient
const settle = () => new Promise(resolve => setTimeout(resolve, 0))
const button = (text: string) => [...document.querySelectorAll('button')].find(entry => entry.textContent === text) as HTMLButtonElement | undefined
const mount = (dashboardId?: string) => {
  dispose = render(() => <QueryClientProvider client={client}>
    <DashboardEditor scope={{ surface: 'home', workspaceId: 'w' } as never} dashboardId={dashboardId} onPublished={() => {}} onClose={() => {}} />
  </QueryClientProvider>, host)
}

beforeEach(() => {
  requests.mockReset()
  requests.mockImplementation(async (path, options) => {
    const body = options?.body ? JSON.parse(options.body) as { operation?: string } : undefined
    if (path.endsWith('/dashboards/list')) return [draft({ ...invalid, title: 'Old idea' })]
    if (path.endsWith('/dashboards/get')) return draft(invalid)
    if (path.endsWith('/data-sources/list')) return { sources: [], discoveries: [] }
    if (path.endsWith('/queries/list')) return []
    if (path.includes('/integrations')) return { providers: [], integrations: [] }
    if (body?.operation === 'describe') return new Promise(() => {})
    throw new Error(`Unexpected ${path}`)
  })
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  host = document.createElement('div')
  document.body.append(host)
})
afterEach(() => {
  dispose?.()
  client.clear()
  host.remove()
})

describe('DashboardEditor', () => {
  it('opens blank, offers the unfinished draft, and shows no problem before a source is picked', async () => {
    mount()
    await settle()
    await settle()
    expect(document.body.textContent).toContain('You have an unfinished panel, Old idea')
    button('Pick data')!.click()
    await settle()
    expect(document.querySelector('.ui-alert')).toBeNull()
    expect(document.body.textContent).not.toContain('unavailable')
    expect(button('Publish')!.disabled).toBe(true)
    expect(requests.mock.calls.some(([path]) => path.endsWith('/dashboards/run'))).toBe(false)
  })

  it('keeps Publish off for an invalid plan and says why', async () => {
    mount('d1')
    await settle()
    await settle()
    expect(button('Publish')!.disabled).toBe(true)
    expect(document.body.textContent).toContain('Title is incomplete.')
  })
})
