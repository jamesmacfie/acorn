import { afterEach, describe, expect, it } from 'vitest'
import { render } from 'solid-js/web'
import type { BridgeAgentSession, BridgeHandoffItem } from '@acorn/protocol/extensionBridge.ts'
import { startBackground } from '../background/background'
import { fakeBrowser, settle } from '../test/fakeBrowser'
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
function mount(options: { items?: BridgeHandoffItem[]; url?: string } = {}) {
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
        return { nodeId: 'n1', sessionId: request.sessionId, session: row, records: [], reach: 0, queued: [] }
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
  dispose = render(() => <App api={fake.api} />, root)
  return { fake, state, root }
}

const button = (root: HTMLElement, text: string) =>
  [...root.querySelectorAll('button')].find((element) => element.textContent?.trim() === text)
const selected = (root: HTMLElement, name: string) =>
  root.querySelector<HTMLSelectElement>(`select[name="${name}"]`)?.value
const captures = (root: HTMLElement) =>
  [...root.querySelectorAll('[data-testid="capture"]')].map((row) => row.textContent)

// A site button click, as the background reports it once the panel is open.
async function clickSiteButton(fake: ReturnType<typeof fakeBrowser>) {
  fake.activeTab = { ...fake.activeTab, url: PAGE }
  fake.storage.set('handoffs', { nodeId: 'n1', handoffs: [handoff] })
  await settle()
  fake.sendFromPage({ type: 'acorn:handoff', key: 'tracker:item' })
  await settle(20)
}

describe('a handoff in the sidebar', () => {
  it("opens a linked task's newest conversation with the item's context in its draft", async () => {
    const { fake, root, state } = mount({
      items: [item({ linkedTasks: [{ id: 't1', title: 'Existing work', projectId: 'p1' }] })],
    })
    await settle(20)
    await clickSiteButton(fake)
    expect(root.textContent).toContain('acme/widget#42')
    expect(state.requests.find((request) => request.op === 'handoff.resolve')).toMatchObject({ url: PAGE })
    button(root, 'Open')!.click()
    await settle(30)
    expect([selected(root, 'project'), selected(root, 'task'), selected(root, 'session')]).toEqual(['p1', 't1', 's1'])
    expect(captures(root)).toEqual([expect.stringContaining('Item · Fix the flaky test')])
    expect(root.textContent).toContain('The test waits on a timer.')
    // Nothing went to an agent.
    expect(state.requests.some((request) => request.op === 'turn.submit')).toBe(false)
  })

  it('creates a linked task in the chosen project, then holds the context until a chat starts', async () => {
    const { fake, root, state } = mount()
    await settle(20)
    await clickSiteButton(fake)
    const project = root.querySelector<HTMLSelectElement>('select[name="handoff-project"]')!
    project.value = 'p2'
    project.dispatchEvent(new Event('change', { bubbles: true }))
    button(root, 'Create linked task')!.click()
    await settle(30)
    expect(state.requests.find((request) => request.op === 'handoff.create')).toMatchObject({
      identifier: 'acme/widget#42',
      connectionId: 'conn-1',
      projectId: 'p2',
      url: PAGE,
    })
    expect([selected(root, 'project'), selected(root, 'task')]).toEqual(['p2', 't-new'])
    // No conversation yet: the new-chat picker shows, and the context waits for it.
    expect(root.textContent).toContain('goes into the draft of the conversation you open next')
    button(root, 'Start chat')!.click()
    await settle(30)
    expect(selected(root, 'session')).toBe('s-new')
    expect(captures(root)).toEqual([expect.stringContaining('Fix the flaky test')])
  })

  it('lets the person pick any other task, which gets the context without a link', async () => {
    const { fake, root, state } = mount()
    await settle(20)
    await clickSiteButton(fake)
    button(root, 'Choose another task')!.click()
    await settle(20)
    expect(selected(root, 'project')).toBe('p1')
    const task = root.querySelector<HTMLSelectElement>('select[name="task"]')!
    task.value = 't1'
    task.dispatchEvent(new Event('change', { bubbles: true }))
    await settle(20)
    const conversation = root.querySelector<HTMLSelectElement>('select[name="session"]')!
    conversation.value = 's1'
    conversation.dispatchEvent(new Event('change', { bubbles: true }))
    await settle(30)
    expect(captures(root)).toHaveLength(1)
    expect(state.requests.some((request) => request.op === 'handoff.create')).toBe(false)
  })

  it('offers the handoff for the page beside it when no button could be drawn', async () => {
    const { root, state } = mount({ url: PAGE })
    await settle(30)
    button(root, 'Open in Acorn')!.click()
    await settle(20)
    expect(state.requests.filter((request) => request.op === 'handoff.resolve')).toHaveLength(1)
    expect(root.textContent).toContain('acme/widget#42')
  })

  it('takes the offer back when the tab moves to a page it may not read', async () => {
    const { fake, root } = mount({ url: PAGE })
    await settle(30)
    expect(button(root, 'Open in Acorn')).toBeDefined()
    // Leaving the site a toolbar click granted: the browser reports the load, but no address.
    fake.navigate(undefined)
    await settle(20)
    expect(button(root, 'Open in Acorn')).toBeUndefined()
  })

  it('offers the handoff once a toolbar click lets it read the page', async () => {
    const { fake, root } = mount({ url: PAGE })
    fake.activeTab = { ...fake.activeTab, url: undefined }
    await settle(30)
    expect(button(root, 'Open in Acorn')).toBeUndefined()
    // The click grants access to the tab without any tab event the sidebar hears.
    fake.activeTab = { ...fake.activeTab, url: PAGE }
    fake.clickAction()
    await settle(20)
    expect(button(root, 'Open in Acorn')).toBeDefined()
  })

  it('asks for site access from a click, and says when an item has no project here', async () => {
    const { fake, root } = mount({ items: [item({ projects: [] })] })
    await settle(30)
    expect(root.textContent).toContain('No buttons on tracker.example')
    button(root, 'Allow')!.click()
    await settle(20)
    expect(fake.granted.has('https://tracker.example/*')).toBe(true)
    expect(root.textContent).toContain('Buttons show on tracker.example')
    // Removing it, here or in the browser's settings, takes back the sidebar's offer for the page too.
    fake.activeTab = { ...fake.activeTab, url: PAGE }
    fake.activate()
    await settle(20)
    expect(button(root, 'Open in Acorn')).toBeDefined()
    fake.activeTab = { ...fake.activeTab, url: undefined }
    button(root, 'Remove')!.click()
    await settle(20)
    expect(root.textContent).toContain('No buttons on tracker.example')
    expect(button(root, 'Open in Acorn')).toBeUndefined()
    await clickSiteButton(fake)
    expect(root.textContent).toContain('No project on this Node tracks acme/widget#42.')
    expect(button(root, 'Create linked task')).toBeUndefined()
  })
})
