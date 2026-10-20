import { afterEach, expect, it } from 'vitest'
import { render } from 'solid-js/web'
import type { DashboardRun } from '@acorn/dashboards-core/plan.ts'
import type { PanelPlan } from '@acorn/protocol/dashboards.ts'
import RunPanel from '@acorn/client-core/features/dashboards/RunPanel.tsx'

// The sidebar has no router, query client, or Node connection. This test fails if the dashboard's
// views come to need one.

let dispose: (() => void) | undefined
afterEach(() => {
  dispose?.()
  document.body.innerHTML = ''
})

const planFor = (view: PanelPlan['view']): PanelPlan => ({
  version: 2,
  title: 'Pull requests',
  time: { zone: 'UTC', mode: 'fixed', weekStart: 'monday' },
  sources: [
    {
      id: 'pulls',
      label: 'Pull requests',
      role: 'primary',
      reference: {
        kind: 'supplied',
        origin: { says: 'GitHub', readAt: 1 },
        schema: { type: 'object', properties: {} },
        fields: [],
        rows: [],
      },
    },
  ],
  columns: [
    { id: 'title', label: 'Title', type: 'text', bind: { pulls: { field: '/title' } } },
    { id: 'url', label: 'Link', type: 'link', bind: { pulls: { field: '/url' } } },
  ],
  stages: [],
  view,
})
const runOf = (plan: PanelPlan): DashboardRun => ({
  plan,
  rows: [
    {
      id: 'pulls:0',
      values: { title: 'Draw panels in the sidebar', url: 'https://github.com/acorn/acorn/pull/1' },
      records: [{ pluginId: 'core', sourceId: 'supplied', recordId: '0' }],
    },
  ],
  groups: [],
  description: [],
  diagnostics: { problems: [], sources: [], stages: [], evaluationTime: 1, plugins: [], accounts: [], complete: true },
})

it('draws a run with a link column, with the link as a plain link', () => {
  const plan = planFor({ kind: 'table' })
  dispose = render(() => <RunPanel plan={plan} run={runOf(plan)} />, document.body)
  expect(document.body.textContent).toContain('Draw panels in the sidebar')
  const link = document.querySelector('a.dash-cell-link')!
  expect(link.getAttribute('href')).toBe('https://github.com/acorn/acorn/pull/1')
  expect(link.getAttribute('target')).toBe('_blank')
})

it('draws a stat with a history trend, without the trend', () => {
  const plan = planFor({ kind: 'stat', trend: 'history' })
  dispose = render(() => <RunPanel plan={plan} run={runOf(plan)} panelId="panel-1" />, document.body)
  expect(document.querySelector('.dash-stat-value')?.textContent).toBe('1')
  expect(document.querySelector('.dash-stat-spark')).toBeNull()
})
