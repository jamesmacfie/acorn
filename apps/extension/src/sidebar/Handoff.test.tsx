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
import { back, button, conversationTitle, idle, openChat, openSettings, pick, selected, tab } from '../test/sidebarUi'
import { App } from './App'

let dispose: (() => void) | undefined
afterEach(() => {
  dispose?.()
  document.body.innerHTML = ''
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
    // The tasks the page belongs to. A new task holds the item, so the page becomes its page.
    pageTasks: [] as BridgePageTask[],
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
            { id: 'review', name: 'PR review', inputs: [{ name: 'issue', required: true }, { name: 'focus' }] },
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
            { id: 'p1', name: 'Widget', path: null, hidden: false },
            { id: 'p2', name: 'Widget (clone)', path: null, hidden: false },
          ],
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

const siteAccess = (root: HTMLElement) =>
  [...root.querySelectorAll('[aria-label="Site access"] li')].map(
    (row) => `${row.querySelector('strong')!.textContent}: ${row.querySelector('.quiet')!.textContent}`,
  )
const captures = (root: HTMLElement) =>
  [...root.querySelectorAll('[data-testid="capture"]')].map((row) => row.textContent)

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
  it("chats in a linked task's newest conversation with the item's context in its draft", async () => {
    const { fake, root, state } = mount({
      items: [item({ linkedTasks: [{ id: 't1', title: 'Existing work', projectId: 'p1' }] })],
    })
    await settle(20)
    await clickSiteButton(fake)
    expect(root.textContent).toContain('acme/widget#42')
    expect(state.requests.find((request) => request.op === 'handoff.resolve')).toMatchObject({ url: PAGE })
    // A task holds the item, so there is nothing to start.
    expect(button(root, 'Create task')).toBeUndefined()
    button(root, 'Chat')!.click()
    await settle(30)
    expect(root.querySelector('header .eyebrow')!.textContent).toBe('Existing work')
    expect(conversationTitle(root)).toBe('Chat s1')
    expect(captures(root)).toEqual([expect.stringContaining('Item · Fix the flaky test')])
    expect(root.textContent).toContain('The test waits on a timer.')
    // Nothing went to an agent.
    expect(state.requests.some((request) => request.op === 'turn.submit')).toBe(false)
  })

  it('creates the task and shows it on Home, with the item waiting for its first conversation', async () => {
    const { fake, root, state } = mount()
    await settle(20)
    await clickSiteButton(fake)
    expect(selected(root, 'handoff-start')).toBe('task')
    expect(root.textContent).toContain('The item waits for the first conversation you open.')
    await pick(root, 'handoff-project', 'p2')
    button(root, 'Create task')!.click()
    await settle(40)
    expect(state.requests.find((request) => request.op === 'handoff.create')).toMatchObject({
      identifier: 'acme/widget#42',
      connectionId: 'conn-1',
      projectId: 'p2',
      url: PAGE,
    })
    expect(root.querySelector('[aria-label="Handoff"]')).toBeNull()
    expect(root.querySelector('header h1')!.textContent).toBe('Home')
    expect(root.querySelector('[aria-label="Page tasks"]')!.textContent).toContain('Fix the flaky test')
    expect(root.querySelector('[aria-label="Waiting context"]')!.textContent).toContain('Fix the flaky test')
    // No conversation was started, and nothing went to an agent.
    expect(state.requests.some((request) => request.op === 'session.create' || request.op === 'turn.submit')).toBe(
      false,
    )
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
    await clickSiteButton(fake, 'workflow')
    await settle(20)
    expect(selected(root, 'handoff-start')).toBe('workflow')
    expect(state.requests.find((request) => request.op === 'workflows.list')).toMatchObject({ projectId: 'p1' })
    // The item's title and context fill `issue` by the desktop's rule; `focus` is left to the person.
    const input = (name: string) => root.querySelector<HTMLTextAreaElement>(`textarea[name="input-${name}"]`)!
    expect(input('issue').value).toBe('Fix the flaky test\n\nThe test waits on a timer.')
    expect(input('focus').value).toBe('')
    expect(root.textContent).toContain('The workflow starts its agents straight away.')
    button(root, 'Start workflow')!.click()
    await settle(60)
    expect(state.requests.find((request) => request.op === 'workflow.start')).toMatchObject({
      taskId: 't-new',
      defId: 'review',
      inputs: { issue: 'Fix the flaky test\n\nThe test waits on a timer.' },
    })
    expect(root.querySelector('header h1')!.textContent).toBe('Workflows')
    expect(button(root.querySelector('nav')!, 'Workflows')).toBeDefined()
    // The kit's own header and rows, as the desktop draws them.
    expect(root.querySelector('.section-header')!.textContent).toBe('Runs1')
    expect(root.querySelector('[aria-label="Runs"] .ui-row[data-selected]')!.textContent).toContain('PR review')
    const steps = () => [...root.querySelectorAll<HTMLElement>('[aria-label="Steps"] .ui-row')]
    expect(steps().map((row) => row.textContent)).toEqual(['Explain the PR1m28s', 'Final analysis'])
    // A step that hasn't run has no conversation to open.
    expect(steps().map((row) => row.getAttribute('role'))).toEqual(['button', null])
    steps()[0]!.click()
    await settle(30)
    expect(conversationTitle(root)).toBe('Explain the PR')
    expect(root.querySelector('header .eyebrow')!.textContent).toBe('PR review')
    await back(root)
    expect(root.querySelector('[aria-label="Steps"]')).not.toBeNull()
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
    await clickSiteButton(fake, 'workflow')
    await settle(20)
    button(root, 'Start workflow')!.click()
    await settle(30)
    expect(root.textContent).toContain("The Node didn't confirm the run.")
    button(root, 'Start workflow')!.click()
    await settle(40)
    const keys = (op: string) => state.requests.filter((request) => request.op === op).map((request) => request.key)
    expect(new Set(keys('handoff.create')).size).toBe(1)
    expect(keys('workflow.start')).toHaveLength(2)
    expect(new Set(keys('workflow.start')).size).toBe(1)
    expect(root.querySelector('header h1')!.textContent).toBe('Workflows')
  })

  it('opens the item and its task in Acorn through acorn:// links in a release build', async () => {
    const { fake, root } = mount({
      opensLinks: true,
      items: [
        item(),
        item({ identifier: 'acme/widget#43', linkedTasks: [{ id: 't1', title: 'Existing work', projectId: 'p1' }] }),
      ],
    })
    await settle(20)
    await clickSiteButton(fake)
    const opens = () => [...root.querySelectorAll('a')].filter((link) => link.textContent?.startsWith('Open in Acorn'))
    // No task holds the first item, so the desktop finds what claims its address.
    expect(opens().map((link) => link.getAttribute('href'))).toEqual([
      `acorn://n1/open?url=${encodeURIComponent(PAGE)}`,
    ])
    const which = root.querySelector<HTMLSelectElement>('select[name="handoff-item"]')!
    which.value = '1'
    which.dispatchEvent(new Event('change', { bubbles: true }))
    await settle()
    expect(opens().map((link) => link.getAttribute('href'))).toEqual(['acorn://n1/t/t1'])
    // The conversation header opens the task on the agents pane with this conversation selected.
    button(root, 'Chat')!.click()
    await settle(30)
    const head = root.querySelector('[aria-label="Conversation"] .subhead')!
    expect(head.querySelector('a')!.getAttribute('href')).toBe('acorn://n1/t/t1?pane=agents&item=s1')
    expect(button(head, 'Copy Acorn link')).toBeDefined()
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

  it('offers the handoff for the page beside it when no button could be drawn', async () => {
    const { root, state } = mount({ url: PAGE })
    await settle(30)
    button(root, 'Look up in Acorn')!.click()
    await settle(20)
    expect(state.requests.filter((request) => request.op === 'handoff.resolve')).toHaveLength(1)
    expect(root.textContent).toContain('acme/widget#42')
  })

  it("closes the card when the tab leaves the item, unless the person typed a workflow's input", async () => {
    const { fake, root } = mount()
    await settle(20)
    await clickSiteButton(fake)
    const card = () => root.querySelector('[aria-label="Handoff"]')
    expect(card()).not.toBeNull()
    fake.navigate('https://tracker.example/items/43')
    await settle(20)
    expect(card()).toBeNull()

    await clickSiteButton(fake, 'workflow')
    await settle(20)
    const focus = root.querySelector<HTMLTextAreaElement>('textarea[name="input-focus"]')!
    focus.value = 'The retry loop'
    focus.dispatchEvent(new Event('input', { bubbles: true }))
    fake.navigate('https://elsewhere.example/')
    await settle(20)
    expect(card()!.textContent).toContain("This is about a page you've left.")
    expect(root.querySelector<HTMLTextAreaElement>('textarea[name="input-focus"]')!.value).toBe('The retry loop')
  })

  it('goes back to Home when the tab moves to a page no task holds, and keeps an open conversation', async () => {
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
    const heading = () => root.querySelector('header h1')!.textContent
    for (const label of ['Agents', 'Workflows'] as const) {
      fake.navigate(PAGE)
      await settle(30)
      await tab(root, label)
      // Agents adds its count.
      expect(heading()).toMatch(new RegExp(`^${label}`))
      fake.navigate('https://elsewhere.example/')
      await settle(30)
      expect(heading()).toBe('Home')
    }
    // Pages are often visited to capture them into a conversation, so an open one stays.
    fake.navigate(PAGE)
    await settle(30)
    await openChat(root, 'Chat s2')
    fake.navigate('https://elsewhere.example/')
    await settle(30)
    expect(conversationTitle(root)).toBe('Chat s2')
  })

  it('takes the offer back when the tab moves to a page it may not read', async () => {
    const { fake, root } = mount({ url: PAGE })
    await settle(30)
    expect(button(root, 'Look up in Acorn')).toBeDefined()
    // Leaving the site a toolbar click granted: the browser reports the load, but no address.
    fake.navigate(undefined)
    await settle(20)
    expect(button(root, 'Look up in Acorn')).toBeUndefined()
  })

  it('offers the handoff once a toolbar click lets it read the page', async () => {
    const { fake, root } = mount({ url: PAGE })
    await settle(30)
    fake.activeTab = { ...fake.activeTab, url: undefined }
    fake.activate()
    await settle(20)
    expect(button(root, 'Look up in Acorn')).toBeUndefined()
    // The click grants access to the tab without any tab event the sidebar hears.
    fake.activeTab = { ...fake.activeTab, url: PAGE }
    fake.clickAction()
    await settle(20)
    expect(button(root, 'Look up in Acorn')).toBeDefined()
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
    expect(siteAccess(root)).toEqual(['tracker.example: Buttons on its pages · Not allowed'])
    button(root, 'Allow')!.click()
    await settle(20)
    expect(fake.granted.has('https://tracker.example/*')).toBe(true)
    expect(siteAccess(root)).toEqual(['tracker.example: Buttons on its pages · Allowed'])
    // Removing it, here or in the browser's settings, takes back This page's offer too.
    fake.activeTab = { ...fake.activeTab, url: PAGE }
    fake.activate()
    await back(root)
    expect(button(root, 'Look up in Acorn')).toBeDefined()
    fake.activeTab = { ...fake.activeTab, url: undefined }
    await openSettings(root)
    button(root, 'Remove')!.click()
    await settle(20)
    expect(siteAccess(root)).toEqual(['tracker.example: Buttons on its pages · Not allowed'])
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
  function twoTasks() {
    const mounted = mount({ url: ITEM_1 })
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

  it('shows the conversation the person last read in each task as they switch tabs', async () => {
    const { fake, root } = twoTasks()
    await settle(30)
    // The older of t1's conversations, not its newest.
    await openChat(root, 'Chat s0')
    expect(conversationTitle(root)).toBe('Chat s0')
    // t-new has nothing remembered yet, so the open conversation moves to its newest.
    await switchTo(fake, PAGE)
    expect(conversationTitle(root)).toBe('Chat s2')
    await switchTo(fake, ITEM_1)
    expect(conversationTitle(root)).toBe('Chat s0')
    // Back to t-new's list, then away and back again: the list comes back, not a conversation.
    await switchTo(fake, PAGE)
    await back(root)
    await switchTo(fake, ITEM_1)
    expect(conversationTitle(root)).toBe('Chat s0')
    await switchTo(fake, PAGE)
    expect(conversationTitle(root)).toBeNull()
    expect(root.querySelector('.view[aria-label="Agents"]')).not.toBeNull()
    // Home is the person's choice, and stays put.
    await tab(root, 'Home')
    await switchTo(fake, ITEM_1)
    expect(root.querySelector('header h1')!.textContent).toBe('Home')
  })

  it("reopens a workflow step's conversation on coming back to its task", async () => {
    const { fake, root } = twoTasks()
    await switchTo(fake, PAGE)
    await tab(root, 'Workflows')
    ;[...root.querySelectorAll<HTMLElement>('[aria-label="Steps"] .ui-row')][0]!.click()
    await settle(30)
    expect(conversationTitle(root)).toBe('Explain the PR')
    await switchTo(fake, ITEM_1)
    expect(conversationTitle(root)).toBeNull()
    await switchTo(fake, PAGE)
    expect(conversationTitle(root)).toBe('Explain the PR')
  })

  it('shows where the person was after a page no task holds sent the sidebar Home', async () => {
    const { fake, root } = twoTasks()
    await settle(30)
    await openChat(root, 'Chat s0')
    // A conversation stays over a page no task holds, so leave it for t1's list first.
    await back(root)
    fake.navigate('https://elsewhere.example/')
    await settle(30)
    expect(root.querySelector('header h1')!.textContent).toBe('Home')
    // Home was the sidebar's doing, so coming back shows where the person was.
    fake.navigate(ITEM_1)
    await settle(40)
    expect(root.querySelector('.view[aria-label="Agents"]')).not.toBeNull()
    expect(fake.storage.get('taskViews:n1')).toMatchObject({ t1: { tab: 'agents', sessionId: null } })
  })
})
