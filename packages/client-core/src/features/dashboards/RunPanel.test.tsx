import { createSignal, type JSX } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, expect, it, vi } from 'vitest'
import type { DashboardRun } from '@acorn/dashboards-core/plan.ts'
import type { PanelPlan } from '@acorn/protocol/dashboards.ts'
import RunPanel from './RunPanel'

// This file mounts no router, query client, or view host. RunPanel draws from its props alone.

let dispose: (() => void) | undefined
afterEach(() => {
  dispose?.()
  document.body.replaceChildren()
})

const ISSUES = [
  { title: 'Fix the login', status: 'open', size: 'small', points: 3 },
  { title: 'Write the docs', status: 'done', size: 'large', points: 5 },
]
const planFor = (view: PanelPlan['view']): PanelPlan => ({
  version: 2,
  title: 'Issues',
  time: { zone: 'UTC', mode: 'fixed', weekStart: 'monday' },
  sources: [
    {
      id: 'issues',
      label: 'Issues',
      role: 'primary',
      reference: {
        kind: 'supplied',
        origin: { says: 'The issue tracker', readAt: 1 },
        schema: { type: 'object', properties: {} },
        fields: [],
        rows: ISSUES,
      },
    },
  ],
  columns: [
    { id: 'title', label: 'Title', type: 'text', bind: { issues: { field: '/title' } } },
    {
      id: 'status',
      label: 'Status',
      type: 'enum',
      choices: [
        { id: 'open', label: 'Open' },
        { id: 'done', label: 'Done' },
      ],
      bind: { issues: { field: '/status' } },
    },
    {
      id: 'size',
      label: 'Size',
      type: 'enum',
      choices: [
        { id: 'small', label: 'Small' },
        { id: 'large', label: 'Large' },
      ],
      bind: { issues: { field: '/size' } },
    },
    { id: 'points', label: 'Points', type: 'number', bind: { issues: { field: '/points' } } },
  ],
  stages: [],
  ...(view.kind === 'board' ? { group: [{ column: 'status' }] } : {}),
  view,
})
const runOf = (plan: PanelPlan): DashboardRun => ({
  plan,
  rows: ISSUES.map((values, index) => ({
    id: `issues:${index}`,
    values,
    records: [{ pluginId: 'core', sourceId: 'supplied', recordId: String(index) }],
  })),
  groups: [],
  description: ['Issues by status.'],
  diagnostics: { problems: [], sources: [], stages: [], evaluationTime: 2, plugins: [], accounts: [], complete: true },
})

const draw = (panel: () => JSX.Element): HTMLElement => {
  const host = document.body.appendChild(document.createElement('div'))
  dispose = render(panel, host)
  return host
}

it.each<[PanelPlan['view'], (host: HTMLElement) => void]>([
  [{ kind: 'stat' }, (host) => expect(host.querySelector('.dash-stat-value')?.textContent).toBe('2')],
  [{ kind: 'list' }, (host) => expect(host.textContent).toContain('Write the docs')],
  [{ kind: 'table' }, (host) => expect(host.querySelector('table')?.textContent).toContain('Points')],
  [
    { kind: 'board' },
    (host) => {
      expect(host.querySelector('.dash-board')?.textContent).toContain('Open')
      expect(host.textContent).toContain('Fix the login')
    },
  ],
  [{ kind: 'chart', shape: 'bar', x: 'status' }, (host) => expect(host.querySelector('[role="img"]')).not.toBeNull()],
  [
    { kind: 'heatmap', x: 'status', y: 'size' },
    (host) => expect(host.querySelectorAll('[role="gridcell"]')).toHaveLength(4),
  ],
])('draws a %o run', (view, check) => {
  const plan = planFor(view)
  const host = draw(() => <RunPanel plan={plan} run={runOf(plan)} />)
  expect(host.textContent).not.toContain("Can't")
  check(host)
})

it.each<PanelPlan['view']>([{ kind: 'list' }, { kind: 'table' }])('draws a later run’s rows in a %o', (view) => {
  const plan = planFor(view)
  const [run, setRun] = createSignal(runOf(plan))
  const host = draw(() => <RunPanel plan={plan} run={run()} />)
  const first = run()
  setRun({
    ...first,
    rows: first.rows.map((row) => ({ ...row, values: { ...row.values, title: `${row.values.title} again` } })),
  })
  expect(host.textContent).toContain('Fix the login again')
})

it.each<PanelPlan['view']>([{ kind: 'list' }, { kind: 'table' }])(
  'keeps a row’s element across a refetch that returns the same rows in a %o',
  (view) => {
    const plan = planFor(view)
    const [run, setRun] = createSignal(runOf(plan))
    const host = draw(() => <RunPanel plan={plan} run={run()} />)
    // The row's own element: the table row, or the list row that holds the title.
    const rowFor = (title: string) =>
      [...host.querySelectorAll('*')]
        .find((element) => element.children.length === 0 && element.textContent === title)
        ?.closest('tr, .ui-row')
    const before = rowFor('Write the docs')
    expect(before).toBeDefined()
    // A refetch is a new object for every row, as the query gives them back.
    setRun(structuredClone(run()))
    expect(rowFor('Write the docs')).toBe(before)
    setRun({ ...run(), rows: run().rows.map((row) => ({ ...row, values: { ...row.values, points: 9 } })) })
    expect(rowFor('Write the docs')).toBe(before)
    expect(rowFor('Write the docs')?.textContent).toContain('9')
  },
)

it('says where supplied rows came from before the run arrives, and what an unread plan shows after', () => {
  const plan = planFor({ kind: 'table' })
  const host = draw(() => <RunPanel plan={plan} run={undefined} describe />)
  expect(host.textContent).toContain('From the agent: The issue tracker, read ')
  expect(host.textContent).toContain('Loading…')
  dispose?.()

  const answered = draw(() => <RunPanel plan={plan} run={runOf(plan)} describe />)
  expect(answered.textContent).toContain('Issues by status.')
  expect(answered.textContent).not.toContain('Loading…')
})

it('draws the failed states, the problems, and a stale run', () => {
  const plan = planFor({ kind: 'table' })
  const onRetry = vi.fn()
  const failed = draw(() => <RunPanel plan={plan} run={undefined} error onRetry={onRetry} />)
  expect(failed.textContent).toContain("Couldn't load this panel")
  ;[...failed.querySelectorAll('button')].find((button) => button.textContent === 'Try again')!.click()
  expect(onRetry).toHaveBeenCalled()
  dispose?.()

  const stale = draw(() => (
    <RunPanel plan={plan} run={runOf(plan)} error stale problems={<p>The tracker is offline.</p>}>
      <p>Action completed.</p>
    </RunPanel>
  ))
  expect(stale.textContent).toContain("Couldn't refresh. Showing the last data we got.")
  expect(stale.textContent).toContain('The tracker is offline.')
  expect(stale.textContent).toContain('Action completed.')
  const data = stale.querySelector('.dash-panel-data')!
  expect(data.hasAttribute('data-stale')).toBe(true)
  expect(data.textContent).toContain('Fix the login')
})
