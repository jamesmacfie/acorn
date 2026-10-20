import type { JSX } from 'solid-js'
import { render } from 'solid-js/web'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PanelPlan } from '@acorn/protocol/dashboards.ts'
import type { AgentToolCardProps } from '@acorn/protocol/extensionPoints.ts'

// The panel runs its plan and the studio is a full-window layer; neither is under test. The stand-in
// says which plan it was handed, so a test can tell versions apart.
vi.mock('./PublishedDashboardPanel', () => ({
  default: (props: { plan: PanelPlan; actions?: (published: () => undefined) => JSX.Element }) => (
    <div>
      <div class="stand-in">{props.plan.title}</div>
      {props.actions?.(() => undefined)}
    </div>
  ),
}))
vi.mock('./DashboardPanelHost', () => ({ default: () => null }))
vi.mock('@solidjs/router', () => ({ useNavigate: () => () => {}, useLocation: () => ({ pathname: '/' }) }))
vi.mock('../tasks/taskLookup', () => ({ taskById: () => ({ id: 'task-1', projectId: 'project' }) }))
vi.mock('../projects/projectLookup', () => ({ allProjects: () => [{ id: 'project', workspaceId: 'ws' }] }))

const { default: PanelToolCard } = await import('./PanelToolCard')

const plan = (title: string): PanelPlan => ({
  version: 2,
  title,
  time: { zone: 'UTC', mode: 'viewer', weekStart: 'monday' },
  sources: [
    {
      id: 'pulls',
      label: 'Pull requests',
      role: 'primary',
      reference: {
        kind: 'inline',
        bindings: {},
        content: {
          name: 'Pull requests',
          parameters: { type: 'object', properties: {}, additionalProperties: false },
          sourceParameters: {},
          query: { source: { pluginId: 'github', sourceId: 'pull-requests' }, scope: { parameters: {} }, sort: [] },
        },
      },
    },
  ],
  columns: [{ id: 'title', label: 'Title', type: 'text', bind: { pulls: { field: '/title' } } }],
  stages: [],
  view: { kind: 'list' },
})
type AgentToolCardCall = AgentToolCardProps['tool']
const call = (title: string, shownAt: number, tool: Partial<AgentToolCardCall> = {}): AgentToolCardCall => ({
  id: title,
  name: 'panel_show',
  title: 'panel_show',
  status: 'completed',
  input: JSON.stringify({ title, panelId: 'prs', plan: plan(title) }),
  // A result inside the MCP content envelope, as a harness records it.
  output: JSON.stringify({
    content: [{ type: 'text', text: JSON.stringify({ panelId: 'prs', shownAt, description: [] }) }],
  }),
  ...tool,
})

let dispose: (() => void) | undefined
afterEach(() => {
  dispose?.()
  document.body.replaceChildren()
})
const show = (calls: AgentToolCardCall[], taskId = 'task-1') => {
  const host = document.body.appendChild(document.createElement('div'))
  dispose = render(
    () => (
      <QueryClientProvider client={new QueryClient()}>
        {calls.map((tool) => (
          <PanelToolCard tool={tool} taskId={taskId} defaultOpen />
        ))}
      </QueryClientProvider>
    ),
    host,
  )
  return host
}
const button = (host: HTMLElement, text: string) =>
  [...host.querySelectorAll('button')].find((entry) => entry.textContent === text)
const menuRows = () =>
  [...document.querySelectorAll('.ui-menu > *')].map((entry) =>
    entry.matches('.ui-menu-separator')
      ? '-'
      : (entry.querySelector('.ui-menu-label')?.textContent ?? entry.textContent),
  )
const suppliedCall = (): AgentToolCardCall => {
  const supplied: PanelPlan = {
    ...plan('Forecast'),
    sources: [
      {
        id: 'pulls',
        label: 'Forecast',
        role: 'primary',
        reference: {
          kind: 'supplied',
          origin: { says: 'Open-Meteo', readAt: 1 },
          schema: { type: 'object', properties: { title: { type: 'string' } } },
          fields: [{ pointer: '/title', label: 'Title', origin: 'declared' }],
          rows: [{ title: 'Monday' }],
        },
      },
    ],
  }
  return { ...call('Forecast', 4), input: JSON.stringify({ title: 'Forecast', panelId: 'f', plan: supplied }) }
}

describe('PanelToolCard', () => {
  it('collapses an older version of the same panel to one line that can draw it again', () => {
    const host = show([call('By day', 1), call('By week', 2)])
    expect([...host.querySelectorAll('.stand-in')].map((entry) => entry.textContent)).toEqual(['By week'])
    expect(host.textContent).toContain('By day. Replaced by a newer version.')
    button(host, 'Show')!.click()
    expect([...host.querySelectorAll('.stand-in')].map((entry) => entry.textContent)).toEqual(['By day', 'By week'])
  })

  it('draws no panel for a plan that failed its checks', () => {
    const host = show(
      [
        call('Broken', 3, {
          output: '{"status":"api-error","detail":"400 /view/x: A bar chart needs an enum or person axis."}',
        }),
      ],
      'task-2',
    )
    expect(host.querySelector('.stand-in')).toBeNull()
    expect(host.textContent).toContain("Broken didn't pass its checks, so nothing was drawn.")
    expect(host.textContent).toContain('/view/x: A bar chart needs an enum or person axis.')
  })

  it('offers a live panel only its places, and supplied rows a snapshot or a sheet to keep them up to date', () => {
    const live = show([call('Pulls', 5)], 'task-3')
    button(live, 'Add to dashboard')!.click()
    expect(menuRows()).toEqual(['Home'])
    dispose?.()
    document.body.replaceChildren()

    const host = show([suppliedCall()], 'task-4')
    button(host, 'Add to dashboard')!.click()
    expect(menuRows()).toEqual(['Place as a snapshot', 'Home', '-', 'Keep it up to date', 'Home…'])
    ;[...document.querySelectorAll<HTMLButtonElement>('.ui-menu-item')].at(-1)!.click()
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Keep it up to date')
  })
})
