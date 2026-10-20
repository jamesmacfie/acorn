import { render } from 'solid-js/web'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { afterEach, expect, it, vi } from 'vitest'
import type { PanelPlan } from '@acorn/protocol/dashboards.ts'
import { panelGuideExamples } from '@acorn/dashboards-core/panelGuide.ts'

vi.mock('@solidjs/router', () => ({ useNavigate: () => () => {} }))
const run = vi.fn(() => new Promise(() => {}))
vi.mock('./dashboardClient', () => ({
  dashboardClient: () => ({ run, published: () => Promise.reject(new Error('no published revision')) }),
  publishedDashboardPanelKey: () => ['published-dashboard-panel'],
}))

const { default: PublishedDashboardPanel } = await import('./PublishedDashboardPanel')

let dispose: (() => void) | undefined
afterEach(() => dispose?.())

// An agent's card has a plan and no publication, so nothing may read the publication's id.
it('runs an unpublished plan as a draft, without a publication', () => {
  const plan = panelGuideExamples('ws-1')[0]!.plan
  const host = document.body.appendChild(document.createElement('div'))
  dispose = render(
    () => (
      <QueryClientProvider client={new QueryClient()}>
        <PublishedDashboardPanel
          definition={{ id: 'panel-1', title: 'By author', shaping: {}, view: plan.view }}
          workspaceId="ws-1"
          plan={plan}
        />
      </QueryClientProvider>
    ),
    host,
  )
  expect(host.querySelector('h3')?.textContent).toBe('By author')
  expect(run).toHaveBeenCalledWith(
    { kind: 'draft', content: plan },
    'execution',
    expect.any(String),
    expect.anything(),
    undefined,
    undefined,
  )
})

// Rows an agent supplied never pass for live data, and a value in them is only ever text.
it('draws supplied rows with where they came from, no Refresh, and HTML and javascript: links as text', async () => {
  const plan: PanelPlan = {
    version: 2,
    title: 'Pages',
    time: { zone: 'UTC', mode: 'fixed', weekStart: 'monday' },
    sources: [
      {
        id: 'pages',
        label: 'Pages',
        role: 'primary',
        reference: {
          kind: 'supplied',
          origin: { says: 'Open-Meteo forecast for Wellington', urls: ['https://open-meteo.com/'], readAt: 1 },
          schema: { type: 'object', properties: { name: { type: 'string' }, page: { type: 'string' } } },
          fields: [
            { pointer: '/name', label: 'Name', origin: 'declared' },
            { pointer: '/page', label: 'Page', origin: 'declared', display: { kind: 'link' } },
          ],
          rows: [{ name: '<img src=x onerror=alert(1)>', page: 'javascript:alert(1)' }],
        },
      },
    ],
    columns: [
      { id: 'name', label: 'Name', type: 'text', bind: { pages: { field: '/name' } } },
      { id: 'page', label: 'Page', type: 'link', bind: { pages: { field: '/page' } } },
    ],
    stages: [],
    view: { kind: 'table' },
  }
  const row = {
    id: 'pages:0',
    values: { name: '<img src=x onerror=alert(1)>', page: 'javascript:alert(1)' },
    records: [{ pluginId: 'core', sourceId: 'supplied', recordId: '0' }],
  }
  run.mockResolvedValueOnce({
    plan,
    rows: [row],
    groups: [],
    description: [],
    diagnostics: {
      problems: [],
      sources: [],
      stages: [],
      evaluationTime: 2,
      plugins: [],
      accounts: [],
      complete: true,
    },
  })
  const host = document.body.appendChild(document.createElement('div'))
  dispose = render(
    () => (
      <QueryClientProvider client={new QueryClient()}>
        <PublishedDashboardPanel
          definition={{ id: 'panel-2', title: 'Pages', shaping: {}, view: plan.view }}
          workspaceId="ws-1"
          plan={plan}
        />
      </QueryClientProvider>
    ),
    host,
  )
  await vi.waitFor(() => expect(host.textContent).toContain('javascript:alert(1)'))
  expect(host.textContent).toContain('From the agent: Open-Meteo forecast for Wellington, read ')
  expect(host.querySelector('a[href="https://open-meteo.com/"]')?.textContent).toBe('open-meteo.com')
  expect(host.querySelector('[aria-label="Refresh Pages"]')).toBeNull()
  expect(host.textContent).toContain('<img src=x onerror=alert(1)>')
  expect(host.querySelector('img')).toBeNull()
  expect(host.querySelector('a[href^="javascript"]')).toBeNull()
})

// An agent turn's row is a turn, and its target names the session, which is what the Agent pane selects.
it("selects the target's item when the record's target opens the same pane", async () => {
  const { paneItem } = await import('./PublishedDashboardPanel')
  const { contentLinkRegistry } = await import('../../host/registries/panes/contentLinks')
  const link = contentLinkRegistry.register({
    id: 'agents.session',
    providerId: 'agents',
    parse: () => null,
    target: (item) => ({ kind: 'agents.session', item, pane: 'agents' }),
  })
  try {
    const row = {
      id: 'turns:turn-1',
      sourceRowId: 'turn-1',
      values: {},
      pluginId: 'agents',
      sourceId: 'turns',
      recordItems: [
        {
          ref: { pluginId: 'agents', sourceId: 'turns', recordId: 'turn-1' },
          target: { kind: 'agents.session', item: 'session-1' },
        },
      ],
    }
    expect(paneItem(row, { verb: 'openPane', pane: 'agents' })).toBe('session-1')
    expect(paneItem(row, { verb: 'openPane', pane: 'board' })).toBe('turn-1')
    expect(paneItem({ ...row, recordItems: [] }, { verb: 'openPane', pane: 'agents' })).toBe('turn-1')
  } finally {
    link.dispose()
  }
})
