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
const { clientEvents } = await import('../../../host/registries/commands/clientEvents')
const { _resetPluginDistribution, _seedPluginDistribution } = await import('../../../host/plugins/distribution')
const { activeCacheId } = await import('../../../infra/node/activeNode')

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
// A derived source whose one input reads GitHub, with no binding yet.
const readiness: PanelPlan = { ...filtered, title: 'Release readiness', stages: [], columns: [{ id: 'title', label: 'Title', type: 'text', bind: { ready: { field: '/title' } } }],
  sources: [{ id: 'ready', label: 'Release readiness', role: 'primary', reference: { kind: 'inline', bindings: {}, content: {
    name: 'Release readiness', parameters: { type: 'object', properties: {}, additionalProperties: false }, sourceParameters: {},
    query: { source: { pluginId: 'northwind', sourceId: 'readiness' }, scope: { workspaceId: 'w', parameters: {} }, sort: [] },
  } } }] }
const derivedCatalog = [
  { pluginId: 'github', sourceId: 'pull-requests', name: 'Pull requests', singular: 'Pull request', plural: 'Pull requests', identityScope: 'pull', providerId: 'github' },
  { pluginId: 'northwind', sourceId: 'readiness', name: 'Release readiness', singular: 'Issue', plural: 'Issues', identityScope: 'issue',
    inputs: { pulls: { source: 'github:pull-requests', label: 'Pull requests' } } },
]
const draft = (content: PanelPlan): DashboardDraft => ({ id: 'd1', workspaceId: 'w', content, draftRevision: 1, basePublishedRevision: null, publishedRevision: null, updatedAt: Date.now() } as DashboardDraft)

let host: HTMLDivElement
let dispose: (() => void) | undefined
let client: QueryClient
let opened: PanelPlan
let turnReply: () => Promise<unknown>
let catalog: unknown[]
let runProblems: unknown[]
let runSources: unknown[]
const onClose = vi.fn()
const settle = async (times = 3) => { for (let index = 0; index < times; index += 1) await new Promise(resolve => setTimeout(resolve, 0)) }
const button = (text: string) => [...document.querySelectorAll('button')].find(entry => entry.textContent?.trim() === text) as HTMLButtonElement | undefined
const row = (text: string) => [...document.querySelectorAll<HTMLElement>('.ui-row')].find(entry => entry.textContent?.includes(text))
const mount = (dashboardId?: string, start?: Parameters<typeof PanelStudio>[0]['start'], withAi?: boolean) => {
  dispose = render(() => <QueryClientProvider client={client}>
    <PanelStudio scope={{ surface: 'home', workspaceId: 'w' } as never} dashboardId={dashboardId} start={start} withAi={withAi} returnLabel="Home"
      onPublished={() => {}} onDeleted={() => {}} onClose={onClose} />
  </QueryClientProvider>, host)
}

beforeEach(() => {
  opened = invalid
  turnReply = () => new Promise(() => {})
  catalog = []
  runProblems = [{ path: '/stages/0', message: 'Filter names an unavailable column: title.', severity: 'error' }]
  runSources = []
  onClose.mockReset()
  requests.mockReset()
  requests.mockImplementation(async (path, options) => {
    const body = options?.body ? JSON.parse(options.body) as { operation?: string } : undefined
    if (path.endsWith('/dashboards/list')) return [draft({ ...invalid, title: 'Old idea' })]
    if (path.endsWith('/dashboards/get')) return draft(opened)
    // A copy, as from the wire: the query cache wraps what it's given, which would mark the fixtures.
    if (path.endsWith('/dashboards/run')) return {
      plan: structuredClone(opened), rows: [], groups: [],
      diagnostics: { problems: runProblems, sources: runSources, stages: [], evaluationTime: 0, plugins: [], accounts: [], complete: true },
    }
    if (path.endsWith('/data-sources/list')) return { sources: catalog, discoveries: [] }
    if (path.endsWith('/queries/list')) return []
    if (path.includes('/integrations')) return { providers: [], integrations: [] }
    if (path.endsWith('/models/backends')) return { backends: [{ id: 'harness:claude', kind: 'harness', label: 'Claude Code', models: [] }] }
    if (path.endsWith('/core/prefs')) return {}
    if (path.endsWith('/authoring/turn')) return turnReply()
    if (body?.operation === 'describe') return new Promise(() => {})
    throw new Error(`Unexpected ${path}`)
  })
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  host = document.createElement('div')
  document.body.append(host)
})
afterEach(() => {
  _resetPluginDistribution()
  dispose?.()
  client.clear()
  host.remove()
})

describe('PanelStudio', () => {
  it('opens a blank source with its Columns selected, without offering an old draft', async () => {
    mount(undefined, { kind: 'source', reference: tasks.reference })
    await settle()
    // The Columns part, with the picker that turns a field into a column.
    expect(document.querySelector('.dash-studio-inspector h3')?.textContent).toBe('Columns')
    expect(document.querySelector('.dash-studio-inspector')!.textContent).toContain('Add a field')
    expect(requests.mock.calls.some(([path]) => path.endsWith('/dashboards/list'))).toBe(false)
  })

  it('opens a request with the AI already asked', async () => {
    mount(undefined, { kind: 'describe', request: 'Tasks I touched today' })
    await settle(6)
    const turn = requests.mock.calls.find(([path]) => path.endsWith('/authoring/turn'))
    expect(turn && JSON.parse(turn[1]!.body!)).toMatchObject({ instruction: 'Tasks I touched today', context: [] })
    expect(document.querySelector('.dash-studio-inspector')!.textContent).toContain('Tasks I touched today')
    // With nothing selected, the inspector says how a panel's parts fit together.
    expect(document.querySelector('.dash-studio-inspector')!.textContent).toContain('A panel reads rows from a source')
    expect(button('Publish…')!.disabled).toBe(true)
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
    expect(document.querySelector('.dash-studio-inspector h3')?.textContent).toBe('Look')
    // Each view by name, with what it's for.
    expect(document.querySelector('.dash-studio-inspector')!.textContent).toContain('Each row as a title with a few details under it.')
  })

  it('marks a step that has a problem', async () => {
    opened = filtered
    mount('d1')
    await settle(6)
    const step = row('Keep where Title is')!
    expect(step.querySelector('[aria-label="Has a problem"]')).not.toBeNull()
    expect(row('List')!.querySelector('[aria-label="Has a problem"]')).toBeNull()
  })

  it("marks a derived source's input for its missing account, offers to connect one, and blocks publishing", async () => {
    opened = readiness
    catalog = derivedCatalog
    runProblems = [{ path: '/sources/0/reference/content/query/scope/inputs/pulls', message: 'Release readiness: input-required: input pulls', severity: 'error',
      failure: { code: 'input-required', source: 'northwind:readiness', input: 'pulls' } }]
    const settingsTabs: string[] = []
    const stop = clientEvents.on('presentation:open-settings', ({ tab }) => settingsTabs.push(tab))
    mount('d1')
    await settle(8)
    // The input has its own row under the source, and the problem marks it rather than the source.
    const input = row('no account chosen')!
    expect(input.textContent).toContain('Pull requests')
    expect(input.querySelector('[aria-label="Has a problem"]')).not.toBeNull()
    expect(row('Release readiness')!.querySelector('[aria-label="Has a problem"]')).toBeNull()
    expect(document.body.textContent).toContain('Pull requests needs a github account.')
    expect(document.body.textContent).not.toContain('input-required')

    input.click()
    await settle()
    expect(document.querySelector('.dash-studio-inspector')!.textContent).toContain('No github account is connected.')
    button('Connect github…')!.click()
    expect(settingsTabs).toEqual(['integrations'])
    stop()

    button('Publish…')!.click()
    await settle()
    expect([...document.querySelectorAll('[role="dialog"]')].at(-1)!.textContent).toContain('Fix these before publishing')
    expect(button('Publish')!.disabled).toBe(true)
  })

  it('shows a source in development: what it read, the records it dropped, and a warning before publishing', async () => {
    const bound = structuredClone(readiness)
    const reference = bound.sources[0]!.reference
    if (reference.kind === 'inline') reference.content.query.scope.inputs = { pulls: { connectionId: 'c1', parameters: {} } }
    opened = bound
    catalog = derivedCatalog
    runProblems = []
    runSources = [{ id: 'ready', label: 'Release readiness', completeness: { kind: 'incomplete', cause: 'invalid-records', count: 3 },
      inputs: { pulls: { records: 42, completeness: { kind: 'complete' } } },
      development: { inputMs: { pulls: 120 }, pluginMs: 30, dropped: [{ recordId: 'ENG-1', pointer: '/status', message: '"needs-qa" isn\'t a declared choice' }] } }]
    _seedPluginDistribution([[activeCacheId(), [{ name: 'northwind', required: false, disabled: false, running: true, state: 'active',
      development: { on: true, reloadedAt: Date.now() } }]]])
    const settingsTabs: string[] = []
    const stop = clientEvents.on('presentation:open-settings', ({ tab }) => settingsTabs.push(tab))
    mount('d1')
    await settle(8)

    expect(document.querySelector('.dash-studio [role="toolbar"]')!.textContent).toContain('Source in development')
    const strip = document.querySelector('[aria-label="northwind in development"]')!
    expect(strip.textContent).toContain('reloaded')
    expect(strip.textContent).toContain('pulls read 42 records in 120 ms · the run took 150 ms')
    expect(strip.textContent).toContain("3 records didn't match the declared fields")

    button('Show records')!.click()
    await settle()
    const table = document.querySelector('.dash-studio-detail table')!
    expect(table.textContent).toContain('ENG-1')
    expect(table.textContent).toContain('/status')
    expect(table.textContent).toContain('"needs-qa" isn\'t a declared choice')
    button('Back to the preview')!.click()
    await settle()
    expect(document.querySelector('.dash-studio-detail table')).toBeNull()

    button('Logs')!.click()
    expect(settingsTabs).toEqual(['plugins'])
    stop()

    button('Publish…')!.click()
    await settle()
    const review = [...document.querySelectorAll('[role="dialog"]')].at(-1)!
    expect(review.textContent).toContain('This panel reads a source in development. Others will see it change as you edit the plugin.')
    expect(review.textContent).not.toContain('Fix these before publishing')
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

  it('opens Edit with AI with the dock open and its box focused', async () => {
    mount('d1', undefined, true)
    await settle(6)
    expect(document.querySelector<HTMLElement>('.dash-studio-dock')!.hidden).toBe(false)
    expect(document.querySelector<HTMLElement>('.dash-studio-inspector')!.hidden).toBe(true)
    expect(document.activeElement).toBe(document.querySelector('.dash-studio-dock textarea'))
    button('Close')!.click()
    await settle()
    expect(document.querySelector<HTMLElement>('.dash-studio-inspector')!.hidden).toBe(false)
  })

  it('closes on Escape', async () => {
    mount('d1')
    await settle()
    document.querySelector<HTMLElement>('.dash-studio')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('reviews a proposal on the outline, with the inspector read-only and Publish off', async () => {
    opened = filtered
    const added: PanelPlan['stages'][number] = { op: 'filter', where: { kind: 'comparison', left: { address: { from: 'item', pointer: '/title' } }, operator: 'eq', right: { address: { from: 'literal', value: 'y' } } } }
    turnReply = async () => ({
      state: 'proposal', base: filtered, baseRevision: 1, candidate: { ...filtered, stages: [...filtered.stages, added] }, summary: 'Adds a filter.',
      diff: [], problems: [], context: [{ role: 'user', content: 'Add a filter' }], usage: { requests: 1, inputTokens: 1, outputTokens: 1 }, providerId: 'p', modelId: 'm',
    })
    mount('d1')
    await settle(6)
    row('List')!.click()
    await settle()
    expect(document.querySelector<HTMLElement>('.dash-studio-forms')!.inert).toBeFalsy()
    button('Ask AI')!.click()
    await settle()
    const field = document.querySelector<HTMLTextAreaElement>('.dash-studio-dock textarea')!
    field.value = 'Add a filter'
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await settle()
    button('Send')!.click()
    await settle(6)

    expect(document.body.textContent).toContain('Reviewing AI proposal')
    expect(row('Keep where Title is "y"')?.textContent).toContain('Added')
    expect(button('Publish…')!.disabled).toBe(true)
    expect(document.querySelector<HTMLElement>('.dash-studio-forms')!.inert).toBe(true)
    expect(document.querySelector('.dash-studio-inspector')!.textContent).toContain('Apply or discard the proposal to keep editing.')
    expect(document.body.textContent).toContain('Proposal: 1 step added')

    button('Discard')!.click()
    await settle()
    expect(document.body.textContent).not.toContain('Reviewing AI proposal')
    expect(row('Keep where Title is "y"')).toBeUndefined()
  })
})
