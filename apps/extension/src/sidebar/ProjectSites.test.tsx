import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'solid-js/web'
import type { BridgeAgentSession, BridgeHandoff, BridgePageTask } from '@acorn/protocol/extensionBridge.ts'
import { sameSite, type ProjectSite, type SiteAssociation } from '@acorn/protocol/siteAssociations.ts'
import { startBackground } from '../background/background'
import { fakeBrowser, settle } from '../test/fakeBrowser'
import {
  back,
  button,
  chatRows,
  conversationTitle,
  goHome,
  idle,
  openChat,
  openSettings,
  openSiteTask,
  chosen,
  openTask,
  pickFrom,
  shownTask,
  siteList,
  siteSwitch,
  taskRow,
  taskRows,
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
    // Each Node's tasks with their page addresses, and its handoffs.
    taskPages: [{ id: 't1', title: 'Fix login', branch: null, projectId: 'p1', pages: [] }] as BridgePageTask[],
    handoffs: [] as BridgeHandoff[],
    // Every task's conversations, and those archived here, which the lists leave out.
    sessions: [session] as BridgeAgentSession[],
    archived: [] as string[],
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
        return { nodeId, handoffs: nodeId === 'n1' ? state.handoffs : [], panels: [], icons: [] }
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
      case 'sessions.list': {
        const rows = state.sessions.filter((row) => !state.archived.includes(row.id))
        return request.workspaceId
          ? { nodeId, workspaceId: request.workspaceId, sessions: rows }
          : { nodeId, taskId: request.taskId, sessions: rows.filter((row) => row.taskId === request.taskId) }
      }
      case 'session.archive':
        state.archived.push(request.sessionId as string)
        return { nodeId, sessionId: request.sessionId }
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
const thisPage = (root: HTMLElement) => root.querySelector('[aria-label="This page"]')!
// This page's project picker, by the name it shows, and its rows by group, each its name and
// workspace, read by opening it and closing it again. A page on no project's site has no picker.
const siteProject = (root: HTMLElement) => chosen(thisPage(root), 'Project')
async function projectGroups(root: HTMLElement): Promise<Record<string, string[]>> {
  const trigger = thisPage(root) && button(thisPage(root), 'Project')
  if (!trigger) return {}
  trigger.click()
  await settle()
  const groups: Record<string, string[]> = {}
  let group = ''
  for (const row of document.querySelectorAll('.repo-picker-popover :is(.repo-picker-group, .repo-picker-name)')) {
    if (row.classList.contains('repo-picker-group')) group = row.textContent!
    else (groups[group] ??= []).push([...row.children].map((part) => part.textContent).join(' · '))
  }
  trigger.click()
  await settle()
  return groups
}
const suggestedOptions = async (root: HTMLElement) =>
  ((await projectGroups(root))['Suggested for this page'] ?? []).map((row) => row.split(' · ')[0])

const site = (projectId: string, origin: string, pathPrefix = '/'): ProjectSite => ({ projectId, origin, pathPrefix })

describe('project suggestions for a site', () => {
  it('reads the project list again when the Node says a project changed', async () => {
    const { fake, state, root } = mount({ url: 'https://example.com/', sites: [site('p1', 'https://example.com')] })
    await settle(30)
    const options = async () =>
      (await projectGroups(root))['Suggested for this page']!.concat((await projectGroups(root))['Other projects']!)
    expect(await options()).not.toContain('Admin · Main')

    state.addedProjects.push({ id: 'p4', name: 'Admin', path: null, hidden: false, workspaceId: 'w1' })
    fake.hosts[0]!.send({ v: 1, event: 'projects', nodeId: 'n1' })
    await settle(20)
    expect(await options()).toContain('Admin · Main')
  })

  it('chooses the project of each path, and leaves overlapping matches to the picker', async () => {
    const { fake, state, root } = mount({
      url: 'https://example.com/app/login',
      sites: [site('p1', 'https://example.com', '/app'), site('p2', 'https://example.com', '/docs')],
    })
    await settle(30)
    expect(siteProject(root)).toBe('Web')
    expect(await suggestedOptions(root)).toEqual(['Web'])
    // Matching happens here: no page address went to the Node.
    expect(JSON.stringify(state.requests)).not.toContain('/app/login')

    fake.navigate('https://example.com/docs/intro')
    await settle(20)
    expect(siteProject(root)).toBe('Docs')

    // Another client associates a third project with the whole site, and the Node says projects changed.
    state.sites.n1!.push(site('p3', 'https://example.com'))
    fake.hosts[0]!.send({ v: 1, event: 'projects', nodeId: 'n1' })
    await settle(20)
    // Docs is still one of the page's candidates, so it stays chosen.
    expect(siteProject(root)).toBe('Docs')
    expect(await suggestedOptions(root)).toEqual(['Docs', 'Everything'])
    // Overlapping prefixes are both candidates, and a project they leave out is cleared.
    fake.navigate('https://example.com/app/login')
    await settle(20)
    expect(siteProject(root)).toBe('Choose a project')
    expect(await suggestedOptions(root)).toEqual(['Web', 'Everything'])
    // The picker says it, with no sentence asking the person to choose.
    expect(await projectGroups(root)).toEqual({
      'Suggested for this page': ['Web · Main', 'Everything · Other'],
      'Other projects': ['Docs · Main'],
    })
    expect(root.textContent).not.toContain('Several projects')

    // An unmatched page shows only the task list.
    await pickFrom(thisPage(root), 'Project', 'Everything')
    fake.navigate('https://elsewhere.example/')
    await settle(20)
    expect(await suggestedOptions(root)).toEqual([])
    expect(idle(root)).toBe(true)
  })

  it('remembers an override for the Node and site, until the page suggests other projects', async () => {
    const { fake, root } = mount({
      url: 'https://example.com/app',
      sites: [site('p1', 'https://example.com', '/app'), site('p2', 'https://example.com', '/docs')],
    })
    await settle(30)
    expect(siteProject(root)).toBe('Web')
    await pickFrom(thisPage(root), 'Project', 'Everything')
    expect(fake.storage.get('siteChoices:n1')).toEqual({ 'https://example.com p1': 'p3' })

    fake.navigate('https://example.com/docs')
    await settle(20)
    expect(siteProject(root)).toBe('Docs')
    fake.navigate('https://example.com/app/settings')
    await settle(20)
    expect(siteProject(root)).toBe('Everything')

    // Choosing the suggestion again forgets the override.
    await pickFrom(thisPage(root), 'Project', 'Web')
    expect(fake.storage.get('siteChoices:n1')).toEqual({})
  })

  it('keeps the conversation and its draft on a localhost page that suggests another project', async () => {
    const { fake, root } = mount({
      url: 'http://localhost:5173/shop',
      sites: [site('p1', 'http://localhost:5173', '/shop'), site('p2', 'http://localhost:5173', '/admin')],
    })
    await settle(30)
    expect(siteProject(root)).toBe('Web')
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
    expect(siteProject(root)).toBe('Docs')
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
    expect(root.querySelector('[aria-label="This page"]')).toBeNull()
    expect(idle(root)).toBe(true)
    await openSettings(root)
    expect(siteList(root)).toEqual([])
  })
})

describe('Settings › Sites', () => {
  const sitesSection = (root: HTMLElement) => root.querySelector<HTMLElement>('[data-settings-section="sites"]')!
  const siteMenu = async (root: HTMLElement, host: string) => {
    const row = [...sitesSection(root).querySelectorAll<HTMLElement>('.ui-row')].find(
      (candidate) => candidate.querySelector('.ui-text')?.textContent === host,
    )
    button(row!, 'Site actions')!.click()
    await settle(20)
  }

  it('adds each kind of site from a dialog that starts on the page, and edits and removes them', async () => {
    const { state, root } = mount({ url: 'https://example.com/app/login' })
    await settle(30)
    await openSettings(root)
    expect(siteList(root)).toEqual([])
    const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')
    const field = () => dialog()!.querySelector<HTMLInputElement>('input[name="site"]')!
    const open = async () => {
      button(sitesSection(root), 'Add site')!.click()
      await settle(20)
    }
    const submit = async (label = 'Add site') => {
      button(dialog()!, label)!.click()
      await settle(20)
    }
    const calls = () => state.requests.filter((request) => request.op === 'site.add' || request.op === 'site.remove')

    // The page's domain, on the first project, by default, with a check that it covers the page.
    await open()
    expect(field().value).toBe('example.com')
    expect(chosen(dialog()!, 'Project')).toBe('Web')
    expect(dialog()!.textContent).toContain('Covers this page')
    await submit()
    expect(dialog()).toBeNull()
    expect(calls().at(-1)).toMatchObject({
      op: 'site.add',
      nodeId: 'n1',
      projectId: 'p1',
      site: { domain: 'example.com' },
    })

    // A pattern starts empty, says nothing about the page, and is checked before it is sent.
    await open()
    button(dialog()!, 'Regex')!.click()
    await settle(20)
    expect(field().value).toBe('')
    fill(dialog()!, 'input[name="site"]', '(')
    await submit()
    expect(dialog()!.textContent).toContain("That pattern isn't a valid regular expression.")
    expect(calls()).toHaveLength(1)
    fill(dialog()!, 'input[name="site"]', '/app/')
    await settle(20)
    expect(dialog()!.textContent).not.toContain('Covers this page')
    await submit()
    expect(calls().at(-1)).toMatchObject({ projectId: 'p1', site: { regex: '/app/' } })

    // Another project, picked by name with its workspace beside it, and the page's address as a prefix.
    await open()
    await pickFrom(dialog()!, 'Project', 'Docs')
    button(dialog()!, 'Starts with')!.click()
    await settle(20)
    await submit()
    expect(calls().at(-1)).toMatchObject({
      projectId: 'p2',
      site: { origin: 'https://example.com', pathPrefix: '/app/login' },
    })
    // One row per site, by the access the browser grants. A regex names no host, so it has no switch.
    expect(siteList(root)).toEqual([
      '*.example.com: Suggests Web · off',
      '/app/: Suggests Web',
      'example.com: Suggests Docs · off',
    ])

    // Edit moves the pattern to Docs: the new association first, then the old one goes.
    await siteMenu(root, '/app/')
    expect(menuItems()).toEqual(['/app/ · Web', 'Edit', 'Remove'])
    await choose('Edit')
    expect(dialog()!.textContent).toContain('Edit site')
    expect(field().value).toBe('/app/')
    await pickFrom(dialog()!, 'Project', 'Docs')
    await submit('Save')
    expect(calls().slice(-2)).toMatchObject([
      { op: 'site.add', projectId: 'p2', site: { regex: '/app/' } },
      { op: 'site.remove', projectId: 'p1', site: { regex: '/app/' } },
    ])
    expect(siteList(root)).toEqual([
      'example.com: Suggests Docs · off',
      '/app/: Suggests Docs',
      '*.example.com: Suggests Web · off',
    ])

    await siteMenu(root, '*.example.com')
    await choose('Remove')
    expect(state.sites.n1).toEqual([
      { projectId: 'p2', origin: 'https://example.com', pathPrefix: '/app/login' },
      { projectId: 'p2', regex: '/app/' },
    ])
  })

  it('switches access by host, as browsers grant it, and leaves the association alone', async () => {
    const { fake, state, root } = mount({ sites: [site('p1', 'http://localhost:5173', '/admin')] })
    await settle(30)
    await openSettings(root)
    expect(siteList(root)).toEqual(['http://localhost: Suggests Web · off'])
    await siteSwitch(root, 'http://localhost')
    expect(fake.granted.has('http://localhost/*')).toBe(true)
    expect(siteList(root)).toEqual(['http://localhost: Suggests Web · on'])

    // Off asks nothing, and the project is still suggested there.
    await siteSwitch(root, 'http://localhost')
    expect(fake.granted.has('http://localhost/*')).toBe(false)
    expect(siteList(root)).toEqual(['http://localhost: Suggests Web · off'])
    expect(state.sites.n1).toHaveLength(1)

    // A declined prompt puts the switch back.
    fake.answerRequest = false
    await siteSwitch(root, 'http://localhost')
    expect(siteList(root)).toEqual(['http://localhost: Suggests Web · off'])
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
  const needsYou = (root: HTMLElement) => root.querySelector<HTMLElement>('.view [aria-label="Needs you"]')
  const listed = (root: HTMLElement) =>
    [...(needsYou(root)?.querySelectorAll('.row-title') ?? [])].map((row) => row.textContent)
  const pathSites = [site('p1', 'https://example.com', '/app'), site('p2', 'https://example.com', '/docs')]

  it("lists every project's requests, opens the one chosen, and leaves the badge to the page", async () => {
    const { fake, state, root } = mount({ url: 'https://example.com/app/login', sites: pathSites })
    expect(needsYou(root)).toBeNull()
    state.pending = [waiting('r1', 'p1', 't1', 's1'), waiting('r2', 'p2', 't2', 's2')]
    await settle(40)
    expect(listed(root)).toEqual(['Question r1', 'Question r2'])
    // The badge counts only the page's projects.
    expect(fake.badges.get(7)).toBe('1')

    // The fake reads no buttons for these, so the row opens its conversation.
    needsYou(root)!.querySelector<HTMLElement>('.ui-row')!.click()
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
  const agentRows = (root: HTMLElement) => chatRows(root).map((row) => row.querySelector('.row-title')!.textContent)

  it('opens the task a page belongs to, names it, and shows it on Home, matched in the browser', async () => {
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
    expect(thisPage(root).querySelector('.row-meta')!.textContent).toBe('Web · fix/login')
    expect(root.querySelector('[aria-label="Current task"]')).toBeNull()

    // Its one row opens the task.
    thisPage(root).querySelector<HTMLElement>('.ui-row')!.click()
    await settle(30)
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
    await settle(30)
    await openChat(root, 'Chat s1')
    expect(conversationTitle(root)).toBe('Chat s1')
    fake.navigate('https://github.com/acme/web/pull/9')
    await settle(30)
    expect(conversationTitle(root)).toBe('Chat s1')
    expect(root.querySelector('.strip')!.textContent).toBe('This page is in Speed up searchSwitch')
    button(root.querySelector('.strip')!, 'Switch')!.click()
    await settle(30)
    // Speed up search has no conversation, so its Agents tab offers to start one.
    expect(shownTask(root)).toBe('Speed up search')
    expect(root.querySelector('[aria-label="Conversation"]')).toBeNull()
    expect(button(root.querySelector('.view[aria-label="Agents"]')!, 'Start a chat')).toBeDefined()
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
    await settle(30)
    expect(shownTask(root)).toBe('Speed up search')
    await goHome(root)
    taskRow(root, 'Fix login')!.click()
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
    expect(siteProject(root)).toBe('Web')
    // Home's task rows, from the Node's task list.
    expect([...thisPage(root).querySelectorAll('[aria-label="Tasks"] .ui-row')].map((row) => row.textContent)).toEqual([
      'Fix loginProject checkout',
    ])
    // New task opens the project in the desktop app; a development build copies that link.
    expect(button(thisPage(root), 'Copy Acorn link')!.getAttribute('data-tip')).toBe('acorn://n1/p/p1')
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
    // The new-chat picker is the task's Agents tab, with the page waiting for the task's first chat.
    expect(shownTask(root)).toBe('Fix login')
    expect(button(root.querySelector('.view[aria-label="Agents"]')!, 'New chat')).toBeDefined()
    expect(root.querySelector('[aria-label="Pending item"]')!.textContent).toBe(
      'Page · PageGoes with your first message.',
    )
    expect(fake.storage.get('pendingItem:n1:t1')).toMatchObject({
      kind: 'link',
      url: 'https://github.com/acme/web/pull/7',
    })
  })

  it("shows a local app's task and stack, and asks for its site", async () => {
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
    expect(thisPage(root).querySelector('strong')!.textContent).toBe('Fix login')
    expect(thisPage(root).querySelector('.row-meta')!.textContent).toBe('Web · fix/login')
    expect(thisPage(root).querySelector('.state')!.textContent).toBe('Runn stack running')
    expect(thisPage(root).querySelector('.dot')!.getAttribute('data-tone')).toBe('ok')
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
    expect(siteList(root)).toEqual(['runn-05ea41.runn.localhost: Branch marker for Runn stack · off'])
  })
})

describe('Home task list', () => {
  const task = (
    id: string,
    title: string,
    projectId: string,
    branch: string | null = null,
    pages: BridgePageTask['pages'] = [],
  ) => ({ id, title, branch, projectId, pages })
  const PULL = { origin: 'https://github.com', pathPrefix: '/acme/web/pull/7', source: 'github' }
  const titles = (root: HTMLElement) => taskRows(root).map((row) => row.querySelector('.row-title')!.textContent)
  const groups = (root: HTMLElement) =>
    [...root.querySelectorAll('section[aria-label="Tasks"] h3')].map((heading) => heading.textContent)
  const meta = (root: HTMLElement, title: string) => taskRow(root, title)!.querySelector('.row-meta')!.textContent
  const mark = (root: HTMLElement, title: string) =>
    taskRow(root, title)!.querySelector('.ui-row-leading')!.firstElementChild!
  const filterTasks = async (root: HTMLElement, text: string) => {
    fill(root, 'input[name="task-filter"]', text)
    await settle(20)
  }
  const working = (id: string, taskId: string): BridgeAgentSession => ({
    ...session,
    id,
    taskId,
    runtimeState: 'working',
  })

  it("lists one workspace's tasks by project, and remembers the workspace chosen", async () => {
    const { fake, state, root } = mount({ url: 'https://example.com/' })
    state.taskPages = [task('t1', 'Fix login', 'p1'), task('t2', 'Write guide', 'p2'), task('t3', 'Tidy', 'p3')]
    await settle(30)
    expect(chosen(root, 'Workspace')).toBe('Main')
    expect(groups(root)).toEqual(['Web', 'Docs'])
    expect(titles(root)).toEqual(['Fix login', 'Write guide'])

    await pickFrom(root, 'Workspace', 'Other')
    expect(titles(root)).toEqual(['Tidy'])
    expect(fake.storage.get('homeWorkspace:n1')).toBe('w2')
    // The new workspace's conversations are read for its rows.
    expect(
      state.requests.filter((request) => request.op === 'sessions.list').map((request) => request.workspaceId),
    ).toEqual(['w1', 'w2'])
    await openSettings(root)
    await back(root)
    expect(chosen(root, 'Workspace')).toBe('Other')
    expect(titles(root)).toEqual(['Tidy'])
  })

  it('filters by title and branch, and hides a project left empty', async () => {
    const { state, root } = mount({ url: 'https://example.com/' })
    state.taskPages = [
      task('t1', 'Fix login', 'p1', 'fix/login'),
      task('t2', 'Write guide', 'p2'),
      task('t4', 'Tidy styles', 'p1', 'chore/css'),
    ]
    await settle(30)
    await filterTasks(root, 'CSS')
    expect(titles(root)).toEqual(['Tidy styles'])
    expect(groups(root)).toEqual(['Web'])
    await filterTasks(root, 'guide')
    expect(titles(root)).toEqual(['Write guide'])
    expect(groups(root)).toEqual(['Docs'])
    await filterTasks(root, 'nothing like it')
    expect(titles(root)).toEqual([])
    expect(root.querySelector('section[aria-label="Tasks"]')!.textContent).toContain('No open task matches.')
  })

  it("marks each task's agents: working, waiting on the person over working, or idle", async () => {
    const { fake, state, root } = mount({ url: 'https://example.com/' })
    state.taskPages = [task('t1', 'Fix login', 'p1', 'fix/login'), task('t2', 'Write guide', 'p2')]
    state.sessions = []
    await settle(30)
    expect(meta(root, 'Fix login')).toBe('fix/login')
    expect(mark(root, 'Fix login').classList.contains('idle-dot')).toBe(true)
    expect(meta(root, 'Write guide')).toBe('Project checkout')

    // Two agents start in Fix login, and the Node's hint names its task: the workspace is read again.
    state.sessions = [working('s1', 't1'), working('s2', 't1')]
    fake.hosts[0]!.send({ v: 1, event: 'agent', nodeId: 'n1', sessions: ['s1', 's2'], tasks: ['t1'], missed: false })
    await settle(40)
    expect(meta(root, 'Fix login')).toBe('fix/login · working')
    expect(mark(root, 'Fix login').getAttribute('data-spin')).toBe('')
    expect(mark(root, 'Fix login').getAttribute('aria-label')).toBe('2 agents working')
    expect(meta(root, 'Write guide')).toBe('Project checkout')

    // One asks for permission. The alert wins while the other still works.
    state.pending = [
      {
        requestId: 'r1',
        sessionId: 's1',
        taskId: 't1',
        projectId: 'p1',
        kind: 'permission',
        title: 'Run tests',
        taskTitle: 'Fix login',
      },
    ]
    fake.hosts[0]!.send({
      v: 1,
      event: 'agent',
      nodeId: 'n1',
      sessions: ['s1'],
      tasks: ['t1'],
      missed: false,
      requests: true,
    })
    await settle(40)
    expect(meta(root, 'Fix login')).toBe('fix/login · needs you')
    expect(mark(root, 'Fix login').getAttribute('aria-label')).toBe('1 agent needs you')
    expect(mark(root, 'Fix login').getAttribute('data-tone')).toBe('warn')

    // A hint about a task in no project of this workspace reads nothing.
    const reads = () => state.requests.filter((request) => request.op === 'sessions.list').length
    const before = reads()
    fake.hosts[0]!.send({ v: 1, event: 'agent', nodeId: 'n1', sessions: ['s9'], tasks: ['t9'], missed: false })
    await settle(40)
    expect(reads()).toBe(before)
  })

  it("tags the page's task, offers another task's open tab, and opens a task from its row", async () => {
    const { fake, state, root } = mount({ url: 'https://github.com/acme/web/pull/7' })
    const OTHER = { origin: 'https://github.com', pathPrefix: '/acme/web/pull/9', source: 'github' }
    state.taskPages = [task('t1', 'Fix login', 'p1', null, [PULL]), task('t2', 'Write guide', 'p2', null, [OTHER])]
    fake.otherTabs = [{ id: 9, windowId: 2, url: 'https://github.com/acme/web/pull/9/files' }]
    await settle(30)
    await goHome(root)
    expect(taskRow(root, 'Fix login')!.querySelector('.here')!.textContent).toBe('This page')
    expect(button(taskRow(root, 'Fix login')!, 'Switch to its tab')).toBeUndefined()

    // The switch button brings the other task's pull request forward, without opening the task.
    button(taskRow(root, 'Write guide')!, 'Switch to its tab')!.click()
    await settle(20)
    expect(fake.shownTabs).toEqual([9])
    expect(fake.focusedWindows).toEqual([2])
    expect(shownTask(root)).toBeNull()

    taskRow(root, 'Write guide')!.click()
    await settle(30)
    expect(shownTask(root)).toBe('Write guide')
    await goHome(root)
    // This page's one row opens the page's task.
    root.querySelector<HTMLElement>('[aria-label="This page"] .ui-row')!.click()
    await settle(30)
    expect(shownTask(root)).toBe('Fix login')
    expect(chatRows(root).map((row) => row.querySelector('.row-title')!.textContent)).toEqual(['Chat s1'])
  })
})

// Menus and the palette draw in a portal on the document's body, outside the panel's root.
const menuItems = () =>
  [...document.querySelectorAll('[role="menu"] :is(.ui-menu-item, .ui-menu-label-row)')].map((item) => item.textContent)
const menuItem = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('[role="menu"] .ui-menu-item')].find((item) =>
    item.textContent?.startsWith(label),
  )!
const choose = async (label: string) => {
  menuItem(label).click()
  await settle(20)
}
const palette = () => document.querySelector<HTMLElement>('[role="dialog"][aria-label="Go to task"]')
// The palette's group labels, marked with #, and its rows' titles, in order.
const paletteRows = () =>
  [...palette()!.querySelectorAll('.repo-picker-group, .repo-picker-row')].map((item) =>
    item.classList.contains('repo-picker-group')
      ? `# ${item.textContent}`
      : item.querySelector('.repo-picker-name > span')!.textContent,
  )
const press = async (key: string, init: KeyboardEventInit = {}) => {
  ;(document.activeElement ?? document).dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
  )
  await settle(20)
}
const commandK = () => press('k', { metaKey: true })
const filterPalette = async (text: string) => {
  const input = palette()!.querySelector('input')!
  input.value = text
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await settle(20)
}
const pageTask = (
  id: string,
  title: string,
  projectId: string,
  branch: string | null,
  pages: BridgePageTask['pages'],
) => ({
  id,
  title,
  branch,
  projectId,
  pages,
})

describe('Go to task', () => {
  const PULL = { origin: 'https://github.com', pathPrefix: '/acme/web/pull/7', source: 'github' }

  it("lists Home, the page's task, then each project's tasks under its workspace, and filters by title and branch", async () => {
    const { state, root } = mount({ url: 'https://github.com/acme/web/pull/7' })
    state.taskPages = [
      pageTask('t1', 'Fix login', 'p1', 'fix-login', [PULL]),
      pageTask('t2', 'Write guide', 'p2', null, []),
      pageTask('t3', 'Tidy', 'p3', 'tidy-up', []),
    ]
    await settle(30)
    expect(shownTask(root)).toBe('Fix login')

    await commandK()
    expect(paletteRows()).toEqual([
      'Home',
      '# This page',
      'Fix login',
      '# Main › Docs',
      'Write guide',
      '# Other › Everything',
      'Tidy',
    ])
    expect(palette()!.querySelector('.repo-picker-row:nth-of-type(3) small')?.textContent).toBe('fix-login')
    // The task the top bar names is checked.
    const checked = [...palette()!.querySelectorAll('.repo-picker-row')].filter((item) =>
      item.querySelector('.go-to-task-lead svg'),
    )
    expect(checked.map((item) => item.querySelector('.repo-picker-name > span')!.textContent)).toEqual([
      'Home',
      'Fix login',
    ])
    expect(palette()!.textContent).toContain('Project checkout')

    await filterPalette('tidy-u')
    expect(paletteRows()).toEqual(['# Other › Everything', 'Tidy'])
    await filterPalette('nothing like it')
    expect(palette()!.textContent).toContain('No open task matches.')

    // Arrow keys move from Home, and Enter opens the task under the cursor.
    await filterPalette('')
    await press('ArrowDown')
    await press('ArrowDown')
    await press('Enter')
    expect(palette()).toBeNull()
    expect(shownTask(root)).toBe('Write guide')

    // The task's title opens it too, and Escape closes it.
    root.querySelector<HTMLButtonElement>('header .heading button')!.click()
    await settle(20)
    expect(palette()).not.toBeNull()
    await press('Escape')
    expect(palette()).toBeNull()
  })

  it('opens with ⌘K from Home, a task, a conversation, and Settings, and names the Node in its footer', async () => {
    const { root } = mount({ url: 'https://example.com/' })
    await settle(30)
    const opensAndCloses = async () => {
      await commandK()
      expect(palette()).not.toBeNull()
      await commandK()
      expect(palette()).toBeNull()
    }
    await opensAndCloses()
    await openTask(root, 'Fix login')
    await opensAndCloses()
    await openChat(root, 'Chat s1')
    expect(conversationTitle(root)).toBe('Chat s1')
    await opensAndCloses()
    await openSettings(root)
    await opensAndCloses()

    // Home's button opens it, and Switch Node in the footer opens Settings.
    await goHome(root)
    button(root.querySelector('header')!, 'Go to task')!.click()
    await settle(20)
    const footer = palette()!.querySelector('.repo-picker-footer')!
    expect(footer.textContent).toContain('n1')
    button(footer, 'Switch Node')!.click()
    await settle(20)
    expect(palette()).toBeNull()
    expect(root.querySelector('header .title')?.textContent).toBe('Settings')
  })
})

describe('the task and conversation menus', () => {
  it("lists the task's pages, each switching to its browser tab or opening one, with its Acorn link and Settings", async () => {
    const writeText = vi.fn(async () => {})
    Object.assign(navigator, { clipboard: { writeText } })
    const { fake, state, root } = mount({ url: 'https://github.com/acme/web/pull/7' })
    state.taskPages = [
      pageTask('t1', 'Fix login', 'p1', null, [
        { origin: 'https://github.com', pathPrefix: '/acme/web/pull/7', source: 'github' },
        { origin: 'https://linear.app', pathPrefix: '/acme/issue/ENG-1', source: 'linear' },
        {
          origin: 'https://runn-1.runn.localhost:5104',
          pathPrefix: '/',
          source: 'runn',
          status: { label: 'Runn stack', state: 'running', tone: 'ok' },
        },
      ]),
    ]
    fake.otherTabs = [{ id: 9, windowId: 2, url: 'https://linear.app/acme/issue/ENG-1/fix-it' }]
    await settle(30)
    expect(shownTask(root)).toBe('Fix login')

    const openMenu = async () => {
      button(root, 'Task menu')!.click()
      await settle(20)
    }
    await openMenu()
    // A development build has no desktop to open the link, so it only copies it.
    expect(menuItems()).toEqual([
      'Copy Acorn link',
      'Pages',
      'Pull request #7This tab',
      'linear.app/acme/issue/ENG-1Switch to tab',
      'Runn stackrunning',
      'Settings',
    ])
    await choose('linear.app')
    expect(fake.shownTabs).toEqual([9])
    expect(fake.focusedWindows).toEqual([2])
    await openMenu()
    await choose('Runn stack')
    expect(fake.createdTabs).toEqual(['https://runn-1.runn.localhost:5104/'])
    // The tab closed, so its link opens a new one.
    fake.closeTab(9)
    await settle(20)
    await openMenu()
    expect(menuItems()).toContain('linear.app/acme/issue/ENG-1Open')
    await choose('Copy Acorn link')
    expect(writeText).toHaveBeenCalledWith('acorn://n1/t/t1')
    await openMenu()
    await choose('Settings')
    expect(root.querySelector('header .title')?.textContent).toBe('Settings')
  })

  it("archives a conversation from its menu and goes back to the task's Agents, which no longer lists it", async () => {
    const { state, root } = mount({ url: 'https://example.com/' })
    await settle(30)
    await openTask(root, 'Fix login')
    await openChat(root, 'Chat s1')
    button(root, 'Conversation menu')!.click()
    await settle(20)
    expect(menuItems()).toEqual(['Copy Acorn link', 'Archive chat'])
    await choose('Archive chat')
    await settle(20)

    const archives = state.requests.filter((request) => request.op === 'session.archive')
    expect(archives).toEqual([expect.objectContaining({ nodeId: 'n1', sessionId: 's1', key: expect.any(String) })])
    expect(conversationTitle(root)).toBeNull()
    expect(shownTask(root)).toBe('Fix login')
    expect(root.querySelector('[aria-label="Agents"]')).not.toBeNull()
    expect(root.querySelector('[aria-label="Agents"]')!.textContent).not.toContain('Chat s1')
  })
})
