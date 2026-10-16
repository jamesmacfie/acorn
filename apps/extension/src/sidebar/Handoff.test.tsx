import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'solid-js/web'
import type {
  BridgeAgentSession,
  BridgeHandoffItem,
  BridgePageTask,
  BridgeWorkflowStep,
} from '@acorn/protocol/extensionBridge.ts'
import { startBackground } from '../background/background'
import { fakeBrowser, settle } from '../test/fakeBrowser'
import {
  back,
  button,
  chosen,
  conversationTitle,
  goHome,
  idle,
  openChat,
  openSettings,
  siteList,
  siteSwitch,
  openTask,
  pickFrom,
  runRows,
  shownTask,
  stepRows,
  tab,
  taskTabs,
} from '../test/sidebarUi'
import { App } from './App'

let dispose: (() => void) | undefined
afterEach(() => {
  dispose?.()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

type Request = Record<string, unknown> & { id: string; op: string }

const handoff = {
  pluginId: 'tracker',
  id: 'item',
  label: 'Open in Acorn',
  match: ['https://tracker.example/items/{id}'],
  anchors: ['.actions'],
}
const PAGE = 'https://tracker.example/items/42'

const item = (over: Partial<BridgeHandoffItem> = {}): BridgeHandoffItem => ({
  identifier: 'acme/widget#42',
  url: PAGE,
  title: 'Fix the flaky test',
  connection: { id: 'conn-1', label: 'Tracker' },
  projects: [
    { id: 'p1', name: 'Widget' },
    { id: 'p2', name: 'Widget (clone)' },
  ],
  linkedTasks: [],
  context: { label: 'Tracker item acme/widget#42', content: 'The test waits on a timer.' },
  ...over,
})

const session = (id: string, taskId: string): BridgeAgentSession => ({
  id,
  taskId,
  title: `Chat ${id}`,
  providerId: 'claude',
  profileId: 'claude-code',
  model: null,
  kind: 'interactive',
  inline: false,
  runtimeState: 'ready',
  attention: 'none',
  lastEventSeq: 0,
  archivedAt: null,
  updatedAt: 1,
})

// One Node with two projects. Tasks and sessions are whatever the test puts in `state`.
function mount(options: { items?: BridgeHandoffItem[]; url?: string; opensLinks?: boolean } = {}) {
  const fake = fakeBrowser()
  fake.activeTab = { id: 7, windowId: 1, url: options.url ?? 'https://elsewhere.example/', title: 'Page' }
  const state = {
    items: options.items ?? [item()],
    tasks: { p1: [{ id: 't1', title: 'Existing work', branch: null }], p2: [] } as Record<string, unknown[]>,
    sessions: { t1: [session('s1', 't1')] } as Record<string, BridgeAgentSession[]>,
    requests: [] as Request[],
    // The Node's tasks and their pages. A new task holds the item, so the page becomes its page.
    pageTasks: [{ id: 't1', title: 'Existing work', branch: null, projectId: 'p1', pages: [] }] as BridgePageTask[],
    steps: [] as BridgeWorkflowStep[],
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
        return { nodeId: 'n1', handoffs: [handoff], panels: [] }
      case 'handoff.resolve':
        return { nodeId: 'n1', url: request.url, items: state.items }
      case 'handoff.create': {
        const task = { id: 't-new', title: 'Fix the flaky test', branch: 'fix', projectId: request.projectId as string }
        state.tasks[request.projectId as string] = [...state.tasks[request.projectId as string]!, task]
        state.pageTasks = [
          ...state.pageTasks,
          { ...task, pages: [{ origin: 'https://tracker.example', pathPrefix: '/items/42', source: 'tracker' }] },
        ]
        return { nodeId: 'n1', task, created: true }
      }
      case 'tasks.pages':
        return { nodeId: 'n1', tasks: state.pageTasks }
      case 'workflows.list':
        return {
          nodeId: 'n1',
          projectId: request.projectId,
          workflows: [
            {
              id: 'review',
              name: 'PR review',
              inputs: [
                { name: 'issue', required: true },
                { name: 'focus', description: 'What to look at first' },
              ],
            },
          ],
        }
      case 'workflow.start':
        return { nodeId: 'n1', taskId: request.taskId, runId: 'run-1' }
      case 'workflow.runs':
        return {
          nodeId: 'n1',
          taskId: request.taskId,
          runs:
            request.taskId === 't-new'
              ? [{ id: 'run-1', name: 'PR review', status: 'done', createdAt: 1, updatedAt: 2 }]
              : [],
        }
      case 'workflow.steps':
        return { nodeId: 'n1', runId: request.runId, steps: state.steps }
      case 'projects.list':
        return {
          nodeId: 'n1',
          projects: [
            { id: 'p1', name: 'Widget', path: null, hidden: false, workspaceId: 'w1' },
            { id: 'p2', name: 'Widget (clone)', path: null, hidden: false, workspaceId: 'w1' },
          ],
          workspaces: [{ id: 'w1', name: 'Main' }],
        }
      case 'tasks.list':
        return { nodeId: 'n1', projectId: request.projectId, tasks: state.tasks[request.projectId as string] ?? [] }
      case 'sessions.list':
        return { nodeId: 'n1', taskId: request.taskId, sessions: state.sessions[request.taskId as string] ?? [] }
      case 'session.read': {
        const row = Object.values(state.sessions)
          .flat()
          .find((candidate) => candidate.id === request.sessionId)
        return {
          nodeId: 'n1',
          sessionId: request.sessionId,
          session: row,
          records: [],
          reach: 0,
          queued: [],
          requests: [],
        }
      }
      case 'agents.choices':
        return {
          nodeId: 'n1',
          choices: [
            {
              providerId: 'claude',
              profileId: 'claude-code',
              customAgentId: null,
              account: null,
              label: 'Claude Code',
              text: 'Claude Code',
              description: 'Available',
              glyph: null,
              accountIcon: null,
              available: true,
            },
          ],
        }
      case 'session.create': {
        const created = session('s-new', request.taskId as string)
        state.sessions[request.taskId as string] = [created]
        return { nodeId: 'n1', session: created }
      }
      case 'turn.submit':
        return { nodeId: 'n1', sessionId: request.sessionId, turnId: 'turn-1' }
    }
    return undefined
  }
  fake.onNativeMessage = (raw, host) => {
    const request = raw as Request
    state.requests.push(request)
    host.send({ v: 1, id: request.id, ok: true, result: answer(request) })
    // As the Node announces a new task, so the page's task list is read again.
    if (request.op === 'handoff.create') host.send({ v: 1, event: 'tasks', nodeId: 'n1' })
  }
  startBackground(fake.api, 'com.acorn.browser_bridge')
  const root = document.createElement('div')
  document.body.append(root)
  dispose = render(() => <App api={fake.api} opensLinks={options.opensLinks} />, root)
  return { fake, state, root }
}

const openTab = (root: HTMLElement) =>
  root.querySelector('[role="tablist"][aria-label="Task"] [aria-selected="true"]')?.textContent ?? null
const captures = (root: HTMLElement) =>
  [...root.querySelectorAll('[data-testid="capture"]')].map((row) => row.textContent)
const card = (root: HTMLElement) => root.querySelector('[aria-label="Handoff"]')
// The item waiting on the open task's Agents tab.
const pendingItem = (root: HTMLElement) => root.querySelector('[aria-label="Pending item"]')?.textContent ?? null
const resolvedUrls = (state: { requests: Request[] }) =>
  state.requests.filter((request) => request.op === 'handoff.resolve').map((request) => request.url)

// Starts the first chat in the open task from its empty state's picker, then sends a message.
async function chatAndSend(root: HTMLElement) {
  await pickFrom(root, 'Start a chat', 'Claude Code')
  await settle(30)
  const box = root.querySelector<HTMLTextAreaElement>('textarea[name="message"]')!
  // A chat just started puts the cursor in its message box.
  expect(document.activeElement).toBe(box)
  box.value = 'Look into it'
  box.dispatchEvent(new Event('input', { bubbles: true }))
  root
    .querySelector('[aria-label="Conversation"] form.composer')!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await settle(30)
}

// A choice from the task chip's Start task menu, as the background reports it once the panel is open.
async function clickSiteButton(fake: ReturnType<typeof fakeBrowser>, start: 'task' | 'workflow' = 'task') {
  fake.activeTab = { ...fake.activeTab, url: PAGE }
  fake.activate()
  fake.storage.set('handoffs', { nodeId: 'n1', handoffs: [handoff] })
  await settle()
  fake.sendFromPage({ type: 'acorn:handoff', key: 'tracker:item', start })
  await settle(20)
}

describe('a handoff in the sidebar', () => {
  it('shows the task that holds the item, which opens it', async () => {
    const { fake, root, state } = mount({
      items: [item({ linkedTasks: [{ id: 't1', title: 'Existing work', projectId: 'p1' }] })],
    })
    await settle(20)
    await clickSiteButton(fake)
    expect(card(root)!.textContent).toContain('acme/widget#42')
    expect(state.requests.find((request) => request.op === 'handoff.resolve')).toMatchObject({ url: PAGE })
    // A task holds the item, so there is nothing to start.
    expect(button(root, 'Create task')).toBeUndefined()
    const linked = root.querySelector<HTMLElement>('[aria-label="Linked tasks"] .ui-row')!
    expect(linked.textContent).toContain('Existing work')
    expect(linked.textContent).toContain('Widget')
    linked.click()
    await settle(30)
    expect(shownTask(root)).toBe('Existing work')
    // Nothing went to an agent, and nothing waits in the task.
    expect(state.requests.some((request) => request.op === 'turn.submit')).toBe(false)
    expect(pendingItem(root)).toBeNull()
  })

  it('creates the task and opens Agents with the item, which goes with the first message', async () => {
    const { fake, root, state } = mount()
    await settle(20)
    await clickSiteButton(fake)
    // The card says nothing a button already says.
    expect(card(root)!.textContent).not.toContain(PAGE)
    expect(button(root, 'Dismiss')).toBeUndefined()
    expect(chosen(root, 'Project')).toBe('Widget')
    await pickFrom(root, 'Project', 'Widget (clone)')
    button(root, 'Create task')!.click()
    await settle(40)
    expect(state.requests.find((request) => request.op === 'handoff.create')).toMatchObject({
      identifier: 'acme/widget#42',
      connectionId: 'conn-1',
      projectId: 'p2',
      url: PAGE,
    })
    expect(shownTask(root)).toBe('Fix the flaky test')
    expect(openTab(root)).toBe('Agents')
    expect(pendingItem(root)).toBe('Item · Fix the flaky testGoes with your first message.')
    // No conversation was started, and nothing went to an agent.
    expect(state.requests.some((request) => request.op === 'session.create' || request.op === 'turn.submit')).toBe(
      false,
    )

    // A new chat takes the item into its composer, and the first message sends it.
    await chatAndSend(root)
    const submit = state.requests.find((request) => request.op === 'turn.submit')!
    expect(JSON.stringify(submit.input)).toContain('The test waits on a timer.')
    expect(fake.storage.get('pendingItem:n1:t-new')).toBeUndefined()
    await back(root)
    expect(pendingItem(root)).toBeNull()
  })

  it('sends nothing extra once the item is removed', async () => {
    const { fake, root, state } = mount()
    await settle(20)
    await clickSiteButton(fake)
    button(root, 'Create task')!.click()
    await settle(40)
    button(root.querySelector('[aria-label="Pending item"]')!, 'Remove')!.click()
    await settle(20)
    expect(pendingItem(root)).toBeNull()
    expect(fake.storage.get('pendingItem:n1:t-new')).toBeUndefined()
    await chatAndSend(root)
    const submit = state.requests.find((request) => request.op === 'turn.submit')!
    expect(JSON.stringify(submit.input)).not.toContain('The test waits on a timer.')
  })

  it("keeps the item with its own task, so another task's chat doesn't get it", async () => {
    const { fake, root, state } = mount()
    await settle(20)
    await clickSiteButton(fake)
    button(root, 'Create task')!.click()
    await settle(40)
    expect(pendingItem(root)).not.toBeNull()
    await openTask(root, 'Existing work')
    expect(pendingItem(root)).toBeNull()
    await openChat(root, 'Chat s1')
    expect(captures(root)).toEqual([])
    // It still waits in its own task, after the panel closes and opens again too.
    dispose?.()
    root.remove()
    const again = document.createElement('div')
    document.body.append(again)
    dispose = render(() => <App api={fake.api} />, again)
    await settle(40)
    await openTask(again, 'Fix the flaky test')
    expect(pendingItem(again)).toContain('Fix the flaky test')
    // Archiving the task drops it.
    state.pageTasks = state.pageTasks.filter((task) => task.id !== 't-new')
    fake.hosts.at(-1)!.send({ v: 1, event: 'tasks', nodeId: 'n1' })
    await settle(40)
    expect(again.querySelector('.view[aria-label="Home"]')).not.toBeNull()
    expect(fake.storage.get('pendingItem:n1:t-new')).toBeUndefined()
  })

  it("starts a workflow in a new task with what the item fills in, then opens a step's conversation", async () => {
    const { fake, root, state } = mount()
    state.steps = [
      {
        id: 'step-1',
        name: 'Explain the PR',
        status: 'done',
        createdAt: 0,
        updatedAt: 88_000,
        session: session('w1', 't-new'),
      },
      { id: 'step-2', name: 'Final analysis', status: 'pending', createdAt: 0, updatedAt: 0, session: null },
    ]
    state.sessions['t-new'] = [{ ...session('w1', 't-new'), kind: 'workflow' }]
    await settle(20)
    await clickSiteButton(fake)
    expect(state.requests.find((request) => request.op === 'workflows.list')).toMatchObject({ projectId: 'p1' })
    // Run workflow lists the project's workflows under its name.
    button(root, 'Run workflow')!.click()
    await settle()
    expect(
      [...document.querySelectorAll('.repo-picker-popover :is(.repo-picker-group, .repo-picker-name > span)')].map(
        (row) => row.textContent,
      ),
    ).toEqual(['Widget', 'PR review'])
    button(root, 'Run workflow')!.click()
    await settle()
    await pickFrom(root, 'Run workflow', 'PR review')
    expect(chosen(root, 'Workflow')).toBe('PR review')
    expect(button(root, 'Create task')).toBeUndefined()
    // The item's title and context fill `issue` by the desktop's rule; `focus` is left to the person,
    // with its description as the placeholder rather than a line under the field.
    const input = (name: string) => root.querySelector<HTMLTextAreaElement>(`textarea[name="input-${name}"]`)!
    expect(input('issue').value).toBe('Fix the flaky test\n\nThe test waits on a timer.')
    expect(input('issue').required).toBe(true)
    expect(input('focus').value).toBe('')
    expect(input('focus').placeholder).toBe('What to look at first')
    expect(card(root)!.textContent).not.toContain('What to look at first')
    expect([...card(root)!.querySelectorAll('.ui-field-label')].map((label) => label.textContent)).toEqual([
      'Project',
      'Workflow',
      'issue *',
      'focus',
    ])
    expect(root.textContent).not.toContain('straight away')
    button(root, 'Start run')!.click()
    await settle(60)
    expect(state.requests.find((request) => request.op === 'workflow.start')).toMatchObject({
      taskId: 't-new',
      defId: 'review',
      inputs: { issue: 'Fix the flaky test\n\nThe test waits on a timer.' },
    })
    expect(shownTask(root)).toBe('Fix the flaky test')
    expect(taskTabs(root)).toEqual(['Agents', 'Runs'])
    expect(openTab(root)).toBe('Runs')
    // The started run is open, with its steps under it.
    expect(runRows(root).map((row) => row.getAttribute('aria-expanded'))).toEqual(['true'])
    const steps = () => stepRows(root, 'PR review')
    expect(steps().map((row) => row.textContent)).toEqual(['Explain the PR1m28s', 'Final analysis'])
    // A step that hasn't run has no conversation to open.
    expect(steps().map((row) => row.getAttribute('role'))).toEqual(['button', null])
    steps()[0]!.click()
    await settle(30)
    expect(conversationTitle(root)).toBe('Explain the PR')
    expect(root.querySelector('header .eyebrow')!.textContent).toBe('PR review')
    // Back from a step's conversation opens Runs.
    await back(root)
    expect(openTab(root)).toBe('Runs')
    expect(steps()).toHaveLength(2)
  })

  it('starts the task and its workflow again with the same keys after the Node left the run unconfirmed', async () => {
    const { fake, root, state } = mount()
    let failStart = true
    const answer = fake.onNativeMessage
    fake.onNativeMessage = (raw, host) => {
      const request = raw as Request
      if (request.op !== 'workflow.start' || !failStart) return answer(raw, host)
      failStart = false
      state.requests.push(request)
      host.send({ v: 1, id: request.id, ok: false, error: { code: 'ambiguous_mutation', message: 'lost' } })
    }
    await settle(20)
    // The chip's Start workflow menu choice opens the card on the project's first workflow.
    await clickSiteButton(fake, 'workflow')
    await settle(20)
    expect(chosen(root, 'Workflow')).toBe('PR review')
    button(root, 'Start run')!.click()
    await settle(30)
    expect(root.textContent).toContain("The Node didn't confirm the run.")
    button(root, 'Start run')!.click()
    await settle(40)
    const keys = (op: string) => state.requests.filter((request) => request.op === op).map((request) => request.key)
    expect(new Set(keys('handoff.create')).size).toBe(1)
    expect(keys('workflow.start')).toHaveLength(2)
    expect(new Set(keys('workflow.start')).size).toBe(1)
    expect(openTab(root)).toBe('Runs')
  })

  it('cancels the workflow part, and picks between several items on one page', async () => {
    const { fake, root } = mount({
      items: [item(), item({ identifier: 'acme/widget#43', title: 'Speed up the build' })],
    })
    await settle(20)
    await clickSiteButton(fake, 'workflow')
    await settle(20)
    button(root, 'Cancel')!.click()
    await settle()
    expect(root.querySelector('textarea[name="input-issue"]')).toBeNull()
    expect(button(root, 'Create task')).toBeDefined()
    expect(chosen(root, 'Item')).toBe('acme/widget#42')
    await pickFrom(root, 'Item', 'acme/widget#43')
    expect(card(root)!.querySelector('.item-title')!.textContent).toBe('Speed up the build')
  })

  it('opens the item in Acorn through an acorn:// link in a release build', async () => {
    const { fake, root } = mount({ opensLinks: true })
    await settle(20)
    await clickSiteButton(fake)
    const followed: string[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      followed.push(this.href)
    })
    // No task holds the item, so the desktop finds what claims its address.
    button(card(root)!, 'Open in Acorn')!.click()
    expect(followed).toEqual([`acorn://n1/open?url=${encodeURIComponent(PAGE)}`])
  })

  it('copies the Acorn link instead of opening it in a development build', async () => {
    const writeText = vi.fn(async () => {})
    Object.assign(navigator, { clipboard: { writeText } })
    const { fake, root } = mount()
    await settle(20)
    await clickSiteButton(fake)
    expect(root.querySelector('a')).toBeNull()
    button(root, 'Copy Acorn link')!.click()
    await settle()
    expect(writeText).toHaveBeenCalledWith(`acorn://n1/open?url=${encodeURIComponent(PAGE)}`)
    expect(button(root, 'Copied')).toBeDefined()
  })

  it('looks up the page beside it when no button could be drawn', async () => {
    const { root, state } = mount({ url: PAGE })
    await settle(30)
    expect(state.requests.filter((request) => request.op === 'handoff.resolve')).toHaveLength(1)
    expect(root.textContent).toContain('acme/widget#42')
  })

  it('looks the item up again when the tab moves to another item', async () => {
    const { fake, root, state } = mount({ url: PAGE })
    await settle(30)
    expect(card(root)).not.toBeNull()
    fake.navigate('https://tracker.example/items/43')
    await settle(20)
    expect(card(root)).not.toBeNull()
    expect(resolvedUrls(state)).toEqual([PAGE, 'https://tracker.example/items/43'])
  })

  it("closes the card when the tab leaves the item, unless the person typed a workflow's input", async () => {
    const { fake, root, state } = mount()
    await settle(20)
    await clickSiteButton(fake)
    expect(card(root)).not.toBeNull()
    // The item it left closes; Home looks up the one the tab moved to.
    fake.navigate('https://tracker.example/items/43')
    await settle(20)
    expect(card(root)).not.toBeNull()
    expect(resolvedUrls(state).at(-1)).toBe('https://tracker.example/items/43')

    await clickSiteButton(fake, 'workflow')
    await settle(20)
    const focus = root.querySelector<HTMLTextAreaElement>('textarea[name="input-focus"]')!
    focus.value = 'The retry loop'
    focus.dispatchEvent(new Event('input', { bubbles: true }))
    fake.navigate('https://elsewhere.example/')
    await settle(20)
    expect(card(root)!.textContent).toContain("This is about a page you've left.")
    expect(root.querySelector<HTMLTextAreaElement>('textarea[name="input-focus"]')!.value).toBe('The retry loop')
  })

  it('stays on the task, tab, or conversation it shows when the tab moves to a page no task holds', async () => {
    const { fake, root, state } = mount({ url: PAGE })
    state.pageTasks = [
      {
        id: 't-new',
        title: 'Fix the flaky test',
        branch: 'fix',
        projectId: 'p1',
        pages: [{ origin: 'https://tracker.example', pathPrefix: '/items/42', source: 'tracker' }],
      },
    ]
    state.sessions['t-new'] = [session('s2', 't-new')]
    await settle(30)
    expect(shownTask(root)).toBe('Fix the flaky test')
    for (const label of ['Agents', 'Runs']) {
      await tab(root, label)
      fake.navigate('https://elsewhere.example/')
      await settle(30)
      expect(shownTask(root)).toBe('Fix the flaky test')
      expect(openTab(root)).toBe(label)
      fake.navigate(PAGE)
      await settle(30)
    }
    await openChat(root, 'Chat s2')
    fake.navigate('https://elsewhere.example/')
    await settle(30)
    expect(conversationTitle(root)).toBe('Chat s2')
  })

  it('keeps a conversation open on an item no task holds, and Start task goes Home to look it up', async () => {
    const { fake, root, state } = mount({ url: PAGE })
    state.pageTasks = [
      {
        id: 't-new',
        title: 'Fix the flaky test',
        branch: 'fix',
        projectId: 'p1',
        pages: [{ origin: 'https://tracker.example', pathPrefix: '/items/42', source: 'tracker' }],
      },
    ]
    state.sessions['t-new'] = [session('s2', 't-new')]
    await settle(30)
    await openChat(root, 'Chat s2')
    fake.navigate('https://tracker.example/items/43')
    await settle(30)
    expect(conversationTitle(root)).toBe('Chat s2')
    expect(state.requests.filter((request) => request.op === 'handoff.resolve')).toHaveLength(0)
    button(root.querySelector('.strip')!, 'Start task')!.click()
    await settle(30)
    expect(card(root)).not.toBeNull()
    expect(resolvedUrls(state)).toEqual(['https://tracker.example/items/43'])
  })

  it('closes the card when the tab moves to a page it may not read', async () => {
    const { fake, root } = mount({ url: PAGE })
    await settle(30)
    expect(card(root)).not.toBeNull()
    // Leaving the site a toolbar click granted: the browser reports the load, but no address.
    fake.navigate(undefined)
    await settle(20)
    expect(card(root)).toBeNull()
  })

  it('looks the page up once a toolbar click lets it read the page', async () => {
    const { fake, root, state } = mount({ url: PAGE })
    fake.activeTab = { ...fake.activeTab, url: undefined }
    fake.activate()
    await settle(30)
    expect(card(root)).toBeNull()
    // The click grants access to the tab without any tab event the sidebar hears.
    fake.activeTab = { ...fake.activeTab, url: PAGE }
    fake.clickAction()
    await settle(20)
    expect(card(root)).not.toBeNull()
    expect(state.requests.filter((request) => request.op === 'handoff.resolve')).toHaveLength(1)
  })

  it('shows only the task list on a page it may not read', async () => {
    const { fake, root } = mount()
    fake.activeTab = { ...fake.activeTab, url: undefined }
    fake.activate()
    await settle(30)
    expect(idle(root)).toBe(true)
    expect(root.querySelector('[aria-label="This page"]')).toBeNull()
  })

  it('asks for site access from a click, and says when an item has no project here', async () => {
    const { fake, root } = mount({ items: [item({ projects: [] })] })
    await settle(30)
    await openSettings(root)
    expect(siteList(root)).toEqual(['tracker.example: Task chips on its pages · off'])
    await siteSwitch(root, 'tracker.example')
    expect(fake.granted.has('https://tracker.example/*')).toBe(true)
    expect(siteList(root)).toEqual(['tracker.example: Task chips on its pages · on'])
    // Removing it, here or in the browser's settings, takes back This page's offer too.
    fake.activeTab = { ...fake.activeTab, url: PAGE }
    fake.activate()
    await back(root)
    // Home looks the page up.
    expect(card(root)).not.toBeNull()
    fake.activeTab = { ...fake.activeTab, url: undefined }
    await openSettings(root)
    await siteSwitch(root, 'tracker.example')
    expect(siteList(root)).toEqual(['tracker.example: Task chips on its pages · off'])
    await back(root)
    expect(button(root, 'Look up in Acorn')).toBeUndefined()
    await clickSiteButton(fake)
    expect(root.textContent).toContain('No project on this Node tracks acme/widget#42.')
    expect(button(root, 'Create task')).toBeUndefined()
  })
})

describe('moving between task pages', () => {
  const ITEM_1 = 'https://tracker.example/items/1'
  const pageTask = (id: string, title: string, path: string): BridgePageTask => ({
    id,
    title,
    branch: null,
    projectId: 'p1',
    pages: [{ origin: 'https://tracker.example', pathPrefix: path, source: 'tracker' }],
  })
  // Two tasks, each with a tracker item open in its own tab. t-new has a workflow run.
  function twoTasks(url = ITEM_1) {
    const mounted = mount({ url })
    const { state } = mounted
    state.tasks.p1 = [
      { id: 't1', title: 'Existing work', branch: null },
      { id: 't-new', title: 'Fix the flaky test', branch: 'fix' },
    ]
    state.pageTasks = [
      pageTask('t1', 'Existing work', '/items/1'),
      pageTask('t-new', 'Fix the flaky test', '/items/42'),
    ]
    state.sessions = {
      t1: [session('s1', 't1'), session('s0', 't1')],
      't-new': [session('s2', 't-new'), { ...session('w1', 't-new'), kind: 'workflow' }],
    }
    state.steps = [
      {
        id: 'step-1',
        name: 'Explain the PR',
        status: 'done',
        createdAt: 0,
        updatedAt: 1,
        session: session('w1', 't-new'),
      },
    ]
    return mounted
  }
  // Switches to the other tab, which holds `url`.
  async function switchTo(fake: ReturnType<typeof fakeBrowser>, url: string) {
    fake.activeTab = { id: url === ITEM_1 ? 7 : 8, windowId: 1, url, title: 'Item' }
    fake.activate()
    await settle(40)
  }

  it("keeps an open conversation when the tab switches to another task's page, and Switch opens that task", async () => {
    const { fake, root } = twoTasks()
    await settle(30)
    expect(shownTask(root)).toBe('Existing work')
    await openChat(root, 'Chat s0')
    await switchTo(fake, PAGE)
    expect(conversationTitle(root)).toBe('Chat s0')
    expect(root.querySelector('.strip')!.textContent).toBe('This page is in Fix the flaky testSwitch')
    button(root.querySelector('.strip')!, 'Switch')!.click()
    await settle(30)
    expect(shownTask(root)).toBe('Fix the flaky test')
    expect(openTab(root)).toBe('Agents')
  })

  it('opens the task of the page the tab switches to, on the tab last picked there, from Home too', async () => {
    const { fake, root } = twoTasks()
    await settle(30)
    await switchTo(fake, PAGE)
    expect(shownTask(root)).toBe('Fix the flaky test')
    expect(openTab(root)).toBe('Agents')
    await tab(root, 'Runs')
    await switchTo(fake, ITEM_1)
    expect(shownTask(root)).toBe('Existing work')
    expect(openTab(root)).toBe('Agents')
    await goHome(root)
    await switchTo(fake, PAGE)
    expect(shownTask(root)).toBe('Fix the flaky test')
    expect(openTab(root)).toBe('Runs')
    expect(fake.storage.get('taskViews:n1')).toEqual({ 't-new': { tab: 'runs' } })
  })

  it('leaves Settings open as the tab switches', async () => {
    const { fake, root } = twoTasks()
    await settle(30)
    await openSettings(root)
    await switchTo(fake, PAGE)
    expect(root.querySelector('.view[aria-label="Settings"]')).not.toBeNull()
    await back(root)
    expect(root.querySelector('.view[aria-label="Home"]')).not.toBeNull()
  })

  it("goes up one level with Back: a step's conversation to Runs, any other to Agents, and a task to Home", async () => {
    const { fake, root } = twoTasks()
    await switchTo(fake, PAGE)
    await tab(root, 'Runs')
    stepRows(root)[0]!.click()
    await settle(30)
    expect(conversationTitle(root)).toBe('Explain the PR')
    await back(root)
    expect(openTab(root)).toBe('Runs')
    await openChat(root, 'Chat s2')
    await back(root)
    expect(shownTask(root)).toBe('Fix the flaky test')
    expect(openTab(root)).toBe('Agents')
    await back(root)
    expect(root.querySelector('.view[aria-label="Home"]')).not.toBeNull()
  })

  it.each([
    ['its own task', ITEM_1, null],
    ["another task's", PAGE, 'This page is in Fix the flaky testSwitch'],
  ])('reopens the last conversation when the panel opens on %s page', async (_name, url, strip) => {
    const { fake, root } = twoTasks(url)
    fake.storage.set('destination:n1', { projectId: 'p1', taskId: 't1', sessionId: 's0' })
    await settle(40)
    expect(conversationTitle(root)).toBe('Chat s0')
    expect(root.querySelector('.strip')?.textContent ?? null).toBe(strip)
  })

  it('gives way to Agents on a task with no Runs tab', async () => {
    const { fake, root, state } = twoTasks(PAGE)
    await settle(30)
    await tab(root, 'Runs')
    // The Node stops answering for workflows, so no task has a Runs tab.
    const answer = fake.onNativeMessage
    fake.onNativeMessage = (raw, host) => {
      const request = raw as Request
      if (request.op !== 'workflow.runs') return answer(raw, host)
      state.requests.push(request)
      host.send({ v: 1, id: request.id, ok: false, error: { code: 'not_found', message: 'No workflows.' } })
    }
    await switchTo(fake, ITEM_1)
    expect(shownTask(root)).toBe('Existing work')
    expect(taskTabs(root)).toEqual(['Agents'])
    await switchTo(fake, PAGE)
    expect(openTab(root)).toBe('Agents')
  })
})
