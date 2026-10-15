import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'solid-js/web'
import type { BridgePageTask } from '@acorn/protocol/extensionBridge.ts'
import type { BrowserPanelView } from '@acorn/protocol/plugin/handoffs.ts'
import { taskPaneLink } from '../acornLinks'
import { startBackground } from '../background/background'
import { fakeBrowser, settle } from '../test/fakeBrowser'
import { button, pick } from '../test/sidebarUi'
import { App } from './App'

let dispose: (() => void) | undefined
afterEach(() => {
  dispose?.()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

type Request = Record<string, unknown> & { id: string; op: string }

const PAGE = 'https://app.example/'
const pageTask = (id: string, origin = 'https://app.example'): BridgePageTask => ({
  id,
  title: `Task ${id}`,
  branch: null,
  projectId: 'p1',
  pages: [{ origin, pathPrefix: '/', source: 'runn' }],
})

const view = (source = 'web'): BrowserPanelView => ({
  blocks: [
    { kind: 'status', label: 'Stack', state: 'running', severity: 'info', detail: '<b>Up</b> 3 minutes' },
    {
      kind: 'links',
      title: 'Links',
      links: [
        { label: 'App', url: 'https://app.example/' },
        { label: 'Database', url: 'postgres://localhost:5432/app' },
        { label: 'Admin', url: 'https://admin.example/', ready: false },
      ],
    },
    {
      kind: 'rows',
      title: 'Services',
      rows: [
        { label: 'web', state: 'healthy', severity: 'info' },
        { label: 'worker', state: 'exited', severity: 'danger' },
        { label: 'admin', state: 'starting', severity: 'pending' },
      ],
    },
    {
      kind: 'logs',
      title: 'Logs',
      sources: [
        { id: 'web', label: 'web' },
        { id: 'worker', label: 'worker' },
      ],
      source,
      lines: [`${source} started`, `${source} ready`],
    },
  ],
})

// One Node with a Runn panel. The page belongs to whichever task `state.pageTask` names, and the
// panel's answer for each task is in `state.views`: a view, null for none, or a failure.
function mount() {
  const fake = fakeBrowser()
  fake.activeTab = { id: 7, windowId: 1, url: PAGE, title: 'App' }
  const state = {
    pageTask: 't1',
    views: { t1: view() } as Record<string, BrowserPanelView | null | Error>,
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
        return {
          nodeId: 'n1',
          handoffs: [],
          panels: [{ pluginId: 'runn', label: 'Runn', glyph: 'container', pane: 'runn' }],
        }
      case 'tasks.pages':
        // A second task, on another site, that has no Runn panel.
        return { nodeId: 'n1', tasks: [pageTask(state.pageTask), pageTask('t3', 'https://other.example')] }
      case 'projects.list':
        return { nodeId: 'n1', projects: [{ id: 'p1', name: 'Widget', path: null, hidden: false }], workspaces: [] }
      case 'tasks.list':
        return { nodeId: 'n1', projectId: request.projectId, tasks: [] }
      case 'sessions.list':
        return { nodeId: 'n1', taskId: request.taskId, sessions: [] }
      case 'workflow.runs':
        return { nodeId: 'n1', taskId: request.taskId, runs: [] }
      case 'sites.list':
        return { nodeId: 'n1', sites: [] }
      case 'plugin.panel': {
        const answered = state.views[request.taskId as string] ?? null
        if (answered instanceof Error) return answered
        const source = request.source as string | undefined
        return {
          nodeId: 'n1',
          pluginId: request.pluginId,
          taskId: request.taskId,
          view: answered && source ? view(source) : answered,
        }
      }
    }
    return undefined
  }
  fake.onNativeMessage = (raw, host) => {
    const request = raw as Request
    state.requests.push(request)
    const result = answer(request)
    if (result instanceof Error)
      host.send({ v: 1, id: request.id, ok: false, error: { code: 'node_error', message: result.message } })
    else host.send({ v: 1, id: request.id, ok: true, result })
  }
  startBackground(fake.api, 'com.acorn.browser_bridge')
  const root = document.createElement('div')
  document.body.append(root)
  dispose = render(() => <App api={fake.api} opensLinks />, root)
  return { fake, state, root }
}

const nav = (root: HTMLElement) =>
  [...root.querySelectorAll('nav button')].map((tab) => tab.getAttribute('aria-label') ?? tab.textContent)
const panel = (root: HTMLElement) => root.querySelector<HTMLElement>('.view[aria-label="Runn"]')
const panelReads = (state: ReturnType<typeof mount>['state']) =>
  state.requests.filter((request) => request.op === 'plugin.panel')
async function openPanel(root: HTMLElement) {
  button(root.querySelector('nav')!, 'Runn')!.click()
  await settle(20)
}
// The Node says its tasks changed, as it does when a plugin with a panel reports a new state.
async function tasksChanged(fake: ReturnType<typeof fakeBrowser>) {
  fake.hosts[0]!.send({ v: 1, event: 'tasks', nodeId: 'n1' })
  await settle(30)
}

describe('plugin panels', () => {
  it("shows the plugin's tab only for a task it has a panel for", async () => {
    const { fake, state, root } = mount()
    await settle(30)
    expect(nav(root)).toEqual(['Home', 'Agents', 'Runn', 'Settings'])
    expect(panelReads(state)).toMatchObject([{ pluginId: 'runn', taskId: 't1' }])
    state.pageTask = 't2'
    await tasksChanged(fake)
    expect(nav(root)).toEqual(['Home', 'Agents', 'Settings'])
  })

  it('draws every block as text, under the plugin name', async () => {
    const { root } = mount()
    await settle(30)
    await openPanel(root)
    expect(root.querySelector('header h1')!.textContent).toBe('Runn')
    const shown = panel(root)!
    expect(shown.querySelector('.state')!.textContent).toBe('Stack running')
    // The detail is the plugin's text, never markup.
    expect(shown.querySelector('pre')!.textContent).toBe('<b>Up</b> 3 minutes')
    expect(shown.querySelector('b')).toBeNull()
    const services = [...shown.querySelectorAll('[aria-label="Services"] .ui-row')].map((row) => row.textContent)
    expect(services).toEqual(['webhealthy', 'workerexited', 'adminstarting'])
    expect(shown.querySelector('[aria-label="Services"] .dot[data-tone="bad"]')).not.toBeNull()
    expect(shown.querySelector('[aria-label="Services"] .dot[data-tone="active"]')).not.toBeNull()
    expect(shown.querySelectorAll('pre')[1]!.textContent).toBe('web started\nweb ready')
    expect(shown.querySelector<HTMLAnchorElement>('a.button[href^="acorn:"]')!.getAttribute('href')).toBe(
      taskPaneLink('n1', 't1', 'runn'),
    )
  })

  it('opens only a web address that answers in a new tab, and copies any address', async () => {
    const writeText = vi.fn(async () => {})
    Object.assign(navigator, { clipboard: { writeText } })
    const { root } = mount()
    await settle(30)
    await openPanel(root)
    const [app, database, admin] = [...panel(root)!.querySelectorAll<HTMLElement>('[aria-label="Links"] .ui-row')]
    const open = app!.querySelector<HTMLAnchorElement>('a')!
    expect(open.getAttribute('href')).toBe('https://app.example/')
    expect(open.getAttribute('target')).toBe('_blank')
    expect(database!.querySelector('a')).toBeNull()
    expect(admin!.querySelector('a')).toBeNull()
    button(database!, 'Copy')!.click()
    await settle()
    expect(writeText).toHaveBeenCalledWith('postgres://localhost:5432/app')
  })

  it('reads the view again for the log source the person picks', async () => {
    const { state, root } = mount()
    await settle(30)
    await openPanel(root)
    await pick(panel(root)!, 'log-source', 'worker')
    expect(panelReads(state).at(-1)).toMatchObject({ pluginId: 'runn', taskId: 't1', source: 'worker' })
    expect(panel(root)!.querySelectorAll('pre')[1]!.textContent).toBe('worker started\nworker ready')
  })

  it('reads again on Refresh and when the Node reports a change, keeping the last view through a failure', async () => {
    const { fake, state, root } = mount()
    await settle(30)
    await openPanel(root)
    const before = panelReads(state).length
    await tasksChanged(fake)
    expect(panelReads(state).length).toBe(before + 1)
    state.views.t1 = new Error("The runn plugin answered with something the extension can't use.")
    button(panel(root)!, 'Refresh')!.click()
    await settle(30)
    expect(panelReads(state).length).toBe(before + 2)
    expect(panel(root)!.querySelector('[role="alert"]')!.textContent).toContain("can't use")
    expect(panel(root)!.querySelector('.state')!.textContent).toBe('Stack running')
    // The sidebar still works around it.
    button(root.querySelector('nav')!, 'Home')!.click()
    await settle(20)
    expect(root.querySelector('.view[aria-label="Home"]')).not.toBeNull()
  })

  it('goes back to Home when the tab moves to a page no task holds, or to a task with no panel', async () => {
    const { fake, root } = mount()
    await settle(30)
    for (const elsewhere of ['https://elsewhere.example/', 'https://other.example/']) {
      fake.navigate(PAGE)
      await settle(30)
      await openPanel(root)
      expect(panel(root)).not.toBeNull()
      fake.navigate(elsewhere)
      await settle(30)
      expect(root.querySelector('header h1')!.textContent).toBe('Home')
      expect(nav(root)).toEqual(['Home', 'Agents', 'Settings'])
    }
  })

  it('opens the panel again on coming back to its task', async () => {
    const { fake, root } = mount()
    await settle(30)
    await openPanel(root)
    fake.navigate('https://elsewhere.example/')
    await settle(30)
    expect(root.querySelector('header h1')!.textContent).toBe('Home')
    fake.navigate(PAGE)
    await settle(30)
    expect(root.querySelector('header h1')!.textContent).toBe('Runn')
    expect(panel(root)!.querySelector('.state')!.textContent).toBe('Stack running')
  })

  it('stays open on a page of another task that has a panel', async () => {
    const { fake, state, root } = mount()
    state.views.t3 = view('worker')
    await settle(30)
    await openPanel(root)
    fake.navigate('https://other.example/')
    await settle(30)
    expect(panelReads(state).at(-1)).toMatchObject({ taskId: 't3' })
    expect(panel(root)!.querySelectorAll('pre')[1]!.textContent).toBe('worker started\nworker ready')
  })
})
