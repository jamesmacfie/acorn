import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QueryReference } from '@acorn/protocol/dataQueries.ts'

const requests = vi.fn<(path: string, options?: { body?: string }) => Promise<unknown>>()
vi.mock('../../infra/node/apiClient', () => ({
  ApiError: class ApiError extends Error {},
  readJson: (path: string, options?: { body?: string }) => requests(path, options),
  writeJson: (path: string, options?: { body?: string }) => requests(path, options),
}))

const { default: SourceQueryEditor } = await import('./SourceQueryEditor')

const initial: QueryReference = {
  kind: 'inline', bindings: {}, content: {
    name: 'Fixture', parameters: { type: 'object', properties: {}, additionalProperties: false }, sourceParameters: {},
    query: { source: { pluginId: 'fixture', sourceId: 'records' }, scope: { workspaceId: 'w', projectId: 'p', parameters: {} }, sort: [] },
  },
}

let host: HTMLDivElement
let dispose: (() => void) | undefined
let client: QueryClient
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

beforeEach(() => {
  requests.mockReset()
  requests.mockImplementation(async (path, options) => {
    const body = options?.body ? JSON.parse(options.body) as { operation?: string } : undefined
    if (path.endsWith('/data-sources/list')) return { sources: [{ pluginId: 'fixture', sourceId: 'records', name: 'Fixture records', singular: 'Record', plural: 'Records', identityScope: 'fixture' }], discoveries: [] }
    if (path.endsWith('/queries/list')) return []
    if (path.endsWith('/queries/resolve')) return { query: initial.content.query, parameters: {} }
    if (path.includes('/integrations')) return { providers: [], integrations: [] }
    if (body?.operation === 'describe') return {
      revision: '1', consistency: 'fixture', schema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'], additionalProperties: true },
      fields: [{ pointer: '/title', label: 'Title', origin: 'declared', display: { kind: 'text', role: 'title' }, query: { operators: ['eq'], sortable: false } }],
      parameters: { type: 'object', properties: { term: { type: 'string' } }, additionalProperties: false },
      parameterFields: [{ pointer: '/term', label: 'Search term', origin: 'declared' }],
      operations: { query: true, options: false, details: false, incremental: false, groups: ['all'] },
    }
    if (body?.operation === 'query') return {
      mode: 'preview', evaluationTime: 1, revision: '1', readTime: 1, completeness: { kind: 'complete' },
      records: [{ ref: { pluginId: 'fixture', sourceId: 'records', recordId: 'one' }, data: { title: '<img src=x>' }, display: { title: '<img src=x>' } }],
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
  document.querySelectorAll('.repo-picker-popover').forEach(element => element.remove())
  host.remove()
})

describe('SourceQueryEditor', () => {
  it('keeps the initial source placeholder neutral until records are chosen', async () => {
    const placeholder: QueryReference = {
      ...initial,
      content: {
        ...initial.content,
        query: {
          ...initial.content.query,
          source: { pluginId: 'core', sourceId: 'choose' },
        },
      },
    }
    dispose = render(() => <QueryClientProvider client={client}>
      <SourceQueryEditor workspaceId="w" projectId="p" value={placeholder} onChange={() => {}} pickSourceAccount />
    </QueryClientProvider>, host)
    await settle()
    await settle()

    expect(requests.mock.calls.filter(([, options]) => options?.body && JSON.parse(options.body).operation === 'describe')).toHaveLength(0)
    expect(host.textContent).not.toContain('This source is unavailable')
  })

  it('reports state to a parent that stores it without recursively observing that parent state', async () => {
    let updates = 0
    const Harness = () => {
      const [parentState, setParentState] = createSignal(0)
      return <SourceQueryEditor workspaceId="w" projectId="p" value={initial} onChange={() => {}}
        onStateChange={() => { updates += 1; setParentState(parentState() + 1) }} />
    }
    dispose = render(() => <QueryClientProvider client={client}><Harness /></QueryClientProvider>, host)
    await settle()
    await settle()
    expect(updates).toBeGreaterThan(0)
    expect(updates).toBeLessThan(10)
  })

  it('fetches metadata while typing but records only after explicit refresh, and renders record text safely', async () => {
    const Harness = () => {
      const [value, setValue] = createSignal<QueryReference | undefined>(initial)
      return <SourceQueryEditor workspaceId="w" projectId="p" value={value()} onChange={setValue} />
    }
    dispose = render(() => <QueryClientProvider client={client}><Harness /></QueryClientProvider>, host)
    await settle()
    await settle()
    const input = host.querySelector('input[aria-label="Search term"]') as HTMLInputElement
    expect(input).toBeTruthy()
    input.value = 'typed without fetching'
    input.dispatchEvent(new InputEvent('input', { bubbles: true }))
    await settle()
    expect(requests.mock.calls.filter(([, options]) => options?.body && JSON.parse(options.body).operation === 'query')).toHaveLength(0)

    const refresh = [...host.querySelectorAll('button')].find(button => button.textContent?.includes('Refresh preview'))!
    refresh.click()
    await settle()
    await settle()
    expect(requests.mock.calls.filter(([, options]) => options?.body && JSON.parse(options.body).operation === 'query')).toHaveLength(1)
    expect(host.textContent).toContain('<img src=x>')
    expect(host.querySelector('img')).toBeNull()
  })

  it('hides conditions and the preview for a consumer that has its own', async () => {
    const buttons = () => [...host.querySelectorAll('button')].map(button => button.textContent ?? '')
    dispose = render(() => <QueryClientProvider client={client}>
      <SourceQueryEditor workspaceId="w" projectId="p" value={initial} onChange={() => {}} hideConditions hidePreview previewOnOpen />
    </QueryClientProvider>, host)
    await settle()
    await settle()
    expect(host.querySelector('input[aria-label="Search term"]')).toBeTruthy()
    expect(buttons().some(text => text.includes('Add condition'))).toBe(false)
    expect(buttons().some(text => text.includes('Refresh preview'))).toBe(false)
    expect(requests.mock.calls.filter(([, options]) => options?.body && JSON.parse(options.body).operation === 'query')).toHaveLength(0)
  })

  it('shows conditions a query already has read-only when they are hidden', async () => {
    const filtered: QueryReference = { ...initial, content: { ...initial.content, query: { ...initial.content.query,
      predicate: { kind: 'all', predicates: [{ kind: 'comparison', left: { address: { from: 'item', pointer: '/title' } }, operator: 'eq', right: { address: { from: 'literal', value: 'x' } } }] },
    } } }
    dispose = render(() => <QueryClientProvider client={client}>
      <SourceQueryEditor workspaceId="w" projectId="p" value={filtered} onChange={() => {}} hideConditions />
    </QueryClientProvider>, host)
    await settle()
    await settle()
    expect(host.textContent).toContain('These conditions run inside the source.')
    const remove = [...host.querySelectorAll('button')].find(button => button.textContent === 'Remove condition') as HTMLButtonElement
    expect(remove.disabled).toBe(true)
  })

  it("lists only the workspace's repositories, as the Node resolves them, once Reach is the ones you choose", async () => {
    const chosen: QueryReference = { ...initial, content: { ...initial.content, query: { ...initial.content.query,
      scope: { workspaceId: 'w', connectionId: 'work', parameters: { repositories: ['org/old'] } } } } }
    const fallback = requests.getMockImplementation()!
    requests.mockImplementation(async (path, options) => {
      const body = options?.body ? JSON.parse(options.body) as { operation?: string; reference?: QueryReference } : undefined
      if (path.endsWith('/data-sources/list')) return { sources: [{ pluginId: 'fixture', sourceId: 'records', name: 'Pull requests', singular: 'Pull', plural: 'Pulls', identityScope: 'fixture', providerId: 'fixture' }], discoveries: [] }
      if (path.includes('/integrations')) return { providers: [], integrations: [{ id: 'work', providerId: 'fixture', label: 'Fixture', status: 'connected' }] }
      if (path.endsWith('/queries/resolve')) {
        const linked = body?.reference?.kind === 'inline' && body.reference.content.sourceParameters.repositories
        return { query: { ...chosen.content.query, scope: { ...chosen.content.query.scope, parameters: { repositories: linked ? ['org/a', 'org/b'] : ['org/old'] } } }, parameters: {} }
      }
      if (body?.operation === 'describe') return {
        revision: '1', consistency: 'fixture', schema: { type: 'object', properties: {}, additionalProperties: true }, fields: [],
        parameters: { type: 'object', properties: { repositories: { type: 'array', items: { type: 'string' } } }, additionalProperties: false },
        parameterFields: [{ pointer: '/repositories', label: 'Repositories', origin: 'declared', choices: { kind: 'dynamic', dependsOn: [] } }],
        operations: { query: true, options: true, details: false, incremental: false, groups: ['all'] },
        reach: { parameter: '/repositories', itemPlural: 'repositories', default: 'everything', empty: 'no linked repositories' },
      }
      return fallback(path, options)
    })
    dispose = render(() => <QueryClientProvider client={client}>
      <SourceQueryEditor workspaceId="w" value={chosen} onChange={() => {}} pickSourceAccount />
    </QueryClientProvider>, host)
    for (let tick = 0; tick < 6; tick++) await settle()
    const reach = host.querySelector<HTMLButtonElement>('[aria-label="Reach"]')!
    reach.click()
    await settle()
    expect([...document.querySelectorAll('[role="option"]')].map(option => option.textContent))
      .toEqual(["This workspace's repositories", 'Only the repositories I choose'])
    document.querySelector<HTMLButtonElement>('[role="option"][data-value="chosen"]')!.click()
    await settle()
    const trigger = [...host.querySelectorAll('button')].find(button => button.textContent?.includes('org/old')) as HTMLButtonElement
    trigger.click()
    await settle()
    const listed = document.body.textContent ?? ''
    expect(listed).toContain('org/a')
    expect(listed).toContain('org/b')
    // Nothing asked GitHub for every repository the account can see.
    expect(requests.mock.calls.some(([, options]) => options?.body && JSON.parse(options.body).operation === 'options')).toBe(false)
  })

  it('offers Add condition by default', async () => {
    dispose = render(() => <QueryClientProvider client={client}>
      <SourceQueryEditor workspaceId="w" projectId="p" value={initial} onChange={() => {}} />
    </QueryClientProvider>, host)
    await settle()
    await settle()
    expect([...host.querySelectorAll('button')].some(button => button.textContent === 'Add condition')).toBe(true)
  })
})
