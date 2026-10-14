import { describe, expect, it } from 'vitest'
import type { BridgePendingRequest } from '@acorn/protocol/extensionBridge.ts'
import type { BackgroundMessage } from '../messages'
import { siteChoiceKey, siteChoicesKey } from '../pageScope'
import { fakeBrowser, settle, type FakeHost } from '../test/fakeBrowser'
import { SELECTED_NODE_KEY, startBackground } from './background'
import { NOTIFIED_KEY } from './requestBadge'

const waiting = (requestId: string, projectId: string, extra: Partial<BridgePendingRequest> = {}) => ({
  requestId,
  sessionId: `s-${requestId}`,
  taskId: `t-${projectId}`,
  projectId,
  kind: 'permission',
  title: `Run ${requestId}`,
  taskTitle: `Task in ${projectId}`,
  ...extra,
})

// A host for one or two Nodes, each with projects, site associations, and open requests. It reports
// the selected Node online after each selection, as the broker does once it connects.
function scriptedHost(fake: ReturnType<typeof fakeBrowser>) {
  const state = {
    active: null as string | null,
    projects: [
      { id: 'web', name: 'web', path: null, hidden: false },
      { id: 'docs', name: 'docs', path: null, hidden: false },
      { id: 'secret', name: 'secret', path: null, hidden: true },
    ],
    sites: [
      { projectId: 'web', origin: 'https://example.com', pathPrefix: '/app' },
      { projectId: 'docs', origin: 'https://example.com', pathPrefix: '/docs' },
      { projectId: 'secret', origin: 'https://example.com', pathPrefix: '/' },
    ],
    requests: { a: [] as BridgePendingRequest[], b: [] as BridgePendingRequest[] } as Record<
      string,
      BridgePendingRequest[]
    >,
    reads: 0,
    taskPages: [] as unknown[],
  }
  fake.onNativeMessage = (raw, host: FakeHost) => {
    const message = raw as { id: string; op: string; nodeId?: string | null }
    const reply = (result: unknown) => host.send({ v: 1, id: message.id, ok: true, result })
    const nodes = () => ({
      nodes: ['a', 'b'].map((nodeId) => ({ nodeId, label: nodeId, endpoint: `https://${nodeId}.test`, local: false })),
      activeNodeId: state.active,
      status: null,
    })
    if (message.op === 'nodes.list') return reply(nodes())
    if (message.op === 'node.select') {
      state.active = message.nodeId ?? null
      reply(nodes())
      if (state.active) host.send({ v: 1, event: 'status', status: { nodeId: state.active, state: 'online' } })
      return
    }
    if (message.nodeId !== state.active)
      return host.send({ v: 1, id: message.id, ok: false, error: { code: 'not_selected', message: 'no' } })
    if (message.op === 'handoffs.list') return reply({ nodeId: message.nodeId, handoffs: [] })
    if (message.op === 'projects.list') return reply({ nodeId: message.nodeId, projects: state.projects })
    if (message.op === 'sites.list') return reply({ nodeId: message.nodeId, sites: state.sites })
    if (message.op === 'tasks.pages') return reply({ nodeId: message.nodeId, tasks: state.taskPages })
    if (message.op === 'requests.pending') {
      state.reads++
      return reply({ nodeId: message.nodeId, requests: state.requests[message.nodeId!] })
    }
  }
  const hint = (extra: Record<string, unknown> = {}) =>
    fake.hosts.at(-1)!.send({
      v: 1,
      event: 'agent',
      nodeId: state.active,
      sessions: [],
      tasks: [],
      missed: false,
      requests: true,
      ...extra,
    })
  return { state, hint }
}

function sidebar(fake: ReturnType<typeof fakeBrowser>) {
  const port = fake.api.runtime.connect({ name: 'sidebar' })
  const messages: BackgroundMessage[] = []
  port.onMessage.addListener((message) => messages.push(message as BackgroundMessage))
  let next = 0
  const call = async (call: Record<string, unknown>) => {
    port.postMessage({ id: `c${++next}`, call })
    await settle()
  }
  return { messages, call, close: () => port.disconnect() }
}

// A background started with Node `a` remembered, and no sidebar open.
async function started(url = 'https://example.com/app/login') {
  const fake = fakeBrowser()
  fake.activeTab = { id: 1, windowId: 1, url }
  const host = scriptedHost(fake)
  host.state.requests.a = [waiting('r1', 'web'), waiting('r2', 'docs'), waiting('r3', 'secret')]
  fake.storage.set(SELECTED_NODE_KEY, 'a')
  startBackground(fake.api, 'com.acorn.browser_bridge')
  await settle(20)
  return { fake, host }
}

describe('request badge', () => {
  it("counts the page's own project with the sidebar closed, and no other project's", async () => {
    const { fake } = await started()
    // Started on its own: the selection was restored and the requests read, with no sidebar.
    expect(fake.hosts).toHaveLength(1)
    expect(fake.badges.get(1)).toBe('1')
  })

  it("counts the requests of the task a page belongs to, as the Node's list says", async () => {
    const { fake, host } = await started('https://tracker.example/items/42')
    host.state.requests.a = [waiting('r1', 'web'), waiting('r2', 'docs', { taskId: 't-42' })]
    host.hint()
    await settle()
    expect(fake.badges.get(1)).toBe('')
    host.state.taskPages = [
      {
        id: 't-42',
        title: 'Item 42',
        branch: null,
        projectId: 'docs',
        pages: [{ origin: 'https://tracker.example', pathPrefix: '/items/42', source: 'tracker' }],
      },
    ]
    fake.hosts[0]!.send({ v: 1, event: 'tasks', nodeId: 'a' })
    await settle()
    expect(fake.badges.get(1)).toBe('1')
  })

  it('scopes by path on one domain, follows navigation, and shows nothing on a page it may not read', async () => {
    const { fake, host } = await started()
    fake.otherTabs = [{ id: 2, windowId: 1, url: 'https://example.com/docs/intro' }]
    // Every tab is drawn after a read; each tab only after its own navigation.
    host.hint()
    await settle()
    fake.navigate('https://example.com/app/settings')
    await settle()
    expect(fake.badges.get(1)).toBe('1')
    expect(fake.badges.get(2)).toBe('1')
    // A page no project is tied to, then one the browser won't report.
    fake.navigate('https://example.com/elsewhere')
    await settle()
    expect(fake.badges.get(1)).toBe('')
    fake.navigate('https://example.com/app')
    await settle()
    expect(fake.badges.get(1)).toBe('1')
    fake.activeTab = { ...fake.activeTab, url: undefined }
    fake.revoke('https://example.com/*')
    await settle()
    expect(fake.badges.get(1)).toBe('')
  })

  it('counts a tab as soon as the toolbar button grants it, with no navigation', async () => {
    const { fake } = await started()
    fake.activeTab = { ...fake.activeTab, url: undefined }
    fake.navigate(undefined)
    await settle()
    expect(fake.badges.get(1)).toBe('')
    // The click grants `activeTab`: the browser now reports the address, and fires no tab event.
    fake.activeTab = { ...fake.activeTab, url: 'https://example.com/app/login' }
    fake.clickAction()
    await settle()
    expect(fake.badges.get(1)).toBe('1')
  })

  it("follows the person's project override for the site, and choosing no project clears it", async () => {
    const { fake } = await started()
    const key = siteChoiceKey('https://example.com', ['web'])
    // Written by the sidebar's picker; the background hears it through storage.
    await fake.api.storage.local.set({ [siteChoicesKey('a')]: { [key]: 'docs' } })
    await settle()
    expect(fake.badges.get(1)).toBe('1')
    await fake.api.storage.local.set({ [siteChoicesKey('a')]: { [key]: '' } })
    await settle()
    expect(fake.badges.get(1)).toBe('')
  })

  it('reads again when a request changes, and clears once the Node has none', async () => {
    const { fake, host } = await started()
    const reads = host.state.reads
    // An unrelated agent hint costs no read.
    host.hint({ requests: false, sessions: ['other'] })
    await settle()
    expect(host.state.reads).toBe(reads)
    host.state.requests.a = [waiting('r2', 'docs')]
    host.hint()
    await settle()
    expect(fake.badges.get(1)).toBe('')
    // A hint naming a session with a waiting request reads too, as when that session is archived.
    host.state.requests.a = []
    host.hint({ requests: false, sessions: ['s-r2'] })
    await settle()
    expect(host.state.reads).toBe(reads + 2)
  })

  it('starts a host that stopped after working once more, and leaves a second stop to the person', async () => {
    const { fake } = await started()
    fake.hosts[0]!.close('Native host has exited.')
    await settle(20)
    expect(fake.hosts).toHaveLength(2)
    expect(fake.hosts[1]!.received[0]).toMatchObject({ op: 'node.select', nodeId: 'a' })
    expect(fake.badges.get(1)).toBe('1')
    fake.hosts[1]!.close('Native host has exited.')
    await settle(20)
    expect(fake.hosts).toHaveLength(2)
    expect(fake.badges.get(1)).toBe('')
  })

  it("clears at once when the host stops or the Node goes away, and doesn't show one Node's requests on another", async () => {
    const { fake, host } = await started()
    const panel = sidebar(fake)
    await settle()
    expect(panel.messages).toContainEqual({ type: 'requests', nodeId: 'a', requests: host.state.requests.a })

    fake.hosts[0]!.send({ v: 1, event: 'status', status: { nodeId: 'a', state: 'offline' } })
    await settle()
    expect(fake.badges.get(1)).toBe('')
    fake.hosts[0]!.send({ v: 1, event: 'status', status: { nodeId: 'a', state: 'online' } })
    await settle()
    expect(fake.badges.get(1)).toBe('1')

    host.state.requests.b = [waiting('r9', 'docs')]
    await panel.call({ op: 'node.select', nodeId: 'b' })
    await settle()
    expect(fake.badges.get(1)).toBe('')
    expect(panel.messages.filter((message) => message.type === 'requests').at(-1)).toEqual({
      type: 'requests',
      nodeId: 'b',
      requests: host.state.requests.b,
    })

    const before = panel.messages.length
    fake.hosts[0]!.close('Native host has exited.')
    await settle()
    expect(panel.messages.slice(before)).toContainEqual({ type: 'requests', nodeId: 'b', requests: [] })
  })
})

describe('request notifications', () => {
  it('delivers nothing until the person allows notifications', async () => {
    const { fake } = await started()
    expect(fake.notified).toEqual([])
    expect(fake.storage.has(NOTIFIED_KEY)).toBe(false)
  })

  it("notifies once for the active page's request, in words that carry none of its content", async () => {
    const { fake } = await started()
    fake.grantPermission('notifications')
    await settle()
    expect(fake.notified).toEqual(['acorn-request:s-r1:r1'])
    expect(fake.notifications.get('acorn-request:s-r1:r1')).toEqual({
      title: 'Acorn',
      message: 'An agent is asking for permission. Open Acorn to answer.',
    })
    // Moving to a page of the other project delivers that one, once.
    fake.navigate('https://example.com/docs')
    await settle()
    fake.navigate('https://example.com/app')
    await settle()
    expect(fake.notified).toEqual(['acorn-request:s-r1:r1', 'acorn-request:s-r2:r2'])
  })

  it('remembers delivery across a restart of the background and the host, and forgets a settled request', async () => {
    const { fake, host } = await started()
    fake.grantPermission('notifications')
    await settle()
    expect(fake.storage.get(NOTIFIED_KEY)).toEqual({ nodeId: 'a', ids: ['s-r1:r1'] })

    // The same profile's storage, a new background and a new host.
    const restarted = fakeBrowser()
    restarted.activeTab = fake.activeTab
    for (const [key, value] of fake.storage) restarted.storage.set(key, value)
    restarted.granted.add('notifications')
    scriptedHost(restarted).state.requests.a = host.state.requests.a
    startBackground(restarted.api, 'com.acorn.browser_bridge')
    await settle(20)
    expect(restarted.badges.get(1)).toBe('1')
    expect(restarted.notified).toEqual([])

    host.state.requests.a = []
    host.hint()
    await settle()
    expect(fake.notifications.size).toBe(0)
    expect(fake.storage.has(NOTIFIED_KEY)).toBe(false)
  })

  it("opens the request's conversation from a click, in a sidebar open now or one that opens later", async () => {
    const { fake } = await started()
    fake.grantPermission('notifications')
    await settle()
    fake.clickNotification('acorn-request:s-r1:r1')
    await settle()
    expect(fake.panelOpens).toEqual([1])
    const target = { nodeId: 'a', projectId: 'web', taskId: 't-web', sessionId: 's-r1' }
    const panel = sidebar(fake)
    await settle()
    expect(panel.messages).toContainEqual({ type: 'open', target })
    expect(fake.notifications.size).toBe(0)
  })
})
