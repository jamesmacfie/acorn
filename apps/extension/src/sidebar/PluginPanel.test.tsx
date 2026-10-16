import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'solid-js/web'
import type { BridgePageTask } from '@acorn/protocol/extensionBridge.ts'
import type { BrowserPanelView } from '@acorn/protocol/plugin/handoffs.ts'
import { taskPaneLink } from '../acornLinks'
import { startBackground } from '../background/background'
import { fakeBrowser, settle } from '../test/fakeBrowser'
import { button, chosen, goHome, pickFrom, shownTask, tab, taskTabs } from '../test/sidebarUi'
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

const view = (source = 'web', severity: 'info' | 'danger' = 'info'): BrowserPanelView => ({
  blocks: [
    {
      kind: 'status',
      label: 'Stack',
      state: 'running',
      severity,
      detail: '<b>Up</b> 3 minutes\nfix/flake → main\n1 unresolved thread',
    },
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
    { kind: 'status', label: 'Backups', state: 'stale', severity: 'warn', detail: 'Last ran yesterday' },
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
function mount(fake = fakeBrowser()) {
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

const panel = (root: HTMLElement) => root.querySelector<HTMLElement>('.view[aria-label="Runn"]')
const openTab = (root: HTMLElement) =>
  root.querySelector('[role="tablist"][aria-label="Task"] [aria-selected="true"]')?.textContent ?? null
const panelReads = (state: ReturnType<typeof mount>['state']) =>
  state.requests.filter((request) => request.op === 'plugin.panel')
const openPanel = (root: HTMLElement) => tab(root, 'Runn')
// The header's label, state badge, and detail lines.
const header = (root: HTMLElement) =>
  [...panel(root)!.querySelectorAll('.panel-head :is(.ui-heading-title, .ui-badge, .ui-text)')].map(
    (element) => element.textContent,
  )
const rows = (root: HTMLElement, section: string) => [
  ...panel(root)!.querySelectorAll<HTMLElement>(`[aria-label="${section}"] .ui-row`),
]
// A row's leading icon, read through `firstElementChild` because jsdom can miss `> *` on an SVG.
const mark = (row: HTMLElement) => row.querySelector('.ui-row-leading')!.firstElementChild!
const logLines = (root: HTMLElement) =>
  [...panel(root)!.querySelectorAll('[role="log"] .ui-log-line')].map((line) => line.textContent)
// The Node says its tasks changed, as it does when a plugin with a panel reports a new state.
async function tasksChanged(fake: ReturnType<typeof fakeBrowser>) {
  fake.hosts[0]!.send({ v: 1, event: 'tasks', nodeId: 'n1' })
  await settle(30)
}

describe('plugin panels', () => {
  it("shows the plugin's tab only for a task it has a panel for", async () => {
    const { fake, state, root } = mount()
    await settle(30)
    // The panel opens on the page's task.
    expect(shownTask(root)).toBe('Task t1')
    expect(taskTabs(root)).toEqual(['Agents', 'Runs', 'Runn'])
    expect(panelReads(state)).toMatchObject([{ pluginId: 'runn', taskId: 't1' }])
    // t3's page opens t3, which has no Runn panel.
    fake.navigate('https://other.example/')
    await settle(30)
    expect(shownTask(root)).toBe('Task t3')
    expect(taskTabs(root)).toEqual(['Agents', 'Runs'])
  })

  it('draws every block with the kit, under a header with Refresh and Open in Acorn', async () => {
    const { root } = mount()
    await settle(30)
    await openPanel(root)
    expect(shownTask(root)).toBe('Task t1')
    expect(openTab(root)).toBe('Runn')
    // The first status block is the header. Its detail is the plugin's text, never markup: the first
    // line bold, and every later line muted, whatever it holds.
    expect(header(root)).toEqual(['Stack', 'running', '<b>Up</b> 3 minutes', 'fix/flake → main', '1 unresolved thread'])
    expect(panel(root)!.querySelector('b')).toBeNull()
    const lines = [...panel(root)!.querySelectorAll('.panel-head .ui-text')]
    expect(lines.map((line) => line.getAttribute('data-emphasis'))).toEqual(['strong', 'muted', 'muted'])
    expect(panel(root)!.querySelector('.panel-head .ui-badge')!.getAttribute('data-tone')).toBe('ok')

    const services = rows(root, 'Services')
    expect(services.map((row) => row.textContent)).toEqual(['webhealthy', 'workerexited', 'adminstarting'])
    expect(services.map((row) => [mark(row).getAttribute('data-tone'), row.querySelector('svg') !== null])).toEqual([
      ['ok', true],
      ['danger', true],
      ['muted', true],
    ])
    expect(panel(root)!.querySelector('[aria-label="Services"] .ui-section-header-count')!.textContent).toBe('3')
    // A later status block is a row, with its detail as the row's tip.
    const backups = [...panel(root)!.querySelectorAll<HTMLElement>('.panel-blocks > .ui-row')]
    expect(backups.map((row) => [row.textContent, mark(row).getAttribute('data-tone'), row.dataset.tip])).toEqual([
      ['Backupsstale', 'warn', 'Last ran yesterday'],
    ])
    expect(logLines(root)).toEqual(['web started', 'web ready'])

    const followed: string[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      followed.push(this.href)
    })
    button(panel(root)!.querySelector('.panel-head')!, 'Open in Acorn')!.click()
    expect(followed).toEqual([taskPaneLink('n1', 't1', 'runn')])
  })

  it('marks the tab while the header says something is wrong', async () => {
    const { fake, state, root } = mount()
    await settle(30)
    const runnTab = () => [...root.querySelectorAll('[role="tab"]')].find((tab) => tab.textContent === 'Runn')!
    expect(runnTab().querySelector('[aria-label="Needs attention"]')).toBeNull()
    state.views.t1 = view('web', 'danger')
    await openPanel(root)
    await tasksChanged(fake)
    expect(runnTab().querySelector('[aria-label="Needs attention"]')!.getAttribute('data-tone')).toBe('danger')
    expect(panel(root)!.querySelector('.panel-head .ui-badge')!.getAttribute('data-tone')).toBe('danger')
  })

  it('opens only a web address that answers in a new tab, and copies any address', async () => {
    const writeText = vi.fn(async () => {})
    Object.assign(navigator, { clipboard: { writeText } })
    const { root } = mount()
    await settle(30)
    await openPanel(root)
    const [app, database, admin] = rows(root, 'Links')
    // The address shows without its scheme.
    expect([app, database, admin].map((row) => row!.querySelectorAll('.ui-text')[1]!.textContent)).toEqual([
      'app.example/',
      'postgres://localhost:5432/app',
      'admin.example/',
    ])
    // The row that opens is the link itself, with the arrow that says so.
    expect(app!.tagName).toBe('A')
    expect(app!.getAttribute('href')).toBe('https://app.example/')
    expect(app!.getAttribute('target')).toBe('_blank')
    expect(app!.querySelector('.ui-row-trailing')!.children).toHaveLength(2)
    for (const row of [database!, admin!]) {
      expect(row.tagName).not.toBe('A')
      expect(row.querySelector('a')).toBeNull()
      expect(row.querySelector('.ui-row-trailing')!.children).toHaveLength(1)
    }
    button(database!, 'Copy')!.click()
    await settle()
    expect(writeText).toHaveBeenCalledWith('postgres://localhost:5432/app')
    // Copying from the row that opens doesn't follow its link.
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    button(app!, 'Copy')!.dispatchEvent(click)
    await settle()
    expect(writeText).toHaveBeenLastCalledWith('https://app.example/')
    expect(click.defaultPrevented).toBe(true)
  })

  it('reads the view again for the log source the person picks', async () => {
    const { state, root } = mount()
    await settle(30)
    await openPanel(root)
    expect(chosen(panel(root)!, 'Log source')).toBe('web')
    await pickFrom(panel(root)!, 'Log source', 'worker')
    expect(panelReads(state).at(-1)).toMatchObject({ pluginId: 'runn', taskId: 't1', source: 'worker' })
    expect(chosen(panel(root)!, 'Log source')).toBe('worker')
    expect(logLines(root)).toEqual(['worker started', 'worker ready'])
  })

  it('reads again on Refresh and when the Node reports a change, keeping the last view through a failure', async () => {
    const { fake, state, root } = mount()
    await settle(30)
    await openPanel(root)
    const before = panelReads(state).length
    await tasksChanged(fake)
    expect(panelReads(state).length).toBe(before + 1)
    state.views.t1 = new Error("The runn plugin answered with something the extension can't use.")
    const refresh = button(panel(root)!, 'Refresh')!
    expect(refresh.querySelector('[data-spin]')).toBeNull()
    refresh.click()
    // The icon turns while the read is out.
    expect(refresh.querySelector('[data-spin]')).not.toBeNull()
    await settle(30)
    expect(refresh.querySelector('[data-spin]')).toBeNull()
    expect(panelReads(state).length).toBe(before + 2)
    expect(panel(root)!.querySelector('[role="alert"]')!.textContent).toContain("can't use")
    expect(header(root).slice(0, 2)).toEqual(['Stack', 'running'])
    // The sidebar still works around it.
    await goHome(root)
    expect(root.querySelector('.view[aria-label="Home"]')).not.toBeNull()
  })

  it('stays on the task and tab it shows when the page moves to one no task holds', async () => {
    const { fake, state, root } = mount()
    await settle(30)
    await openPanel(root)
    const reads = panelReads(state).length
    fake.navigate('https://elsewhere.example/')
    await settle(30)
    expect(shownTask(root)).toBe('Task t1')
    expect(openTab(root)).toBe('Runn')
    expect(header(root).slice(0, 2)).toEqual(['Stack', 'running'])
    expect(panelReads(state).length).toBe(reads)
  })

  it('opens a task on the tab last picked there, after the panel closes and opens again too', async () => {
    const fake = fakeBrowser()
    const { state, root } = mount(fake)
    state.views.t3 = view('worker')
    await settle(30)
    await openPanel(root)
    // Another task's page opens that task on Agents, which is where it was last.
    fake.navigate('https://other.example/')
    await settle(30)
    expect(shownTask(root)).toBe('Task t3')
    expect(openTab(root)).toBe('Agents')
    fake.navigate(PAGE)
    await settle(30)
    expect(shownTask(root)).toBe('Task t1')
    expect(openTab(root)).toBe('Runn')
    expect(header(root).slice(0, 2)).toEqual(['Stack', 'running'])

    // The panel closes and opens again beside the same page.
    dispose?.()
    document.body.innerHTML = ''
    const reopened = mount(fake)
    await settle(30)
    expect(shownTask(reopened.root)).toBe('Task t1')
    expect(openTab(reopened.root)).toBe('Runn')
    expect(header(reopened.root).slice(0, 2)).toEqual(['Stack', 'running'])
  })

  it("gives way to Agents when the task's panel goes", async () => {
    const { fake, state, root } = mount()
    await settle(30)
    await openPanel(root)
    state.views.t1 = null
    await tasksChanged(fake)
    expect(shownTask(root)).toBe('Task t1')
    expect(openTab(root)).toBe('Agents')
    expect(taskTabs(root)).toEqual(['Agents', 'Runs'])
  })
})
