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
    if (path.includes('/integrations')) return { providers: [], integrations: [] }
    if (body?.operation === 'describe') return {
      revision: '1', consistency: 'fixture', schema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'], additionalProperties: true },
      fields: [{ pointer: '/title', label: 'Title', origin: 'declared', display: { kind: 'text', role: 'title' } }],
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
})
