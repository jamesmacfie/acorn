import { render } from 'solid-js/web'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DashboardDraft, PanelPlan } from '@acorn/protocol/dashboards.ts'
import type { PanelRegion } from '../region'
import type { LaunchResult } from './PanelLauncher'

const requests = vi.fn<(path: string, options?: { body?: string }) => Promise<unknown>>()
vi.mock('../../../infra/node/apiClient', () => ({
  ApiError: class ApiError extends Error {},
  readJson: (path: string, options?: { body?: string }) => requests(path, options),
  writeJson: (path: string, options?: { body?: string }) => requests(path, options),
}))

const { default: PanelLauncher } = await import('./PanelLauncher')

// A starter as a source ships it: no workspace and no account.
const starter: PanelPlan = {
  version: 2, title: 'My open pull requests', time: { zone: 'UTC', mode: 'viewer', weekStart: 'monday' },
  sources: [{ id: 'pulls', label: 'Pull requests', role: 'primary', reference: { kind: 'inline', bindings: {}, content: {
    name: 'Pull requests', parameters: { type: 'object', properties: {}, additionalProperties: false }, sourceParameters: {},
    query: { source: { pluginId: 'github', sourceId: 'pull-requests' }, scope: { parameters: {} }, sort: [] },
  } } }],
  columns: [{ id: 'title', label: 'Title', type: 'text', bind: { pulls: { field: '/title' } } }], stages: [], view: { kind: 'list' },
}
const draft = (id: string, title: string, updatedAt: number, publishedRevision: number | null = null): DashboardDraft => ({
  id, workspaceId: 'w', content: { ...starter, title }, draftRevision: 1, basePublishedRevision: null, publishedRevision, createdAt: 1, updatedAt,
})

let drafts: DashboardDraft[]
let host: HTMLDivElement
let dispose: (() => void) | undefined
let client: QueryClient
const onLaunch = vi.fn<(result: LaunchResult) => void>()
const settle = async (times = 4) => { for (let index = 0; index < times; index += 1) await new Promise(resolve => setTimeout(resolve, 0)) }
const button = (text: string) => [...document.querySelectorAll('button')].find(entry => entry.textContent?.trim() === text) as HTMLButtonElement | undefined
const row = (text: string) => [...document.querySelectorAll<HTMLElement>('.ui-row')].find(entry => entry.textContent?.includes(text))
const bodies = (operation: string) => requests.mock.calls.flatMap(([path, options]) => path.endsWith(`/${operation}`) && options?.body ? [JSON.parse(options.body) as Record<string, unknown>] : [])
const select = (label: string) => document.querySelector<HTMLButtonElement>(`button.ui-select[aria-label="${label}"]`)
const choose = (label: string, value: string) => {
  const native = select(label)!.previousElementSibling as HTMLSelectElement
  native.value = value
  native.dispatchEvent(new Event('change', { bubbles: true }))
}
const mount = (region?: PanelRegion) => {
  dispose = render(() => <QueryClientProvider client={client}>
    <PanelLauncher workspaceId="w" {...(region ? { region } : {})} onLaunch={onLaunch} onDismiss={() => {}} />
  </QueryClientProvider>, host)
}

beforeEach(() => {
  drafts = []
  onLaunch.mockReset()
  requests.mockReset()
  requests.mockImplementation(async (path, options) => {
    const body = options?.body ? JSON.parse(options.body) as { operation?: string } : undefined
    if (path.endsWith('/data-sources/list')) return { discoveries: [], sources: [
      { pluginId: 'core', sourceId: 'tasks', name: 'Workspace tasks', singular: 'Task', plural: 'Tasks', identityScope: 'task' },
      { pluginId: 'github', sourceId: 'pull-requests', name: 'Pull requests', singular: 'Pull request', plural: 'Pull requests', identityScope: 'pull', providerId: 'github' },
      { pluginId: 'linear', sourceId: 'issues', name: 'Issues', singular: 'Issue', plural: 'Issues', identityScope: 'issue', providerId: 'linear' },
      { pluginId: 'northwind', sourceId: 'readiness', name: 'Release readiness', singular: 'Issue', plural: 'Issues', identityScope: 'issue', inputs: {
        pulls: { source: 'github:pull-requests', label: 'Pull requests' },
        cycle: { source: 'linear:issues', label: 'Cycle issues' },
        backlog: { source: 'linear:issues', label: 'Backlog', optional: true },
      } },
    ] }
    if (path.endsWith('/core/integrations')) return { providers: [], integrations: [
      { id: 'work', providerId: 'github', name: 'Work', label: 'GitHub', status: 'connected' },
      { id: 'acme', providerId: 'linear', name: 'Acme', label: 'Linear', status: 'connected' },
      { id: 'beta', providerId: 'linear', name: 'Beta', label: 'Linear', status: 'connected' },
    ] }
    if (path.endsWith('/models/backends')) return { backends: [{ id: 'harness:claude', kind: 'harness', label: 'Claude Code', models: [] }] }
    if (path.endsWith('/core/prefs')) return {}
    if (path.endsWith('/queries/list')) return []
    if (path.endsWith('/dashboards/list')) return drafts
    if (path.endsWith('/dashboards/validate')) return { problems: [] }
    if (path.endsWith('/dashboards/delete')) { drafts = drafts.slice(1); return { ok: true } }
    if (body?.operation === 'describe') return {
      revision: '1', consistency: 'fixture', schema: { type: 'object', properties: { title: { type: 'string' } } },
      fields: [{ pointer: '/title', label: 'Title', origin: 'declared', display: { kind: 'text', role: 'title' } }],
      parameters: { type: 'object', properties: {}, additionalProperties: false }, parameterFields: [],
      operations: { query: true, options: false, details: false, incremental: false, groups: ['all'] }, starterPlans: [starter],
    }
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

describe('PanelLauncher', () => {
  it('returns a request to draft with AI', async () => {
    mount()
    await settle()
    const box = document.querySelector<HTMLTextAreaElement>('.ui-composer textarea')!
    box.value = 'Pull requests waiting on me'
    box.dispatchEvent(new InputEvent('input', { bubbles: true }))
    button('Draft it')!.click()
    expect(onLaunch).toHaveBeenCalledWith({ kind: 'describe', request: 'Pull requests waiting on me' })
  })

  it("moves a starter onto the picked row's workspace and account", async () => {
    mount()
    await settle()
    row('Pull requests · github · Work')!.click()
    await settle(8)
    expect(bodies('describe')[0]).toMatchObject({ scope: { workspaceId: 'w', connectionId: 'work' } })
    row('My open pull requests')!.click()
    const result = onLaunch.mock.calls[0]![0] as Extract<LaunchResult, { kind: 'source' }>
    expect(result.kind).toBe('source')
    const source = result.starter!.sources[0]!.reference
    expect(source.kind === 'inline' && source.content.query.scope).toEqual({ workspaceId: 'w', connectionId: 'work', parameters: {} })
    // What the Node checked is the plan the studio opens, not the unscoped original.
    expect(bodies('validate')[0]!.content).toEqual(result.starter)
  })

  it('suggests starter titles from sources described earlier, and a suggestion only fills the box', async () => {
    mount()
    await settle()
    expect(document.querySelector('.ui-chip')).toBeNull()
    row('Pull requests · github · Work')!.click()
    await settle(8)
    dispose?.()
    mount()
    await settle()
    const chip = [...document.querySelectorAll<HTMLButtonElement>('.ui-chip')].find(entry => entry.textContent === 'My open pull requests')!
    chip.click()
    await settle()
    expect(document.querySelector<HTMLTextAreaElement>('.ui-composer textarea')!.value).toBe('My open pull requests')
    expect(onLaunch).not.toHaveBeenCalled()
  })

  it('starts blank from a source without a starter', async () => {
    mount()
    await settle()
    row('Workspace tasks')!.click()
    await settle(8)
    row('Blank')!.click()
    expect(onLaunch).toHaveBeenCalledWith({ kind: 'source', reference: expect.objectContaining({ kind: 'inline' }) })
    expect((onLaunch.mock.calls[0]![0] as { starter?: PanelPlan }).starter).toBeUndefined()
  })

  it('picks an account per input, starting on the only one, and holds the starters until each required input has one', async () => {
    mount()
    await settle()
    row('Release readiness · northwind · reads github and linear')!.click()
    await settle(8)
    // GitHub has one account, so its input starts on it. Linear has two, so the person picks.
    expect(select('Pull requests')!.textContent).toContain('Work')
    expect(select('Cycle issues')!.textContent).toContain('Choose an account…')
    expect(select('Backlog (optional)')!.textContent).toContain('Skip')
    expect(document.body.textContent).toContain('Choose an account for each input to start.')
    row('Blank')!.click()
    expect(onLaunch).not.toHaveBeenCalled()

    choose('Cycle issues', 'acme')
    // Skip takes an optional input back out.
    choose('Backlog (optional)', 'beta')
    choose('Backlog (optional)', '')
    await settle(8)
    row('Blank')!.click()
    const result = onLaunch.mock.calls[0]![0] as Extract<LaunchResult, { kind: 'source' }>
    const reference = result.reference
    expect(reference.kind === 'inline' && reference.content.query.scope).toEqual({ workspaceId: 'w', parameters: {}, inputs: {
      pulls: { connectionId: 'work', parameters: {} }, cycle: { connectionId: 'acme', parameters: {} },
    } })
  })

  it("lists only a plugin region's own sources", async () => {
    mount({ pluginId: 'github', max: 4 })
    await settle()
    expect(row('Pull requests')).toBeDefined()
    expect(row('Workspace tasks')).toBeUndefined()
  })

  it('lists unfinished drafts newest first, three at a time, and discards one', async () => {
    drafts = [draft('d4', 'Fourth', 40), draft('d3', 'Third', 30), draft('d2', 'Second', 20), draft('d1', 'First', 10), draft('placed', 'Placed', 50, 1)]
    mount()
    await settle()
    const text = () => document.body.textContent ?? ''
    expect(text()).toContain('Fourth')
    expect(text()).not.toContain('First')
    expect(text()).not.toContain('Placed')
    button('and 1 more')!.click()
    expect(text()).toContain('First')
    button('Continue')!.click()
    expect(onLaunch).toHaveBeenCalledWith({ kind: 'draft', dashboardId: 'd4' })
    button('Discard')!.click()
    button('Discard draft?')!.click()
    await settle()
    expect(bodies('delete')[0]).toMatchObject({ id: 'd4', expectedRevision: 1 })
    expect(text()).not.toContain('Fourth')
  })
})
