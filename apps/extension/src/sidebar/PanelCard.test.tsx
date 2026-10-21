import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import type { DashboardRun } from '@acorn/dashboards-core/plan.ts'
import type { PanelPlan } from '@acorn/protocol/dashboards.ts'
import type { BridgeAgentHint } from '@acorn/protocol/extensionBridge.ts'
import { CallFailure } from '../messages'
import { fakeBrowser, settle } from '../test/fakeBrowser'
import type { BridgeClient } from './bridgeClient'
import PanelCard from './PanelCard'

let dispose: (() => void) | undefined
afterEach(() => {
  dispose?.()
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const ISSUES = [
  { title: 'Fix the login', status: 'open', size: 'small', url: 'https://tracker.example/1' },
  { title: 'Write the docs', status: 'done', size: 'large', url: 'https://tracker.example/2' },
]
const planFor = (view: PanelPlan['view'], extra: Partial<PanelPlan> = {}): PanelPlan => ({
  version: 2,
  title: 'Issues',
  time: { zone: 'UTC', mode: 'fixed', weekStart: 'monday' },
  sources: [
    {
      id: 'issues',
      label: 'Issues',
      role: 'primary',
      reference: { kind: 'inline', content: { query: { source: { pluginId: 'tracker', sourceId: 'issues' } } } },
    } as PanelPlan['sources'][number],
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
    { id: 'url', label: 'Link', type: 'link', bind: { issues: { field: '/url' } } },
  ],
  stages: [],
  ...(view.kind === 'board' ? { group: [{ column: 'status' }] } : {}),
  view,
  ...extra,
})
const runOf = (plan: PanelPlan, rows: Partial<DashboardRun['rows'][number]>[] = []): DashboardRun => ({
  plan,
  rows: ISSUES.map((values, index) => ({
    id: `issues:${index}`,
    values,
    records: [{ pluginId: 'tracker', sourceId: 'issues', recordId: String(index) }],
    ...rows[index],
  })),
  groups: [],
  description: ['Issues by status.'],
  diagnostics: { problems: [], sources: [], stages: [], evaluationTime: 2, plugins: [], accounts: [], complete: true },
})

// A host that answers `panel.run` with `answer`, and the requests it was sent.
function hostAnswering(answer: () => Promise<unknown>) {
  const requests: Record<string, unknown>[] = []
  const client: BridgeClient = {
    call: (async (call: Record<string, unknown>) => {
      requests.push(call)
      return answer()
    }) as BridgeClient['call'],
  }
  return { client, requests }
}
const answering = (plan: PanelPlan, run = runOf(plan)) =>
  hostAnswering(async () => ({ nodeId: 'n1', sessionId: 's1', toolId: 'call-1', plan, run }))

function mount(client: BridgeClient, hint: () => BridgeAgentHint | null = () => null) {
  const fake = fakeBrowser()
  const root = document.body.appendChild(document.createElement('div'))
  dispose = render(
    () => (
      <PanelCard
        client={client}
        target={{ nodeId: 'n1', taskId: 't1', sessionId: 's1' }}
        toolId="call-1"
        title="Open issues"
        href="acorn://n1/t/t1?pane=agents&item=s1"
        opensLinks={false}
        hint={hint()}
        reconnects={0}
        tabs={fake.api.tabs}
        line={<p>The named line</p>}
      />
    ),
    root,
  )
  return { root, fake }
}

it.each<[PanelPlan['view'], (root: HTMLElement) => void]>([
  [{ kind: 'stat' }, (root) => expect(root.querySelector('.dash-stat-value')?.textContent).toBe('2')],
  [{ kind: 'list' }, (root) => expect(root.textContent).toContain('Write the docs')],
  [{ kind: 'table' }, (root) => expect(root.querySelector('table')?.textContent).toContain('Status')],
  [{ kind: 'board' }, (root) => expect(root.querySelector('.dash-board')?.textContent).toContain('Fix the login')],
  [{ kind: 'chart', shape: 'bar', x: 'status' }, (root) => expect(root.querySelector('[role="img"]')).not.toBeNull()],
  [
    { kind: 'heatmap', x: 'status', y: 'size' },
    (root) => expect(root.querySelectorAll('[role="gridcell"]')).toHaveLength(4),
  ],
])('runs the call and draws a %o run with its description', async (view, check) => {
  const { client, requests } = answering(planFor(view))
  const { root } = mount(client)
  await settle()
  expect(requests).toEqual([{ op: 'panel.run', nodeId: 'n1', sessionId: 's1', toolId: 'call-1', viewerZone: 'UTC' }])
  expect(root.querySelector('h3')?.textContent).toBe('Open issues')
  expect(root.textContent).toContain('Issues by status.')
  check(root)
})

it('sends nothing while scrolled out of view, and runs once it comes into view', async () => {
  let report!: (visible: boolean) => void
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
        report = (visible) => callback([{ isIntersecting: visible }])
      }
      observe() {}
      disconnect() {}
    },
  )
  const { client, requests } = answering(planFor({ kind: 'table' }))
  mount(client)
  report(false)
  await settle()
  expect(requests).toEqual([])
  report(true)
  await settle()
  expect(requests).toHaveLength(1)
})

it('opens link cells and link rows in a new tab, and offers Open in Acorn for a row that opens a task', async () => {
  const plan = planFor({ kind: 'table' })
  const { client } = answering(
    plan,
    runOf(plan, [{ action: { verb: 'openUrl', url: 'https://tracker.example/1' } }, { action: { verb: 'openTask' } }]),
  )
  const { root, fake } = mount(client)
  await settle()
  root.querySelector<HTMLAnchorElement>('a.dash-cell-link')!.click()
  const rows = root.querySelectorAll<HTMLElement>('tr[role="button"]')
  rows[0]!.click()
  expect(fake.createdTabs).toEqual(['https://tracker.example/1', 'https://tracker.example/1'])
  expect(root.textContent).not.toContain('That row opens in Acorn.')
  rows[1]!.click()
  expect(fake.createdTabs).toHaveLength(2)
  expect(root.textContent).toContain('That row opens in Acorn.')
})

it('does nothing for a press on a row whose own action is a Node route, which only the desktop calls', async () => {
  const plan = planFor({ kind: 'table' })
  const run = runOf(plan, [{ action: { verb: 'runNodeAction', path: '/close', risk: 'write' } }])
  const { client, requests } = answering(plan, run)
  const { root, fake } = mount(client)
  await settle()
  root.querySelectorAll<HTMLElement>('tr[role="button"]')[0]!.click()
  await settle()
  expect(requests).toHaveLength(1)
  expect(fake.createdTabs).toEqual([])
  expect(root.querySelector('[role="alert"]')).toBeNull()
})

describe('row actions', () => {
  const close = { id: 'close', label: 'Close issue', risk: 'write' as const, action: { verb: 'createTask' as const } }
  const plan = planFor(
    { kind: 'table' },
    { actions: { buttons: [{ kind: 'action', label: 'Close issue', actionId: 'close' }] } },
  )
  // A host that runs the panel, and answers each row action with the next of `acts`.
  function actingHost() {
    return hostAnswering(async () => ({
      nodeId: 'n1',
      sessionId: 's1',
      toolId: 'call-1',
      plan,
      run: runOf(plan, [{ actions: [close] }]),
    }))
  }
  const button = (text: string) =>
    [...document.querySelectorAll('button')].find((candidate) => candidate.textContent === text)
  const actButton = (root: HTMLElement) => root.querySelector<HTMLButtonElement>('button[aria-label="Close issue"]')!

  function host(...acts: (() => Promise<unknown>)[]) {
    const { client, requests } = actingHost()
    const answers = [...acts]
    const call = client.call
    client.call = (async (request: Record<string, unknown>) => {
      if (request.op !== 'row.act') return call(request as never)
      requests.push(request)
      return answers.shift()!()
    }) as BridgeClient['call']
    return { client, requests, acts: () => requests.filter((request) => request.op === 'row.act') }
  }

  it('confirms with the action and the row, sends nothing when declined, and runs again after', async () => {
    const { client, requests, acts } = host(async () => ({ nodeId: 'n1', outcome: 'done' }))
    const { root } = mount(client)
    await settle()
    actButton(root).click()
    await settle()
    expect(root.textContent).toContain('Close issue? Close issue on Fix the login. This can change something.')
    button('Cancel')!.click()
    await settle()
    expect(acts()).toEqual([])
    expect(root.textContent).not.toContain('This can change something.')

    actButton(root).click()
    await settle()
    button('Close issue')!.click()
    await settle()
    expect(acts()).toEqual([
      {
        op: 'row.act',
        nodeId: 'n1',
        target: { kind: 'panel', sessionId: 's1', toolId: 'call-1' },
        rowId: 'issues:0',
        actionId: 'close',
        confirmedRisk: 'write',
        viewerZone: 'UTC',
        key: expect.stringMatching(/^[0-9a-f-]{36}$/),
      },
    ])
    expect(requests.map((request) => request.op)).toEqual(['panel.run', 'row.act', 'panel.run'])
    expect(root.textContent).toContain('Action completed.')
  })

  it('opens a link the action answers with only after the link confirm', async () => {
    const { client } = host(async () => ({
      nodeId: 'n1',
      outcome: 'ready',
      action: { verb: 'openUrl', url: 'https://tracker.example/1/closed' },
    }))
    const { root, fake } = mount(client)
    await settle()
    actButton(root).click()
    await settle()
    button('Close issue')!.click()
    await settle()
    expect(root.textContent).toContain('Open this link? https://tracker.example/1/closed')
    expect(fake.createdTabs).toEqual([])
    button('Open')!.click()
    expect(fake.createdTabs).toEqual(['https://tracker.example/1/closed'])
  })

  it('keeps the key for a press again after an answer that never came, and only then', async () => {
    const { client, acts } = host(
      async () => {
        throw new CallFailure('ambiguous_mutation', 'The Node did not confirm the change.')
      },
      async () => ({ nodeId: 'n1', outcome: 'done' }),
      async () => ({ nodeId: 'n1', outcome: 'done' }),
    )
    const { root } = mount(client)
    await settle()
    for (let press = 0; press < 3; press++) {
      actButton(root).click()
      await settle()
      button('Close issue')!.click()
      await settle()
    }
    const keys = acts().map((request) => request.key)
    expect(root.textContent).toContain('Action completed.')
    expect(keys[1]).toBe(keys[0])
    expect(keys[2]).not.toBe(keys[0])
  })
})

it('keeps the last panel when a run fails, and says why above it', async () => {
  const plan = planFor({ kind: 'list' })
  let fail = false
  const { client } = hostAnswering(async () => {
    if (fail) throw new CallFailure('node_unreachable', 'The Node did not answer.')
    return { nodeId: 'n1', sessionId: 's1', toolId: 'call-1', plan, run: runOf(plan) }
  })
  const { root } = mount(client)
  await settle()
  fail = true
  root.querySelector<HTMLButtonElement>('button[aria-label="Refresh Open issues"]')!.click()
  await settle()
  expect(root.querySelector('[role="alert"]')?.textContent).toContain('The Node is not answering.')
  expect(root.textContent).toContain('Write the docs')
})

it('falls back to its named line on a host that has no panel.run', async () => {
  const { client } = hostAnswering(async () => {
    throw new CallFailure('bad_request', 'Unknown operation.')
  })
  const { root } = mount(client)
  await settle()
  expect(root.textContent).toBe('The named lineUpdate the Acorn CLI to see this panel here.')
})

it('runs again for a hint naming its session at most once every five seconds', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  const [hint, setHint] = createSignal<BridgeAgentHint | null>(null)
  const { client, requests } = answering(planFor({ kind: 'list' }))
  mount(client, hint)
  await vi.advanceTimersByTimeAsync(0)
  expect(requests).toHaveLength(1)
  const busy = { nodeId: 'n1', sessions: ['s1'], tasks: [], missed: false, requests: false }
  setHint({ ...busy })
  setHint({ ...busy })
  setHint({ ...busy, sessions: ['other'] })
  await vi.advanceTimersByTimeAsync(4_000)
  expect(requests).toHaveLength(1)
  await vi.advanceTimersByTimeAsync(1_000)
  expect(requests).toHaveLength(2)
})
