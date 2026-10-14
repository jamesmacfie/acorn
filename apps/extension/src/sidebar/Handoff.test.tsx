import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'solid-js/web'
import type { BridgeAgentSession, BridgeHandoffItem } from '@acorn/protocol/extensionBridge.ts'
import { startBackground } from '../background/background'
import { fakeBrowser, settle } from '../test/fakeBrowser'
import { back, button, conversationTitle, currentTask, openChat, openSettings } from '../test/sidebarUi'
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
  kind: 'interactive',
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
        return { nodeId: 'n1', handoffs: [handoff] }
      case 'handoff.resolve':
        return { nodeId: 'n1', url: request.url, items: state.items }
      case 'handoff.create': {
        const task = { id: 't-new', title: 'Fix the flaky test', branch: 'fix', projectId: request.projectId }
        state.tasks[request.projectId as string] = [...state.tasks[request.projectId as string]!, task]
        return { nodeId: 'n1', task, created: true }
      }
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
      case 'agents.profiles':
        return {
          nodeId: 'n1',
          profiles: [
            {
              providerId: 'claude',
              profileId: 'claude-code',
              label: 'Claude Code',
              installed: true,
              authenticated: true,
              diagnostics: [],
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

// A task chip's Start task click, as the background reports it once the panel is open.
async function clickSiteButton(fake: ReturnType<typeof fakeBrowser>) {
  fake.activeTab = { ...fake.activeTab, url: PAGE }
  fake.storage.set('handoffs', { nodeId: 'n1', handoffs: [handoff] })
  await settle()
  fake.sendFromPage({ type: 'acorn:handoff', key: 'tracker:item' })
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
    expect(button(root, 'Start task')).toBeUndefined()
    button(root, 'Chat')!.click()
    await settle(30)
    expect(root.querySelector('[aria-label="Conversation"] .view-head')!.textContent).toContain('Existing work')
    expect(conversationTitle(root)).toBe('Claude · Chat s1')
    expect(captures(root)).toEqual([expect.stringContaining('Item · Fix the flaky test')])
    expect(root.textContent).toContain('The test waits on a timer.')
    // Nothing went to an agent.
    expect(state.requests.some((request) => request.op === 'turn.submit')).toBe(false)
  })

  it('starts a task with a chat whose draft holds the first message and the item, and sends nothing', async () => {
    const { fake, root, state } = mount()
    await settle(20)
    await clickSiteButton(fake)
    expect(root.textContent).toContain('Nothing goes to the agent until you press Send.')
    const project = root.querySelector<HTMLSelectElement>('select[name="handoff-project"]')!
    project.value = 'p2'
    project.dispatchEvent(new Event('change', { bubbles: true }))
    const message = root.querySelector<HTMLTextAreaElement>('textarea[name="first-message"]')!
    expect(message.value).toBe('Read acme/widget#42 (Fix the flaky test) and list what is left to do.')
    message.value = 'Find why the test is flaky.'
    message.dispatchEvent(new Event('input', { bubbles: true }))
    button(root, 'Start task')!.click()
    await settle(40)
    expect(state.requests.find((request) => request.op === 'handoff.create')).toMatchObject({
      identifier: 'acme/widget#42',
      connectionId: 'conn-1',
      projectId: 'p2',
      url: PAGE,
    })
    expect(state.requests.find((request) => request.op === 'session.create')).toMatchObject({
      taskId: 't-new',
      providerId: 'claude',
      profileId: 'claude-code',
    })
    expect(root.querySelector('[aria-label="Conversation"] .view-head .title')!.textContent).toBe('Fix the flaky test')
    expect(conversationTitle(root)).toBe('Claude · Chat s-new')
    expect(root.querySelector<HTMLTextAreaElement>('textarea[name="message"]')!.value).toBe(
      'Find why the test is flaky.',
    )
    expect(captures(root)).toEqual([expect.stringContaining('Item · Fix the flaky test')])
    expect(state.requests.some((request) => request.op === 'turn.submit')).toBe(false)
  })

  it('starts the task again with the same keys after the Node left the chat unconfirmed', async () => {
    const { fake, root, state } = mount()
    let failChat = true
    const answer = fake.onNativeMessage
    fake.onNativeMessage = (raw, host) => {
      const request = raw as Request
      if (request.op !== 'session.create' || !failChat) return answer(raw, host)
      failChat = false
      state.requests.push(request)
      host.send({ v: 1, id: request.id, ok: false, error: { code: 'ambiguous_mutation', message: 'lost' } })
    }
    await settle(20)
    await clickSiteButton(fake)
    button(root, 'Start task')!.click()
    await settle(30)
    expect(root.textContent).toContain("The Node didn't confirm the new chat.")
    button(root, 'Start task')!.click()
    await settle(40)
    const keys = (op: string) => state.requests.filter((request) => request.op === op).map((request) => request.key)
    expect(new Set(keys('handoff.create')).size).toBe(1)
    expect(keys('session.create')).toHaveLength(2)
    expect(new Set(keys('session.create')).size).toBe(1)
    expect(conversationTitle(root)).toBe('Claude · Chat s-new')
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
    const head = root.querySelector('[aria-label="Conversation"] .view-head')!
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

  it('lets the person pick any other task, which gets the context without a link', async () => {
    const { fake, root, state } = mount()
    await settle(20)
    await clickSiteButton(fake)
    button(root, 'Add to a task')!.click()
    await settle(20)
    // Settings opens on its task search, which lists every open task.
    const found = [...root.querySelectorAll<HTMLButtonElement>('[aria-label="Tasks"] .row-button')]
    expect(found.map((row) => row.textContent)).toEqual(['Existing workWidget'])
    found[0]!.click()
    await settle(30)
    expect(currentTask(root)).toBe('Existing work')
    await openChat(root, 'Chat s1')
    expect(captures(root)).toHaveLength(1)
    expect(state.requests.some((request) => request.op === 'handoff.create')).toBe(false)
  })

  it('offers the handoff for the page beside it when no button could be drawn', async () => {
    const { root, state } = mount({ url: PAGE })
    await settle(30)
    button(root, 'Look up in Acorn')!.click()
    await settle(20)
    expect(state.requests.filter((request) => request.op === 'handoff.resolve')).toHaveLength(1)
    expect(root.textContent).toContain('acme/widget#42')
  })

  it("closes the card when the tab leaves the item, unless the person edited Start task's message", async () => {
    const { fake, root } = mount()
    await settle(20)
    await clickSiteButton(fake)
    const card = () => root.querySelector('[aria-label="Handoff"]')
    expect(card()).not.toBeNull()
    fake.navigate('https://tracker.example/items/43')
    await settle(20)
    expect(card()).toBeNull()

    await clickSiteButton(fake)
    const message = root.querySelector<HTMLTextAreaElement>('textarea[name="first-message"]')!
    message.value = 'Find why the test is flaky.'
    message.dispatchEvent(new Event('input', { bubbles: true }))
    fake.navigate('https://elsewhere.example/')
    await settle(20)
    expect(card()!.textContent).toContain("This is about a page you've left.")
    expect(root.querySelector<HTMLTextAreaElement>('textarea[name="first-message"]')!.value).toBe(
      'Find why the test is flaky.',
    )
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

  it('offers the sites still to allow on a page it may not read', async () => {
    const { fake, root } = mount()
    fake.activeTab = { ...fake.activeTab, url: undefined }
    fake.activate()
    await settle(30)
    const toAllow = () => root.querySelector('[aria-label="Sites to allow"]')
    expect(toAllow()?.textContent).toContain('tracker.example')
    button(toAllow() as HTMLElement, 'Allow')!.click()
    await settle(20)
    expect(fake.granted.has('https://tracker.example/*')).toBe(true)
    expect(toAllow()).toBeNull()
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
    expect(button(root, 'Start task')).toBeUndefined()
  })
})
