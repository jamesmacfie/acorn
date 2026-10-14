import { afterEach, describe, expect, it } from 'vitest'
import { render } from 'solid-js/web'
import type { BridgeAgentSession, BridgeHandoff, BridgePageTask } from '@acorn/protocol/extensionBridge.ts'
import type { ProjectSite } from '@acorn/protocol/siteAssociations.ts'
import { startBackground } from '../background/background'
import { fakeBrowser, settle } from '../test/fakeBrowser'
import {
  back,
  button,
  conversationTitle,
  currentTask,
  idle,
  openChat,
  openSettings,
  pick,
  selected,
  useNode,
  useTask,
} from '../test/sidebarUi'
import { App } from './App'

let dispose: (() => void) | undefined
afterEach(() => {
  dispose?.()
  document.body.innerHTML = ''
})

type Request = Record<string, unknown> & { id: string; op: string }

const session: BridgeAgentSession = {
  id: 's1',
  taskId: 't1',
  title: 'Chat s1',
  providerId: 'claude',
  profileId: 'claude-code',
  kind: 'interactive',
  inline: false,
  runtimeState: 'ready',
  attention: 'none',
  lastEventSeq: 0,
  archivedAt: null,
  updatedAt: 1,
}

// Two paired Nodes, n1 selected, with three projects each. Site associations are whatever the test
// puts in `state.sites`; a test can hold `sites.list` replies to answer them late.
function mount(options: { url?: string; sites?: ProjectSite[] } = {}) {
  const fake = fakeBrowser()
  fake.activeTab = { id: 7, windowId: 1, url: options.url, title: 'Page' }
  const state = {
    active: 'n1',
    sites: { n1: options.sites ?? [], n2: [] } as Record<string, ProjectSite[]>,
    holdSites: false,
    held: [] as (() => void)[],
    requests: [] as Request[],
    // What the Node's agents are waiting on, as `requests.pending` answers.
    pending: [] as Record<string, unknown>[],
    // Projects another client adds after the sidebar opened.
    addedProjects: [] as { id: string; name: string; path: null; hidden: boolean }[],
    // Open tasks in p1 besides Fix login.
    addedTasks: [] as { id: string; title: string; branch: string | null }[],
    // Each Node's tasks with their page addresses, and its handoffs.
    taskPages: [] as BridgePageTask[],
    handoffs: [] as BridgeHandoff[],
  }
  const nodes = () => ({
    nodes: ['n1', 'n2'].map((nodeId) => ({ nodeId, label: nodeId, endpoint: `https://${nodeId}.test`, local: false })),
    activeNodeId: state.active,
    status: { nodeId: state.active, state: 'online' },
  })
  const answer = (request: Request): unknown => {
    const nodeId = request.nodeId as string
    switch (request.op) {
      case 'nodes.list':
        return nodes()
      case 'node.select':
        state.active = request.nodeId as string
        return nodes()
      case 'handoffs.list':
        return { nodeId, handoffs: nodeId === 'n1' ? state.handoffs : [] }
      case 'tasks.pages':
        return { nodeId, tasks: nodeId === 'n1' ? state.taskPages : [] }
      case 'sites.list':
        return { nodeId, sites: state.sites[nodeId] }
      case 'site.add':
      case 'site.remove': {
        const projectId = request.projectId as string
        const site = request.site as { origin: string; pathPrefix: string }
        const others = state.sites[nodeId]!.filter(
          (row) => !(row.projectId === projectId && row.origin === site.origin && row.pathPrefix === site.pathPrefix),
        )
        state.sites[nodeId] = request.op === 'site.add' ? [...others, { projectId, ...site }] : others
        const sites = state.sites[nodeId]!.filter((row) => row.projectId === projectId).map(
          ({ origin, pathPrefix }) => ({ origin, pathPrefix }),
        )
        return { nodeId, projectId, sites }
      }
      case 'projects.list':
        return {
          nodeId,
          projects: [
            { id: 'p1', name: 'Web', path: null, hidden: false },
            { id: 'p2', name: 'Docs', path: null, hidden: false },
            { id: 'p3', name: 'Everything', path: null, hidden: false },
            ...state.addedProjects,
          ],
        }
      case 'tasks.list':
        return {
          nodeId,
          projectId: request.projectId,
          tasks:
            request.projectId === 'p1' ? [{ id: 't1', title: 'Fix login', branch: null }, ...state.addedTasks] : [],
        }
      case 'sessions.list':
        return { nodeId, taskId: request.taskId, sessions: request.taskId === 't1' ? [session] : [] }
      case 'requests.pending':
        return { nodeId, requests: state.pending }
      case 'session.read':
        return { nodeId, sessionId: request.sessionId, session, records: [], reach: 0, queued: [], requests: [] }
    }
    return undefined
  }
  fake.onNativeMessage = (raw, host) => {
    const request = raw as Request
    state.requests.push(request)
    const reply = () => host.send({ v: 1, id: request.id, ok: true, result: answer(request) })
    if (request.op === 'sites.list' && state.holdSites) state.held.push(reply)
    else reply()
  }
  startBackground(fake.api, 'com.acorn.browser_bridge')
  const root = document.createElement('div')
  document.body.append(root)
  dispose = render(() => <App api={fake.api} />, root)
  return { fake, state, root }
}

const fill = (root: HTMLElement, selector: string, value: string) => {
  const field = root.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!
  field.value = value
  field.dispatchEvent(new Event('input', { bubbles: true }))
}
const suggestedOptions = (root: HTMLElement) =>
  [...root.querySelectorAll('select[name="project"] optgroup[label="Suggested for this page"] option')].map(
    (option) => option.textContent,
  )
const siteAccess = (root: HTMLElement) =>
  [...root.querySelectorAll('[aria-label="Site access"] li')].map(
    (row) => `${row.querySelector('strong')!.textContent}: ${row.querySelector('.quiet')!.textContent}`,
  )

const site = (projectId: string, origin: string, pathPrefix = '/'): ProjectSite => ({ projectId, origin, pathPrefix })

describe('project suggestions for a site', () => {
  it('reads the project list again when the Node says a project changed', async () => {
    const { fake, state, root } = mount({ url: 'https://example.com/', sites: [site('p1', 'https://example.com')] })
    await settle(30)
    const options = () =>
      [...root.querySelectorAll('select[name="project"] option')].map((option) => option.textContent)
    expect(options()).not.toContain('Admin')

    state.addedProjects.push({ id: 'p4', name: 'Admin', path: null, hidden: false })
    fake.hosts[0]!.send({ v: 1, event: 'projects', nodeId: 'n1' })
    await settle(20)
    expect(options()).toContain('Admin')
  })

  it('chooses the project of each path, and leaves overlapping matches to the picker', async () => {
    const { fake, state, root } = mount({
      url: 'https://example.com/app/login',
      sites: [site('p1', 'https://example.com', '/app'), site('p2', 'https://example.com', '/docs')],
    })
    await settle(30)
    expect(selected(root, 'project')).toBe('p1')
    expect(suggestedOptions(root)).toEqual(['Web'])
    // Matching happens here: no page address went to the Node.
    expect(JSON.stringify(state.requests)).not.toContain('/app/login')

    fake.navigate('https://example.com/docs/intro')
    await settle(20)
    expect(selected(root, 'project')).toBe('p2')

    // Another client associates a third project with the whole site, and the Node says projects changed.
    state.sites.n1!.push(site('p3', 'https://example.com'))
    fake.hosts[0]!.send({ v: 1, event: 'projects', nodeId: 'n1' })
    await settle(20)
    // Docs is still one of the page's candidates, so it stays chosen.
    expect(selected(root, 'project')).toBe('p2')
    expect(suggestedOptions(root)).toEqual(['Docs', 'Everything'])
    // Overlapping prefixes are both candidates, and a project they leave out is cleared.
    fake.navigate('https://example.com/app/login')
    await settle(20)
    expect(selected(root, 'project')).toBe('')
    expect(suggestedOptions(root)).toEqual(['Web', 'Everything'])
    expect(root.textContent).toContain('Several projects match this page. Choose one.')

    // An unmatched page shows only the Acorn mark.
    await pick(root, 'project', 'p3')
    fake.navigate('https://elsewhere.example/')
    await settle(20)
    expect(suggestedOptions(root)).toEqual([])
    expect(idle(root)).toBe(true)
  })

  it('remembers an override for the Node and site, until the page suggests other projects', async () => {
    const { fake, root } = mount({
      url: 'https://example.com/app',
      sites: [site('p1', 'https://example.com', '/app'), site('p2', 'https://example.com', '/docs')],
    })
    await settle(30)
    expect(selected(root, 'project')).toBe('p1')
    await pick(root, 'project', 'p3')
    expect(fake.storage.get('siteChoices:n1')).toEqual({ 'https://example.com p1': 'p3' })

    fake.navigate('https://example.com/docs')
    await settle(20)
    expect(selected(root, 'project')).toBe('p2')
    fake.navigate('https://example.com/app/settings')
    await settle(20)
    expect(selected(root, 'project')).toBe('p3')

    // Choosing the suggestion again forgets the override.
    await pick(root, 'project', 'p1')
    expect(fake.storage.get('siteChoices:n1')).toEqual({})
  })

  it('keeps the current task, its conversation, and its draft on a localhost page that suggests another project', async () => {
    const { fake, root } = mount({
      url: 'http://localhost:5173/shop',
      sites: [site('p1', 'http://localhost:5173', '/shop'), site('p2', 'http://localhost:5173', '/admin')],
    })
    await settle(30)
    expect(selected(root, 'project')).toBe('p1')
    await useTask(root, 'Fix login')
    await openChat(root, 'Chat s1')
    fill(root, 'textarea[name="message"]', 'Half a thought')
    await settle(20)

    fake.navigate('http://localhost:5173/admin/users')
    await settle(20)
    expect(conversationTitle(root)).toBe('Claude · Chat s1')
    await back(root)
    // This page follows the page; the current task stays.
    expect(selected(root, 'project')).toBe('p2')
    expect(currentTask(root)).toBe('Fix login')
    // Another port on localhost is another site, which matches nothing and moves nothing.
    fake.navigate('http://localhost:5174/admin')
    await settle(20)
    expect(idle(root)).toBe(true)
    expect(fake.storage.get('destination:n1')).toMatchObject({ taskId: 't1' })
    expect(fake.storage.get('draft:n1:t1:s1')).toEqual({ text: 'Half a thought' })
  })

  it('drops a Node’s associations that arrive after the person switched Nodes', async () => {
    const { state, root } = mount({ url: 'https://example.com/', sites: [site('p1', 'https://example.com')] })
    state.holdSites = true
    await settle(30)
    // The sidebar's read, and the background's for the toolbar badge.
    expect(state.held).toHaveLength(2)
    await useNode(root, 'n2')
    state.held.splice(0).forEach((reply) => reply())
    await settle(20)
    expect(state.active).toBe('n2')
    expect(root.querySelector('select[name="project"]')).toBeNull()
    expect(idle(root)).toBe(true)
    await openSettings(root)
    expect(siteAccess(root)).toEqual([])
  })
})

describe('the project site editor', () => {
  it('adds and removes associations, and refuses what it cannot store', async () => {
    const { state, root } = mount({ url: 'https://example.com/app/login' })
    await settle(30)
    await openSettings(root)
    await pick(root, 'sites-project', 'p1')
    expect(root.querySelectorAll('[data-testid="project-site"]')).toHaveLength(0)

    fill(root, 'input[name="site"]', 'ftp://example.com')
    root
      .querySelector('form:has(input[name="site"])')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await settle(20)
    expect(root.querySelector('.sites [role="alert"]')!.textContent).toBe('Use an http:// or https:// address.')
    fill(root, 'input[name="site"]', 'https://user:pw@example.com')
    root
      .querySelector('form:has(input[name="site"])')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await settle(20)
    expect(root.querySelector('.sites [role="alert"]')!.textContent).toBe('Leave the user name and password out.')
    expect(state.requests.some((request) => request.op === 'site.add')).toBe(false)

    fill(root, 'input[name="site"]', 'https://Example.com/app/')
    root
      .querySelector('form:has(input[name="site"])')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await settle(20)
    expect(state.requests.find((request) => request.op === 'site.add')).toMatchObject({
      nodeId: 'n1',
      projectId: 'p1',
      site: { origin: 'https://example.com', pathPrefix: '/app' },
    })
    button(root, 'Add https://example.com')!.click()
    await settle(20)
    const listed = () => [...root.querySelectorAll('[data-testid="project-site"]')].map((row) => row.textContent)
    expect(listed()).toEqual(['https://example.com/app', 'https://example.com'])
    expect(button(root, 'Add https://example.com')).toBeUndefined()
    // Where a project is suggested and what the extension may read are listed apart.
    expect(siteAccess(root)).toEqual(['example.com: Project suggestions · Not allowed'])

    button(root, 'Remove')!.click()
    await settle(20)
    expect(listed()).toEqual(['https://example.com'])
    expect(state.sites.n1).toEqual([site('p1', 'https://example.com')])
  })

  it('asks for access to a localhost association by host, as browsers grant it', async () => {
    const { fake, root } = mount({ sites: [site('p1', 'http://localhost:5173', '/admin')] })
    await settle(30)
    await openSettings(root)
    expect(siteAccess(root)).toEqual(['http://localhost: Project suggestions · Not allowed'])
    button(root, 'Allow')!.click()
    await settle(20)
    expect(fake.granted.has('http://localhost/*')).toBe(true)
    expect(siteAccess(root)).toEqual(['http://localhost: Project suggestions · Allowed'])
  })
})

describe('requests waiting on the Node', () => {
  const waiting = (requestId: string, projectId: string, taskId: string, sessionId: string) => ({
    requestId,
    sessionId,
    taskId,
    projectId,
    kind: 'question',
    title: `Question ${requestId}`,
    taskTitle: 'Fix login',
  })
  const listed = (root: HTMLElement) =>
    [...root.querySelectorAll('[aria-label="Waiting for you"] [data-testid="waiting-title"]')].map(
      (row) => row.textContent,
    )
  const pathSites = [site('p1', 'https://example.com', '/app'), site('p2', 'https://example.com', '/docs')]

  it("lists every project's requests, opens the one chosen, and leaves the badge to the page", async () => {
    const { fake, state, root } = mount({ url: 'https://example.com/app/login', sites: pathSites })
    expect(root.querySelector('[aria-label="Waiting for you"]')).toBeNull()
    state.pending = [waiting('r1', 'p1', 't1', 's1'), waiting('r2', 'p2', 't2', 's2')]
    await settle(40)
    expect(listed(root)).toEqual(['Question r1', 'Question r2'])
    // The badge counts only the page's projects.
    expect(fake.badges.get(7)).toBe('1')

    button(root.querySelector('[aria-label="Waiting for you"]')!, 'Open')!.click()
    await settle(40)
    expect(conversationTitle(root)).toBe('Claude · Chat s1')
  })

  it("asks for notifications only from the person's click, and opens a clicked notification's conversation", async () => {
    const { fake, state, root } = mount({ url: 'https://example.com/app/login', sites: pathSites })
    state.pending = [waiting('r1', 'p1', 't1', 's1')]
    await settle(40)
    expect(fake.notified).toEqual([])
    await openSettings(root)
    const notify = () => root.querySelector<HTMLInputElement>('input[name="notify"]')!
    notify().checked = true
    notify().dispatchEvent(new Event('change', { bubbles: true }))
    await settle(40)
    expect(fake.granted.has('notifications')).toBe(true)
    expect(notify().checked).toBe(true)
    expect(fake.notified).toEqual(['acorn-request:s1:r1'])

    // The click leaves Settings for the request's conversation.
    fake.clickNotification('acorn-request:s1:r1')
    await settle(40)
    expect(conversationTitle(root)).toBe('Claude · Chat s1')

    await openSettings(root)
    notify().checked = false
    notify().dispatchEvent(new Event('change', { bubbles: true }))
    await settle(20)
    expect(fake.granted.has('notifications')).toBe(false)

    // The person declines the browser's prompt: the box goes back to unticked.
    fake.answerRequest = false
    notify().checked = true
    notify().dispatchEvent(new Event('change', { bubbles: true }))
    await settle(20)
    expect(notify().checked).toBe(false)
  })
})

describe('This page', () => {
  // The pull request t1 belongs to, and the handoff GitHub declares for pull requests.
  const pullTask: BridgePageTask = {
    id: 't1',
    title: 'Fix login',
    branch: 'fix/login',
    projectId: 'p1',
    pages: [{ origin: 'https://github.com', pathPrefix: '/acme/web/pull/7', source: 'github' }],
  }
  const pullHandoff: BridgeHandoff = {
    pluginId: 'github',
    id: 'pull',
    label: 'Open in Acorn',
    match: ['https://github.com/{owner}/{repo}/pull/{number}'],
    anchors: [],
  }
  const thisPage = (root: HTMLElement) => root.querySelector('[aria-label="This page"]')!
  const agentRows = (root: HTMLElement) =>
    [...root.querySelectorAll('[aria-label="Agents"] .row-button strong')].map((row) => row.textContent)

  it("shows the task a page belongs to, its agents, and the task's verbs, matched in the browser", async () => {
    const { fake, state, root } = mount({ url: 'https://github.com/acme/web/pull/7/files' })
    state.taskPages = [pullTask]
    await settle(30)
    expect(thisPage(root).querySelector('strong')!.textContent).toBe('Fix login')
    expect(thisPage(root).textContent).toContain('Task in Web · fix/login')
    // A development build copies the link Open in Acorn would follow, onto the pull request's pane.
    expect(button(thisPage(root), 'Copy Acorn link')!.title).toBe('acorn://n1/t/t1?pane=pr')
    expect(agentRows(root)).toEqual(['Claude · Chat s1'])
    // Nothing is current yet, and the page's task needs no second mention.
    expect(root.querySelector('[aria-label="Current task"]')).toBeNull()
    // The list came from the Node; the page's address didn't go to it.
    expect(state.requests.some((request) => request.op === 'tasks.pages')).toBe(true)
    expect(JSON.stringify(state.requests)).not.toContain('/pull/7')

    // Chat opens the task's newest conversation, which makes it the current task.
    button(thisPage(root), 'Chat')!.click()
    await settle(30)
    expect(conversationTitle(root)).toBe('Claude · Chat s1')
    await back(root)
    // A page that matches nothing shows only the Acorn mark. The task stays current for captures.
    fake.navigate('https://example.com/')
    await settle(20)
    expect(idle(root)).toBe(true)
    expect(agentRows(root)).toEqual([])
    expect(fake.storage.get('destination:n1')).toMatchObject({ taskId: 't1' })
  })

  it('moves an open conversation to the task of the page it moves to', async () => {
    const { fake, state, root } = mount({ url: 'https://github.com/acme/web/pull/7' })
    const otherTask: BridgePageTask = {
      ...pullTask,
      id: 't2',
      title: 'Speed up search',
      pages: [{ origin: 'https://github.com', pathPrefix: '/acme/web/pull/9', source: 'github' }],
    }
    state.taskPages = [pullTask, otherTask]
    state.addedTasks.push({ id: 't2', title: 'Speed up search', branch: null })
    await settle(30)
    button(thisPage(root), 'Chat')!.click()
    await settle(30)
    expect(conversationTitle(root)).toBe('Claude · Chat s1')
    // The other task has no conversation, so Home opens on its new-chat picker.
    fake.navigate('https://github.com/acme/web/pull/9')
    await settle(30)
    expect(root.querySelector('[aria-label="Conversation"]')).toBeNull()
    expect(thisPage(root).querySelector('strong')!.textContent).toBe('Speed up search')
    expect(button(root.querySelector('[aria-label="Agents"]')!, 'Cancel')).toBeDefined()
    expect(fake.storage.get('destination:n1')).toMatchObject({ taskId: 't2' })
    // With no conversation open, Home's Agents follows the page on its own.
    fake.navigate('https://github.com/acme/web/pull/7/files')
    await settle(30)
    expect(agentRows(root)).toEqual(['Claude · Chat s1'])
  })

  it('reads the list again when the Node says a task changed', async () => {
    const { fake, state, root } = mount({ url: 'https://github.com/acme/web/pull/7' })
    await settle(30)
    expect(idle(root)).toBe(true)
    state.taskPages = [pullTask]
    fake.hosts[0]!.send({ v: 1, event: 'tasks', nodeId: 'n1' })
    await settle(20)
    expect(thisPage(root).querySelector('strong')!.textContent).toBe('Fix login')
  })

  it('offers the handoff for an item no task holds, and looks it up only on a click', async () => {
    const { state, root } = mount({ url: 'https://github.com/acme/web/pull/8' })
    state.taskPages = [pullTask]
    state.handoffs = [pullHandoff]
    await settle(30)
    expect(thisPage(root).textContent).toContain('No task in Acorn for this yet.')
    expect(button(thisPage(root), 'Look up in Acorn')).toBeDefined()
    expect(state.requests.some((request) => request.op === 'handoff.resolve')).toBe(false)
  })

  it("shows a project site's project, its tasks, and New task", async () => {
    const { root } = mount({ url: 'https://example.com/', sites: [site('p1', 'https://example.com')] })
    await settle(30)
    expect(selected(root, 'project')).toBe('p1')
    expect([...thisPage(root).querySelectorAll('[aria-label="Tasks"] strong')].map((row) => row.textContent)).toEqual([
      'Fix login',
    ])
    // New task opens the project in the desktop app; a development build copies that link.
    expect(button(thisPage(root), 'Copy Acorn link')!.title).toBe('acorn://n1/p/p1')
  })

  it("opens on the page's task from a chip, with a new chat about the page when asked", async () => {
    const { fake, state, root } = mount({ url: 'https://github.com/acme/web/pull/7' })
    state.taskPages = [pullTask]
    state.handoffs = [pullHandoff]
    await settle(30)
    await openSettings(root)
    fake.sendFromPage({ type: 'acorn:chip', key: 'github:pull', action: 'chat' })
    await settle(30)
    expect(root.querySelector('.view[aria-label="Settings"]')).toBeNull()
    expect(thisPage(root).querySelector('strong')!.textContent).toBe('Fix login')
    expect(root.querySelector('[aria-label="Waiting context"]')!.textContent).toContain('Page goes into the draft')
    expect(button(root.querySelector('[aria-label="Agents"]')!, 'Cancel')).toBeDefined()
  })

  it("shows a local app's branch, task, and stack, links to the plugin's pane, and asks for its site", async () => {
    const app = 'https://runn-05ea41.runn.localhost:5104'
    const { fake, state, root } = mount({ url: `${app}/planner` })
    state.taskPages = [
      {
        ...pullTask,
        pages: [
          ...pullTask.pages,
          {
            origin: app,
            pathPrefix: '/',
            source: 'runn',
            status: { label: 'Runn stack', state: 'running', tone: 'ok' },
          },
        ],
      },
    ]
    await settle(30)
    expect(thisPage(root).querySelector('strong')!.textContent).toBe('fix/login')
    expect(thisPage(root).textContent).toContain('Task: Fix login · Web')
    expect(thisPage(root).querySelector('.state')!.textContent).toBe('Runn stack running')
    expect(thisPage(root).querySelector('.dot')!.getAttribute('data-tone')).toBe('ok')
    // Logs in Acorn goes to the Runn pane; a development build copies the link.
    expect(button(thisPage(root), 'Copy Acorn link')!.title).toBe('acorn://n1/t/t1?pane=runn')
    expect(JSON.stringify(state.requests)).not.toContain('/planner')

    // The marker was hidden on this site from its own menu: This page offers it back.
    expect(button(thisPage(root), 'Show the branch marker on this site')).toBeUndefined()
    await fake.api.storage.local.set({ hiddenMarkers: [app] })
    await settle(10)
    button(thisPage(root), 'Show the branch marker on this site')!.click()
    await settle(10)
    expect(fake.storage.get('hiddenMarkers')).toEqual([])
    expect(button(thisPage(root), 'Show the branch marker on this site')).toBeUndefined()

    await openSettings(root)
    expect(siteAccess(root)).toEqual(['runn-05ea41.runn.localhost: Branch marker on its pages · Not allowed'])
  })
})
