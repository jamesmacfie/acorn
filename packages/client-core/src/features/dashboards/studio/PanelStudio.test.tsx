import { render } from 'solid-js/web'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DashboardDraft, PanelPlan } from '@acorn/protocol/dashboards.ts'

const requests = vi.fn<(path: string, options?: { body?: string }) => Promise<unknown>>()
vi.mock('../../../infra/node/apiClient', () => ({
  ApiError: class ApiError extends Error {},
  readJson: (path: string, options?: { body?: string }) => requests(path, options),
  writeJson: (path: string, options?: { body?: string }) => requests(path, options),
}))

const { default: PanelStudio } = await import('./PanelStudio')

const tasks: PanelPlan['sources'][number] = { id: 'tasks', label: 'Tasks', role: 'primary', reference: { kind: 'inline', bindings: {}, content: {
  name: 'Tasks', parameters: { type: 'object', properties: {}, additionalProperties: false }, sourceParameters: {},
  query: { source: { pluginId: 'core', sourceId: 'tasks' }, scope: { workspaceId: 'w', parameters: {} }, sort: [] },
} } }
// A plan with a source but an empty title, which the schema refuses.
const invalid: PanelPlan = { version: 2, title: '', time: { zone: 'UTC', mode: 'fixed', weekStart: 'monday' }, columns: [], stages: [], view: { kind: 'list' }, sources: [tasks] }
const filtered: PanelPlan = {
  ...invalid, title: 'Open tasks',
  columns: [{ id: 'title', label: 'Title', type: 'text', bind: { tasks: { field: '/title' } } }],
  stages: [{ op: 'filter', where: { kind: 'comparison', left: { address: { from: 'item', pointer: '/title' } }, operator: 'eq', right: { address: { from: 'literal', value: 'x' } } } }],
}
const draft = (content: PanelPlan): DashboardDraft => ({ id: 'd1', workspaceId: 'w', content, draftRevision: 1, basePublishedRevision: null, publishedRevision: null, updatedAt: Date.now() } as DashboardDraft)

let host: HTMLDivElement
let dispose: (() => void) | undefined
let client: QueryClient
let opened: PanelPlan
const onClose = vi.fn()
const settle = async (times = 3) => { for (let index = 0; index < times; index += 1) await new Promise(resolve => setTimeout(resolve, 0)) }
const button = (text: string) => [...document.querySelectorAll('button')].find(entry => entry.textContent?.trim() === text) as HTMLButtonElement | undefined
const row = (text: string) => [...document.querySelectorAll<HTMLElement>('.ui-row')].find(entry => entry.textContent?.includes(text))
const mount = (dashboardId?: string) => {
  dispose = render(() => <QueryClientProvider client={client}>
    <PanelStudio scope={{ surface: 'home', workspaceId: 'w' } as never} dashboardId={dashboardId} returnLabel="Home"
      onPublished={() => {}} onDeleted={() => {}} onClose={onClose} />
  </QueryClientProvider>, host)
}

beforeEach(() => {
  opened = invalid
  onClose.mockReset()
  requests.mockReset()
  requests.mockImplementation(async (path, options) => {
    const body = options?.body ? JSON.parse(options.body) as { operation?: string } : undefined
    if (path.endsWith('/dashboards/list')) return [draft({ ...invalid, title: 'Old idea' })]
    if (path.endsWith('/dashboards/get')) return draft(opened)
    if (path.endsWith('/dashboards/run')) return {
      plan: opened, rows: [], groups: [],
      diagnostics: { problems: [{ path: '/stages/0', message: 'Filter names an unavailable column: title.', severity: 'error' }], sources: [], stages: [], evaluationTime: 0, plugins: [], accounts: [], complete: true },
    }
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

describe('PanelStudio', () => {
  it('opens blank, offers the unfinished draft, and shows no problem before a source is picked', async () => {
    mount()
    await settle()
    expect(document.body.textContent).toContain('You have an unfinished panel, Old idea')
    button('Pick data')!.click()
    await settle()
    expect(document.querySelector('.ui-alert')).toBeNull()
    expect(document.body.textContent).not.toContain('unavailable')
    expect(button('Publish…')!.disabled).toBe(true)
    expect(requests.mock.calls.some(([path]) => path.endsWith('/dashboards/run'))).toBe(false)
  })

  it('says why an invalid plan is incomplete and keeps Publish off in the review', async () => {
    mount('d1')
    await settle()
    expect(document.body.textContent).toContain('Title is incomplete.')
    button('Publish…')!.click()
    await settle()
    expect(button('Publish')!.disabled).toBe(true)
  })

  it("shows a selected part's inspector", async () => {
    mount('d1')
    await settle()
    row('List')!.click()
    await settle()
    expect(document.querySelector('.dash-studio-inspector h3')?.textContent).toBe('List')
    expect(document.querySelector('.dash-studio-inspector')!.textContent).toContain('View')
  })

  it('marks a step that has a problem', async () => {
    opened = filtered
    mount('d1')
    await settle(6)
    const step = row('Keep where Title is')!
    expect(step.querySelector('[aria-label="Has a problem"]')).not.toBeNull()
    expect(row('List')!.querySelector('[aria-label="Has a problem"]')).toBeNull()
  })

  it('disables an operation the plan cannot take yet, with its reason', async () => {
    mount('d1')
    await settle()
    button('Add')!.click()
    await settle()
    const filter = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(item => item.textContent === 'Keep matching rows')!
    expect(filter.disabled).toBe(true)
    expect(filter.dataset.tip).toBe('Add a column first.')
  })

  it('closes on Escape', async () => {
    mount('d1')
    await settle()
    document.querySelector<HTMLElement>('.dash-studio')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
