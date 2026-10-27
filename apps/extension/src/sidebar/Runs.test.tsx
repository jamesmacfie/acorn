import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'solid-js/web'
import type {
  BridgeAgentSession,
  BridgeWorkflow,
  BridgeWorkflowRun,
  BridgeWorkflowStep,
} from '@acorn/protocol/extensionBridge.ts'
import { startBackground } from '../background/background'
import { fakeBrowser, settle } from '../test/fakeBrowser'
import { back, button, conversationTitle, pickFrom, runRows, stepRows, tab } from '../test/sidebarUi'
import { App } from './App'

let dispose: (() => void) | undefined
afterEach(() => {
  dispose?.()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

type Request = Record<string, unknown> & { id: string; op: string }

const PAGE = 'https://app.example/'

const session = (id: string): BridgeAgentSession => ({
  id,
  taskId: 't1',
  title: `Chat ${id}`,
  providerId: 'claude',
  profileId: 'claude-code',
  model: null,
  kind: 'workflow',
  inline: false,
  btw: false,
  runtimeState: 'working',
  attention: 'none',
  lastEventSeq: 0,
  archivedAt: null,
  updatedAt: 1,
})
const run = (id: string, name: string, status: string): BridgeWorkflowRun => ({
  id,
  name,
  status,
  createdAt: Date.now() - 60_000,
  updatedAt: Date.now(),
})
const step = (id: string, status: string, sessionId: string | null = null): BridgeWorkflowStep => ({
  id,
  name: id,
  status,
  createdAt: 0,
  updatedAt: 1_000,
  session: sessionId ? session(sessionId) : null,
})

const WORKFLOWS: BridgeWorkflow[] = [
  { id: 'triage', name: 'Triage', inputs: [] },
  { id: 'fix', name: 'Fix an issue', inputs: [{ name: 'issue', label: 'Issue', required: true }] },
]

// One Node whose task t1 holds the page. Its runs, each run's steps, and how workflow.start answers
// are in `state`. A start adds a running run at the top.
function mount() {
  const fake = fakeBrowser()
  fake.activeTab = { id: 7, windowId: 1, url: PAGE, title: 'App' }
  const state = {
    runs: [run('run-2', 'Fix an issue', 'running'), run('run-1', 'Triage', 'done')] as BridgeWorkflowRun[],
    steps: {
      'run-2': [step('plan', 'done', 'w-plan'), step('implement', 'running', 'w-impl'), step('review', 'pending')],
      'run-1': [step('triage', 'done', 'w-triage')],
    } as Record<string, BridgeWorkflowStep[]>,
    // How many starts in a row the Node leaves unconfirmed.
    lostStarts: 0,
    requests: [] as Request[],
  }
  const answer = (request: Request): unknown => {
    switch (request.op) {
      case 'nodes.list':
      case 'node.select':
        return {
          nodes: [{ nodeId: 'n1', label: 'Studio', endpoint: 'https://n1.test', local: false }],
          activeNodeId: 'n1',
          status: { nodeId: 'n1', state: 'online' },
        }
      case 'handoffs.list':
        return { nodeId: 'n1', handoffs: [], panels: [], icons: [] }
      case 'tasks.pages':
        return {
          nodeId: 'n1',
          tasks: [
            {
              id: 't1',
              title: 'Webhook retries',
              branch: null,
              projectId: 'p1',
              pages: [{ origin: 'https://app.example', pathPrefix: '/', source: 'app' }],
            },
          ],
        }
      case 'projects.list':
        return { nodeId: 'n1', projects: [{ id: 'p1', name: 'Billing', path: null, hidden: false }], workspaces: [] }
      case 'sessions.list':
        return { nodeId: 'n1', taskId: request.taskId, sessions: [] }
      case 'workflow.runs':
        return { nodeId: 'n1', taskId: request.taskId, runs: state.runs }
      case 'workflow.steps':
        return { nodeId: 'n1', runId: request.runId, steps: state.steps[request.runId as string] ?? [] }
      case 'workflows.list':
        return { nodeId: 'n1', projectId: request.projectId, workflows: WORKFLOWS }
      case 'workflow.start': {
        const started = WORKFLOWS.find((workflow) => workflow.id === request.defId)!
        const runId = `run-${state.runs.length + 1}`
        state.runs = [run(runId, started.name, 'running'), ...state.runs]
        state.steps[runId] = [step('plan', 'running', `w-${runId}`)]
        return { nodeId: 'n1', taskId: request.taskId, runId }
      }
      case 'session.read':
        return {
          nodeId: 'n1',
          sessionId: request.sessionId,
          session: session(request.sessionId as string),
          records: [],
          reach: 0,
          queued: [],
          requests: [],
        }
    }
    return undefined
  }
  fake.onNativeMessage = (raw, host) => {
    const request = raw as Request
    state.requests.push(request)
    if (request.op === 'workflow.start' && state.lostStarts > 0) {
      state.lostStarts--
      return host.send({ v: 1, id: request.id, ok: false, error: { code: 'ambiguous_mutation', message: 'lost' } })
    }
    host.send({ v: 1, id: request.id, ok: true, result: answer(request) })
  }
  startBackground(fake.api, 'com.acorn.browser_bridge')
  const root = document.createElement('div')
  document.body.append(root)
  dispose = render(() => <App api={fake.api} opensLinks />, root)
  return { state, root }
}

// The task's Runs tab, open.
async function openRuns() {
  const mounted = mount()
  await settle(30)
  await tab(mounted.root, 'Runs')
  await settle(20)
  return mounted
}

const runNames = (root: HTMLElement) => runRows(root).map((row) => row.querySelector('.ui-row-body')!.textContent)
const opened = (root: HTMLElement) => runRows(root).map((row) => row.getAttribute('aria-expanded') === 'true')
const starts = (state: ReturnType<typeof mount>['state']) =>
  state.requests.filter((request) => request.op === 'workflow.start')

describe('the Runs tab', () => {
  it('lists the runs with the newest open, and opens and closes each', async () => {
    const { root } = await openRuns()
    expect(root.querySelector('.view[aria-label="Runs"] .section-header')!.textContent).toContain('Runs2')
    expect(runNames(root)).toEqual(['Fix an issue', 'Triage'])
    expect(opened(root)).toEqual([true, false])
    expect(stepRows(root, 'Fix an issue').map((row) => row.querySelector('.ui-row-body')!.textContent)).toEqual([
      'plan',
      'implement',
      'review',
    ])
    expect(stepRows(root, 'Triage')).toEqual([])
    // More than one can be open.
    runRows(root)[1]!.click()
    await settle(20)
    expect(opened(root)).toEqual([true, true])
    expect(stepRows(root, 'Triage')).toHaveLength(1)
    runRows(root)[0]!.click()
    await settle(20)
    expect(opened(root)).toEqual([false, true])
    expect(stepRows(root, 'Fix an issue')).toEqual([])
  })

  it("opens a step's conversation, and Back returns to Runs; a step with none does nothing", async () => {
    const { root } = await openRuns()
    const [, implement, review] = stepRows(root, 'Fix an issue')
    // The running step turns, and has a chevron to its conversation.
    expect(implement!.querySelector('.ui-row-leading [data-spin]')).not.toBeNull()
    expect(implement!.getAttribute('role')).toBe('button')
    expect(implement!.querySelector('.ui-row-trailing')).not.toBeNull()
    // A step not started has nothing to open, and reads dimmer.
    expect(review!.getAttribute('role')).toBeNull()
    expect(review!.querySelector('.ui-row-trailing')).toBeNull()
    expect(review!.querySelector('.ui-text[data-emphasis="muted"]')).not.toBeNull()
    review!.click()
    await settle(20)
    expect(conversationTitle(root)).toBeNull()
    implement!.click()
    await settle(30)
    expect(conversationTitle(root)).toBe('implement')
    await back(root)
    expect(root.querySelector('.view[aria-label="Runs"]')).not.toBeNull()
    expect(opened(root)).toEqual([true, false])
  })

  it('starts a workflow with no inputs at once, open at the top with the others closed', async () => {
    const { root, state } = await openRuns()
    runRows(root)[1]!.click()
    await settle(20)
    await pickFrom(root, 'Run workflow', 'Triage')
    await settle(30)
    expect(starts(state)).toMatchObject([{ taskId: 't1', defId: 'triage' }])
    expect(starts(state)[0]!.inputs).toBeUndefined()
    expect(runNames(root)).toEqual(['Triage', 'Fix an issue', 'Triage'])
    expect(opened(root)).toEqual([true, false, false])
    // A second run of the same workflow is a new run, not the first one again.
    await pickFrom(root, 'Run workflow', 'Triage')
    await settle(30)
    const keys = starts(state).map((request) => request.key)
    expect(new Set(keys).size).toBe(2)
  })

  it("asks for a workflow's inputs before it starts", async () => {
    const { root, state } = await openRuns()
    await pickFrom(root, 'Run workflow', 'Fix an issue')
    expect(starts(state)).toEqual([])
    const issue = root.querySelector<HTMLTextAreaElement>('textarea[name="input-issue"]')!
    expect(root.querySelector('.run-form .ui-field-label')!.textContent).toBe('Workflow')
    expect(button(root, 'Start run')!.disabled).toBe(true)
    // Cancel closes the form and starts nothing.
    button(root, 'Cancel')!.click()
    await settle()
    expect(root.querySelector('textarea[name="input-issue"]')).toBeNull()
    await pickFrom(root, 'Run workflow', 'Fix an issue')
    const typed = root.querySelector<HTMLTextAreaElement>('textarea[name="input-issue"]')!
    expect(typed).not.toBe(issue)
    typed.value = 'Retries never back off'
    typed.dispatchEvent(new Event('input', { bubbles: true }))
    await settle()
    button(root, 'Start run')!.click()
    await settle(30)
    expect(starts(state)).toMatchObject([{ taskId: 't1', defId: 'fix', inputs: { issue: 'Retries never back off' } }])
    expect(root.querySelector('textarea[name="input-issue"]')).toBeNull()
    expect(runNames(root)[0]).toBe('Fix an issue')
    expect(opened(root)).toEqual([true, false, false])
  })

  it('starts again with the same key after the Node left the start unconfirmed', async () => {
    const { root, state } = await openRuns()
    state.lostStarts = 1
    await pickFrom(root, 'Run workflow', 'Triage')
    await settle(30)
    expect(root.textContent).toContain("The Node didn't confirm the run.")
    expect(runNames(root)).toEqual(['Fix an issue', 'Triage'])
    await pickFrom(root, 'Run workflow', 'Triage')
    await settle(30)
    const keys = starts(state).map((request) => request.key)
    expect(keys).toHaveLength(2)
    expect(new Set(keys).size).toBe(1)
    expect(runNames(root)).toEqual(['Triage', 'Fix an issue', 'Triage'])
  })

  it('shows an empty state with Run workflow for a task with no run', async () => {
    const mounted = mount()
    mounted.state.runs = []
    await settle(30)
    await tab(mounted.root, 'Runs')
    await settle(20)
    const empty = mounted.root.querySelector('.view[aria-label="Runs"] .ui-empty')!
    expect(empty.querySelector('.ui-empty-title')!.textContent).toBe('No runs in this task')
    await pickFrom(mounted.root, 'Run workflow', 'Triage')
    await settle(30)
    expect(runNames(mounted.root)).toEqual(['Triage'])
    expect(opened(mounted.root)).toEqual([true])
  })
})
