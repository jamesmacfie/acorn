import { afterEach, describe, expect, it } from 'vitest'
import { render } from 'solid-js/web'
import type { BridgeAgentSession, BridgeHandoff, BridgePageTask } from '@acorn/protocol/extensionBridge.ts'
import { sameSite, type ProjectSite, type SiteAssociation } from '@acorn/protocol/siteAssociations.ts'
import { startBackground } from '../background/background'
import { fakeBrowser, settle } from '../test/fakeBrowser'
import {
  back,
  button,
  conversationTitle,
  goHome,
  idle,
  openChat,
  openSettings,
  openSiteTask,
  openTask,
  pick,
  selected,
  shownTask,
  useNode,
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
  model: null,
  kind: 'interactive',
  inline: false,
  runtimeState: 'ready',
  attention: 'none',
  lastEventSeq: 0,
  archivedAt: null,
  updatedAt: 1,
}

// Two paired Nodes, n1 selected, with three projects each, two in the Main workspace and one in Other. Site associations are whatever the test
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
    addedProjects: [] as { id: string; name: string; path: null; hidden: boolean; workspaceId: string }[],
    // Open tasks in p1 besides Fix login.
    addedTasks: [] as { id: string; title: string; branch: string | null }[],
    // Each Node's tasks with their page addresses, and its handoffs.
    taskPages: [{ id: 't1', title: 'Fix login', branch: null, projectId: 'p1', pages: [] }] as BridgePageTask[],
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
        return { nodeId, handoffs: nodeId === 'n1' ? state.handoffs : [], panels: [] }
      case 'tasks.pages':
        return { nodeId, tasks: nodeId === 'n1' ? state.taskPages : [] }
      case 'sites.list':
        return { nodeId, sites: state.sites[nodeId] }
      case 'site.add':
      case 'site.remove': {
        const projectId = request.projectId as string
        const site = request.site as SiteAssociation
        const others = state.sites[nodeId]!.filter((row) => !(row.projectId === projectId && sameSite(row, site)))
        state.sites[nodeId] = request.op === 'site.add' ? [...others, { projectId, ...site }] : others
        const sites = state.sites[nodeId]!.filter((row) => row.projectId === projectId).map(
          ({ projectId: _projectId, ...rest }) => rest,
        )
        return { nodeId, projectId, sites }
      }
      case 'projects.list':
        return {
          nodeId,
          projects: [
            { id: 'p1', name: 'Web', path: null, hidden: false, workspaceId: 'w1' },
            { id: 'p2', name: 'Docs', path: null, hidden: false, workspaceId: 'w1' },
            { id: 'p3', name: 'Everything', path: null, hidden: false, workspaceId: 'w2' },
            ...state.addedProjects,
          ],
          workspaces: [
            { id: 'w1', name: 'Main' },
            { id: 'w2', name: 'Other' },
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

const fill = (root: ParentNode, selector: string, value: string) => {
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

    state.addedProjects.push({ id: 'p4', name: 'Admin', path: null, hidden: false, workspaceId: 'w1' })
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

    // An unmatched page shows only the task list.
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

  it('keeps the conversation and its draft on a localhost page that suggests another project', async () => {
    const { fake, root } = mount({
      url: 'http://localhost:5173/shop',
      sites: [site('p1', 'http://localhost:5173', '/shop'), site('p2', 'http://localhost:5173', '/admin')],
    })
    await settle(30)
    expect(selected(root, 'project')).toBe('p1')
    await openSiteTask(root, 'Fix login')
    expect(shownTask(root)).toBe('Fix login')
    await openChat(root, 'Chat s1')
    fill(root, 'textarea[name="message"]', 'Half a thought')
    await settle(20)

    // A page no task holds leaves the conversation where it is.
    fake.navigate('http://localhost:5173/admin/users')
    await settle(20)
    expect(conversationTitle(root)).toBe('Chat s1')
    // This page follows the page.
    await goHome(root)
    expect(selected(root, 'project')).toBe('p2')
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
  it('adds each kind of site from a dialog that starts on the page, and removes them', async () => {
    const { state, root } = mount({ url: 'https://example.com/app/login' })
    await settle(30)
    await openSettings(root)
    button(root, 'Projects')!.click()
    await settle(20)
    expect(root.querySelectorAll('[data-testid="project-site"]')).toHaveLength(0)
    const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')
    const open = async () => {
      button(root, 'Add site')!.click()
      await settle(20)
    }
    const submit = async () => {
      button(dialog()!, 'Add site')!.click()
      await settle(20)
    }
    const added = () => state.requests.filter((request) => request.op === 'site.add')

    // The page's domain, on the first project, by default.
    await open()
    expect(dialog()!.querySelector<HTMLInputElement>('input[name="site"]')!.value).toBe('example.com')
    expect(selected(dialog()!, 'site-project')).toBe('p1')
    await submit()
    expect(dialog()).toBeNull()
    expect(added().at(-1)).toMatchObject({ nodeId: 'n1', projectId: 'p1', site: { domain: 'example.com' } })

    // A pattern starts empty, says whether it covers the page, and is checked before it is sent.
    await open()
    button(dialog()!, 'Regex')!.click()
    await settle(20)
    expect(dialog()!.querySelector<HTMLInputElement>('input[name="site"]')!.value).toBe('')
    fill(dialog()!, 'input[name="site"]', '(')
    await submit()
    expect(dialog()!.textContent).toContain("That pattern isn't a valid regular expression.")
    expect(added()).toHaveLength(1)
    fill(dialog()!, 'input[name="site"]', '/app/')
    await settle(20)
    expect(dialog()!.textContent).toContain('Covers this page.')
    await submit()
    expect(added().at(-1)).toMatchObject({ projectId: 'p1', site: { regex: '/app/' } })

    // Another project, and the page's address as a prefix.
    await open()
    await pick(dialog()!, 'site-project', 'p2')
    button(dialog()!, 'Starts with')!.click()
    await settle(20)
    await submit()
    expect(added().at(-1)).toMatchObject({
      projectId: 'p2',
      site: { origin: 'https://example.com', pathPrefix: '/app/login' },
    })

    const listed = (project: string) =>
      [...root.querySelectorAll(`[aria-label="${project}"] [data-testid="project-site"]`)].map((row) => row.textContent)
    expect(listed('Web')).toEqual(['example.com', '/app/'])
    expect(listed('Docs')).toEqual(['https://example.com/app/login'])
    // Where a project is suggested and what the extension may read are listed apart. A pattern asks
    // for no access.
    expect(siteAccess(root)).toEqual([
      '*.example.com: Project suggestions · Not allowed',
      'example.com: Project suggestions · Not allowed',
    ])

    button(root.querySelector('[aria-label="Web"]')!, 'Remove')!.click()
    await settle(20)
    expect(listed('Web')).toEqual(['/app/'])
    expect(state.sites.n1).toEqual([
      { projectId: 'p1', regex: '/app/' },
      { projectId: 'p2', origin: 'https://example.com', pathPrefix: '/app/login' },
    ])
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
    expect(conversationTitle(root)).toBe('Chat s1')
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
    expect(conversationTitle(root)).toBe('Chat s1')

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

  it('opens the task a page belongs to, names it, and shows its verbs on Home, matched in the browser', async () => {
    const { fake, state, root } = mount({ url: 'https://github.com/acme/web/pull/7/files' })
    state.taskPages = [pullTask]
    await settle(30)
    // The panel opens on the page's task, which the top bar names, tagged as this page's.
    expect(shownTask(root)).toBe('Fix login')
    expect(root.querySelector('header .detail')!.textContent).toBe('Web · fix/loginThis page')
    expect(agentRows(root)).toEqual(['Chat s1'])
    // The list came from the Node; the page's address didn't go to it.
    expect(state.requests.some((request) => request.op === 'tasks.pages')).toBe(true)
    expect(JSON.stringify(state.requests)).not.toContain('/pull/7')

    await goHome(root)
    expect(thisPage(root).querySelector('strong')!.textContent).toBe('Fix login')
    expect(thisPage(root).textContent).toContain('Task in Web · fix/login')
    // A development build copies the link Open in Acorn would follow, onto the pull request's pane.
    expect(button(thisPage(root), 'Copy Acorn link')!.title).toBe('acorn://n1/t/t1?pane=pr')
    expect(root.querySelector('[aria-label="Current task"]')).toBeNull()

    // Chat opens the task's newest conversation, and Back goes up to the task.
    button(thisPage(root), 'Chat')!.click()
    await settle(30)
    expect(conversationTitle(root)).toBe('Chat s1')
    await back(root)
    expect(shownTask(root)).toBe('Fix login')
    // A page that matches nothing leaves the task shown, no longer tagged as this page's.
    fake.navigate('https://example.com/')
    await settle(20)
    expect(shownTask(root)).toBe('Fix login')
    expect(root.querySelector('header .here')).toBeNull()
    expect(agentRows(root)).toEqual(['Chat s1'])
    await goHome(root)
    expect(idle(root)).toBe(true)
    expect(fake.storage.get('destination:n1')).toMatchObject({ taskId: 't1' })
  })

  it("keeps an open conversation on another task's page, until Switch opens that task", async () => {
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
    await openChat(root, 'Chat s1')
    expect(conversationTitle(root)).toBe('Chat s1')
    fake.navigate('https://github.com/acme/web/pull/9')
    await settle(30)
    expect(conversationTitle(root)).toBe('Chat s1')
    expect(root.querySelector('.strip')!.textContent).toBe('This page is in Speed up searchSwitch')
    button(root.querySelector('.strip')!, 'Switch')!.click()
    await settle(30)
    // Speed up search has no conversation, so its Agents tab shows the new-chat picker.
    expect(shownTask(root)).toBe('Speed up search')
    expect(root.querySelector('[aria-label="Conversation"]')).toBeNull()
    expect(button(root.querySelector('.view[aria-label="Agents"]')!, 'New chat')).toBeDefined()
    expect(root.querySelector('.strip')).toBeNull()
    expect(fake.storage.get('destination:n1')).toMatchObject({ taskId: 't2' })
    // With no conversation open, the panel follows the page to its task.
    fake.navigate('https://github.com/acme/web/pull/7/files')
    await settle(30)
    expect(shownTask(root)).toBe('Fix login')
    expect(agentRows(root)).toEqual(['Chat s1'])
  })

  it("draws one strip: the Node offline before another task's page", async () => {
    const { fake, state, root } = mount({ url: 'https://github.com/acme/web/pull/9' })
    state.taskPages = [
      pullTask,
      {
        ...pullTask,
        id: 't2',
        title: 'Speed up search',
        pages: [{ origin: 'https://github.com', pathPrefix: '/acme/web/pull/9', source: 'github' }],
      },
    ]
    await settle(30)
    await openTask(root, 'Fix login')
    const strips = () => [...root.querySelectorAll('.strip')].map((strip) => strip.textContent)
    expect(strips()).toEqual(['This page is in Speed up searchSwitch'])
    fake.hosts[0]!.send({ v: 1, event: 'status', status: { nodeId: 'n1', state: 'offline' } })
    await settle(20)
    expect(strips()).toEqual(['n1 is offlineRetry'])
    // What the panel shows stays readable.
    expect(shownTask(root)).toBe('Fix login')
    fake.hosts[0]!.send({ v: 1, event: 'status', status: { nodeId: 'n1', state: 'online' } })
    await settle(20)
    expect(strips()).toEqual(['This page is in Speed up searchSwitch'])
  })

  it('goes Home when the task it shows leaves the Node', async () => {
    const { fake, state, root } = mount({ url: 'https://github.com/acme/web/pull/7' })
    state.taskPages = [pullTask]
    await settle(30)
    expect(shownTask(root)).toBe('Fix login')
    state.taskPages = []
    fake.hosts[0]!.send({ v: 1, event: 'tasks', nodeId: 'n1' })
    await settle(20)
    expect(root.querySelector('.view[aria-label="Home"]')).not.toBeNull()
  })

  it("names the page's other task under a task opened from Home, and Switch opens it", async () => {
    const { root, state } = mount({ url: 'https://github.com/acme/web/pull/9' })
    state.taskPages = [
      pullTask,
      {
        ...pullTask,
        id: 't2',
        title: 'Speed up search',
        pages: [{ origin: 'https://github.com', pathPrefix: '/acme/web/pull/9', source: 'github' }],
      },
    ]
    state.addedTasks.push({ id: 't2', title: 'Speed up search', branch: null })
    await settle(30)
    expect(shownTask(root)).toBe('Speed up search')
    await goHome(root)
    const row = [...root.querySelectorAll<HTMLButtonElement>('section[aria-label="Tasks"] .row-button')].find(
      (each) => each.querySelector('strong')!.textContent === 'Fix login',
    )!
    row.click()
    await settle(20)
    expect(shownTask(root)).toBe('Fix login')
    expect(root.querySelector('.strip')!.textContent).toBe('This page is in Speed up searchSwitch')
    button(root.querySelector('.strip')!, 'Switch')!.click()
    await settle(30)
    expect(shownTask(root)).toBe('Speed up search')
  })

  it('says when the page carries an item no task holds, and Start task goes Home to it', async () => {
    const { fake, state, root } = mount({ url: 'https://github.com/acme/web/pull/7' })
    state.taskPages = [pullTask]
    state.handoffs = [pullHandoff]
    await settle(30)
    expect(shownTask(root)).toBe('Fix login')
    expect(root.querySelector('.strip')).toBeNull()
    fake.navigate('https://github.com/acme/web/pull/8')
    await settle(30)
    expect(shownTask(root)).toBe('Fix login')
    expect(root.querySelector('.strip')!.textContent).toBe('This page has no taskStart task')
    button(root.querySelector('.strip')!, 'Start task')!.click()
    await settle(30)
    expect(thisPage(root).querySelector('[aria-label="Handoff"]')).not.toBeNull()
  })

  it('reads the list again when the Node says a task changed, and leaves the panel where it is', async () => {
    const { fake, state, root } = mount({ url: 'https://github.com/acme/web/pull/7' })
    await settle(30)
    expect(idle(root)).toBe(true)
    state.taskPages = [pullTask]
    fake.hosts[0]!.send({ v: 1, event: 'tasks', nodeId: 'n1' })
    await settle(20)
    expect(thisPage(root).querySelector('strong')!.textContent).toBe('Fix login')
  })

  it('looks up an item no task holds without a click', async () => {
    const { state, root } = mount({ url: 'https://github.com/acme/web/pull/8' })
    state.taskPages = [pullTask]
    state.handoffs = [pullHandoff]
    await settle(30)
    expect(thisPage(root).querySelector('[aria-label="Handoff"]')).not.toBeNull()
    expect(state.requests.filter((request) => request.op === 'handoff.resolve')).toHaveLength(1)
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
    // The new-chat picker is the task's Agents tab; Home names the page waiting for the chat.
    expect(shownTask(root)).toBe('Fix login')
    expect(button(root.querySelector('.view[aria-label="Agents"]')!, 'New chat')).toBeDefined()
    await goHome(root)
    expect(thisPage(root).querySelector('strong')!.textContent).toBe('Fix login')
    expect(root.querySelector('[aria-label="Waiting context"]')!.textContent).toContain('Page goes into the draft')
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
    await goHome(root)
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

describe('Home task list', () => {
  const task = (id: string, title: string, projectId: string, pages: BridgePageTask['pages'] = []) => ({
    id,
    title,
    branch: null,
    projectId,
    pages,
  })
  const tasks = (root: HTMLElement) => root.querySelector('section[aria-label="Tasks"]')!
  const rows = (root: HTMLElement) =>
    [...tasks(root).querySelectorAll('li.task .row-button strong')].map((row) => row.textContent)
  const row = (root: HTMLElement, title: string) =>
    [...tasks(root).querySelectorAll<HTMLButtonElement>('li.task .row-button')].find(
      (element) => element.querySelector('strong')!.textContent === title,
    )!
  const toggleLinks = async (root: HTMLElement, title: string) => {
    button(tasks(root), `${title} links`)!.click()
    await settle(20)
  }

  it("lists one workspace's tasks by project, and remembers the workspace chosen", async () => {
    const { fake, state, root } = mount({ url: 'https://example.com/' })
    state.taskPages = [task('t1', 'Fix login', 'p1'), task('t2', 'Write guide', 'p2'), task('t3', 'Tidy', 'p3')]
    await settle(30)
    expect(selected(root, 'workspace')).toBe('w1')
    expect([...tasks(root).querySelectorAll('h3')].map((heading) => heading.textContent)).toEqual(['Web', 'Docs'])
    expect(rows(root)).toEqual(['Fix login', 'Write guide'])

    await pick(root, 'workspace', 'w2')
    expect(rows(root)).toEqual(['Tidy'])
    expect(fake.storage.get('homeWorkspace:n1')).toBe('w2')
    await openSettings(root)
    await back(root)
    expect(selected(root, 'workspace')).toBe('w2')
    expect(rows(root)).toEqual(['Tidy'])
  })

  it('opens a task from its row, and folds out its links, switching to an open tab or opening a new one', async () => {
    const { fake, state, root } = mount({ url: 'https://github.com/acme/web/pull/7' })
    state.taskPages = [
      task('t1', 'Fix login', 'p1', [
        { origin: 'https://github.com', pathPrefix: '/acme/web/pull/7', source: 'github' },
      ]),
      task('t2', 'Write guide', 'p2', [
        { origin: 'https://linear.app', pathPrefix: '/acme/issue/ENG-1', source: 'linear' },
        {
          origin: 'https://runn-1.runn.localhost:5104',
          pathPrefix: '/',
          source: 'runn',
          status: { label: 'Runn stack', state: 'running', tone: 'ok' },
        },
      ]),
      task('t3', 'Tidy docs', 'p2'),
    ]
    fake.otherTabs = [{ id: 9, windowId: 2, url: 'https://linear.app/acme/issue/ENG-1/fix-it' }]
    await settle(30)
    await goHome(root)
    const links = () =>
      [...tasks(root).querySelectorAll('.task-links li')].map((item) => item.textContent?.replace(/\s+/g, ' ').trim())

    await toggleLinks(root, 'Write guide')
    expect(links()).toEqual([
      'linear.app/acme/issue/ENG-1Switch to tab',
      'Runn stack runningOpen',
      'Copy Acorn linkChat',
    ])
    button(tasks(root), 'Switch to tab')!.click()
    button(tasks(root), 'Open')!.click()
    await settle(20)
    expect(fake.shownTabs).toEqual([9])
    expect(fake.focusedWindows).toEqual([2])
    expect(fake.createdTabs).toEqual(['https://runn-1.runn.localhost:5104/'])
    // The tab closed, so its link opens a new one.
    fake.closeTab(9)
    await settle(20)
    expect(links()[0]).toBe('linear.app/acme/issue/ENG-1Open')

    // One task's links at a time, and a task with none says so.
    await toggleLinks(root, 'Tidy docs')
    expect(links()).toEqual(['No links for this task.Copy Acorn linkChat'])

    // A row opens its task, and so does the page's task under This page.
    row(root, 'Write guide').click()
    await settle(30)
    expect(shownTask(root)).toBe('Write guide')
    await goHome(root)
    root.querySelector<HTMLButtonElement>('[aria-label="This page"] .row-button')!.click()
    await settle(30)
    expect(shownTask(root)).toBe('Fix login')
    expect(
      [...root.querySelectorAll('[aria-label="Agents"] .row-button strong')].map((item) => item.textContent),
    ).toEqual(['Chat s1'])
  })
})
