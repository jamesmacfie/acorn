import { afterEach, expect, it, vi } from 'vitest'
import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import type { PanelPlan } from '@acorn/protocol/dashboards.ts'
import type { BridgeAgentHint, BridgeAppSummary } from '@acorn/protocol/extensionBridge.ts'
import { CallFailure } from '../messages'
import { fakeBrowser, settle } from '../test/fakeBrowser'
import AppCard from './AppCard'
import type { BridgeClient } from './bridgeClient'

let dispose: (() => void) | undefined
afterEach(() => {
  dispose?.()
  document.body.replaceChildren()
  vi.useRealTimers()
})

const APP_ID = 'app-0123456789ab'
const plan: PanelPlan = {
  version: 2,
  title: 'Steps',
  time: { zone: 'UTC', mode: 'fixed', weekStart: 'monday' },
  sources: [
    {
      id: 'steps',
      label: 'Steps',
      role: 'primary',
      reference: { kind: 'inline', content: { query: { source: { pluginId: 'tracker', sourceId: 'steps' } } } },
    } as PanelPlan['sources'][number],
  ],
  columns: [{ id: 'title', label: 'Title', type: 'text', bind: { steps: { field: '/title' } } }],
  stages: [],
  view: { kind: 'table' },
}
const run = {
  plan,
  rows: [
    {
      id: 'steps:0',
      values: { title: 'Back up the database' },
      records: [{ pluginId: 'tracker', sourceId: 'steps', recordId: '0' }],
    },
    {
      id: 'steps:1',
      values: { title: 'Run the migration' },
      records: [{ pluginId: 'tracker', sourceId: 'steps', recordId: '1' }],
    },
  ],
  groups: [],
  description: ['Migration steps.'],
  diagnostics: { problems: [], sources: [], stages: [], evaluationTime: 2, plugins: [], accounts: [], complete: true },
}
// A Query, a Panel, a saved tick box, a link, an Ask the agent button, and a row action.
const CHECKLIST = [
  'root = Stack([List(@Each(steps.rows, "s", ListItem(s.title))), Panel("steps", {}), Checkbox("lint", "Lint passes", $lint), Checkbox("tests", "Tests pass", $tests), Button("Runbook", @OpenUrl("https://runbook.example/migrate?step=2")), Button("Ask", @ToAssistant("Which step failed?")), Button("Close", @Run(close))])',
  '$lint = false',
  '$tests = false',
  'steps = Query("steps", {}, {rows: []})',
  'close = Mutation("rowAction", {plan: "steps", row: "steps:0", action: "close"})',
].join('\n')

const summaryOf = (head: number, revisions: BridgeAppSummary['revisions'] = []): BridgeAppSummary => ({
  appId: APP_ID,
  name: 'Migration checklist',
  head,
  revisions: [
    ...Array.from({ length: head }, (_, index) => ({ revision: index + 1, note: `Revision ${index + 1}.` })),
    ...revisions,
  ].slice(0, head),
})

// A host that answers each app operation from `node`, and the requests it was sent.
function host(node: { head: number; state?: Record<string, unknown>; task?: null; restore?: () => Promise<unknown> }) {
  const requests: Record<string, any>[] = []
  const client: BridgeClient = {
    call: (async (call: Record<string, any>) => {
      requests.push(call)
      if (call.op === 'app.view')
        return {
          nodeId: 'n1',
          appId: APP_ID,
          revision: call.revision,
          summary: summaryOf(node.head),
          program: CHECKLIST,
          plans: ['steps'],
          task: node.task === null ? null : { id: 't1', title: 'Migrate billing', branch: 'migrate' },
        }
      if (call.op === 'app.run') return { nodeId: 'n1', appId: APP_ID, revision: call.revision, plan, run }
      if (call.op === 'app.state') return { nodeId: 'n1', appId: APP_ID, state: call.state ? null : (node.state ?? {}) }
      if (call.op === 'app.restore') return node.restore?.()
      throw new Error(`unexpected ${call.op}`)
    }) as BridgeClient['call'],
  }
  return { client, requests }
}

function mount(client: BridgeClient, options: { revision?: number; hint?: () => BridgeAgentHint | null } = {}) {
  const fake = fakeBrowser()
  const compose = vi.fn(async () => ({ ok: true }))
  const [restores, setRestores] = createSignal(0)
  const root = document.body.appendChild(document.createElement('div'))
  dispose = render(
    () => (
      <AppCard
        client={client}
        target={{ nodeId: 'n1', taskId: 't1', sessionId: 's1' }}
        appId={APP_ID}
        revision={options.revision ?? 1}
        note="Added owners"
        href={`acorn://n1/t/t1?pane=apps&item=${APP_ID}`}
        opensLinks={false}
        hint={options.hint?.() ?? null}
        reconnects={0}
        tabs={fake.api.tabs}
        compose={compose}
        restores={restores()}
        restored={() => setRestores((count) => count + 1)}
        line={<p>The named line</p>}
      />
    ),
    root,
  )
  return { root, fake, compose }
}
const button = (text: string) =>
  [...document.querySelectorAll('button')].find((candidate) => candidate.textContent === text)!
const boxes = (root: HTMLElement) => [...root.querySelectorAll<HTMLInputElement>('input[type=checkbox]')]

it("runs the app's query and panel through the host, and keeps a tick in the app's saved state", async () => {
  const { client, requests } = host({ head: 1, state: { $lint: true } })
  const { root } = mount(client)
  await vi.waitFor(() => expect(root.textContent).toContain('Run the migration'))
  expect(root.textContent).toContain('Migration checklist · v1')
  expect(root.querySelector('table')?.textContent).toContain('Back up the database')
  expect(requests.filter((request) => request.op === 'app.run')[0]).toEqual({
    op: 'app.run',
    nodeId: 'n1',
    taskId: 't1',
    appId: APP_ID,
    revision: 1,
    plan: 'steps',
    inputs: {},
    viewerZone: 'UTC',
  })
  expect(boxes(root).map((box) => box.checked)).toEqual([true, false])
  boxes(root)[1]!.click()
  await new Promise((resolve) => setTimeout(resolve, 450))
  const save = requests.find((request) => request.op === 'app.state' && request.state)
  expect(save).toMatchObject({ taskId: 't1', appId: APP_ID, state: { $lint: true, $tests: true } })
  expect(save!.key).toEqual(expect.any(String))
})

it('opens a link in a new tab after showing it in full, and puts Ask the agent text in the message box', async () => {
  const { client, requests } = host({ head: 1 })
  const { root, fake, compose } = mount(client)
  await vi.waitFor(() => expect(root.textContent).toContain('Run the migration'))
  button('Runbook').click()
  await settle()
  expect(document.body.textContent).toContain('https://runbook.example/migrate?step=2')
  expect(fake.createdTabs).toEqual([])
  button('Open').click()
  await settle()
  expect(fake.createdTabs).toEqual(['https://runbook.example/migrate?step=2'])
  button('Ask').click()
  await settle()
  expect(compose).toHaveBeenCalledWith('Which step failed?')
  expect(requests.some((request) => request.op === 'turn.submit')).toBe(false)
})

it('says a row action runs in the Acorn app', async () => {
  const { client } = host({ head: 1 })
  const { root } = mount(client)
  await vi.waitFor(() => expect(root.textContent).toContain('Run the migration'))
  button('Close').click()
  await vi.waitFor(() => expect(root.textContent).toContain('This action runs in the Acorn app.'))
})

it('collapses an older revision, draws it read only, and restores it with one key across retries', async () => {
  let fail = true
  const node = {
    head: 3,
    restore: async () => {
      if (fail) throw new CallFailure('ambiguous_mutation', 'The Node did not confirm the change.')
      node.head = 4
      return { nodeId: 'n1', appId: APP_ID, revision: 4 }
    },
  }
  const { client, requests } = host(node)
  const { root } = mount(client, { revision: 2 })
  await vi.waitFor(() => expect(root.textContent).toContain('v2: Added owners. Replaced by v3.'))
  expect(boxes(root)).toEqual([])
  button('Show v2').click()
  await vi.waitFor(() => expect(boxes(root)).toHaveLength(2))
  expect(boxes(root).every((box) => box.disabled)).toBe(true)
  expect(requests.some((request) => request.op === 'app.state')).toBe(false)

  button('Restore v2').click()
  await vi.waitFor(() => expect(root.textContent).toContain("Couldn't restore v2. Try again."))
  fail = false
  button('Restore v2').click()
  await settle()
  const restores = requests.filter((request) => request.op === 'app.restore')
  expect(restores).toHaveLength(2)
  expect(restores[1]).toEqual({ ...restores[0], key: restores[0]!.key })
  expect(restores[0]).toMatchObject({ taskId: 't1', appId: APP_ID, revision: 2 })
  // The restore reads the summary again, and this card stays collapsed behind the new head.
  await vi.waitFor(() => expect(root.textContent).toContain('v2: Added owners. Replaced by v4.'))
})

it("collapses when the session's hint brings a newer revision", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  const node = { head: 1 }
  const { client } = host(node)
  const [hint, setHint] = createSignal<BridgeAgentHint | null>(null)
  const { root } = mount(client, { hint })
  await vi.waitFor(() => expect(root.textContent).toContain('Migration checklist · v1'))
  node.head = 2
  setHint({ nodeId: 'n1', sessions: ['s1'], tasks: [], missed: false, requests: false })
  // A hint just after a read waits out the rest of the five seconds.
  vi.advanceTimersByTime(5_000)
  await vi.waitFor(() => expect(root.textContent).toContain('v1: Added owners. Replaced by v2.'))
})

it("draws one line for a task that's no longer active", async () => {
  const { client, requests } = host({ head: 1, task: null })
  const { root } = mount(client)
  await vi.waitFor(() =>
    expect(root.textContent).toContain("Migration checklist · v1. This task is archived, so the app isn't drawn."),
  )
  expect(requests.map((request) => request.op)).toEqual(['app.view'])
})

it('falls back to its named line on a host that has no app.view', async () => {
  const client: BridgeClient = {
    call: (async () => {
      throw new CallFailure('bad_request', 'Unknown operation.')
    }) as BridgeClient['call'],
  }
  const { root } = mount(client)
  await vi.waitFor(() => expect(root.textContent).toContain('Update the Acorn CLI to see this app here.'))
  expect(root.textContent).toContain('The named line')
})
