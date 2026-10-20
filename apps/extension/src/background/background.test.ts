import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BackgroundMessage } from '../messages'
import { fakeBrowser, settle, type FakeHost } from '../test/fakeBrowser'
import { SELECTED_NODE_KEY, startBackground } from './background'
import { HIDDEN_MARKERS_KEY } from '../handoffs'
import { HANDOFFS_KEY } from './siteButtons'

// A scripted host with the real host's selection rules: it knows some Nodes and selects one at a time.
function scriptedHost(fake: ReturnType<typeof fakeBrowser>, known: string[]) {
  const state = {
    active: null as string | null,
    handoffs: [] as unknown[],
    taskPages: [] as unknown[],
    sessions: [] as { id: string; runtimeState: string; title?: string; archivedAt?: number | null }[],
    choices: [] as unknown[],
  }
  fake.onNativeMessage = (raw, host: FakeHost) => {
    const message = raw as { id: string; op: string; nodeId?: string | null }
    const reply = (result: unknown) => host.send({ v: 1, id: message.id, ok: true, result })
    const fail = (code: string) => host.send({ v: 1, id: message.id, ok: false, error: { code, message: code } })
    const nodes = () => ({
      nodes: known.map((nodeId) => ({ nodeId, label: nodeId, endpoint: `https://${nodeId}.test`, local: false })),
      activeNodeId: state.active,
      status: null,
    })
    if (message.op === 'nodes.list') return reply(nodes())
    if (message.op === 'node.select') {
      if (message.nodeId && !known.includes(message.nodeId)) return fail('unknown_node')
      state.active = message.nodeId ?? null
      return reply(nodes())
    }
    if (message.op === 'node.forget') {
      known.splice(known.indexOf(message.nodeId!), 1)
      if (state.active === message.nodeId) state.active = null
      return reply(nodes())
    }
    if (message.op === 'handoffs.list')
      return message.nodeId === state.active
        ? reply({ nodeId: message.nodeId, handoffs: state.handoffs })
        : fail('not_selected')
    if (message.op === 'projects.list')
      return message.nodeId === state.active ? reply({ nodeId: message.nodeId, projects: [] }) : fail('not_selected')
    if (message.op === 'tasks.pages') return reply({ nodeId: message.nodeId, tasks: state.taskPages })
    if (message.op === 'agents.choices') return reply({ nodeId: message.nodeId, choices: state.choices })
    if (message.op === 'session.create')
      return reply({ nodeId: message.nodeId, session: { id: `new-${host.received.length}` } })
    if (message.op === 'attachment.upload')
      return reply({
        nodeId: message.nodeId,
        taskId: (message as { taskId?: string }).taskId,
        attachment: { id: `att-${host.received.length}` },
      })
    if (message.op === 'turn.submit')
      return reply({
        nodeId: message.nodeId,
        sessionId: (message as { sessionId?: string }).sessionId,
        turnId: 'turn1',
      })
    if (message.op === 'sessions.list')
      return reply({
        nodeId: message.nodeId,
        taskId: (message as { taskId?: string }).taskId,
        sessions: state.sessions,
      })
  }
  return state
}

function sidebar(fake: ReturnType<typeof fakeBrowser>) {
  const port = fake.api.runtime.connect({ name: 'sidebar' })
  const messages: BackgroundMessage[] = []
  port.onMessage.addListener((message) => messages.push(message as BackgroundMessage))
  let next = 0
  const call = async (call: Record<string, unknown>) => {
    const id = `c${++next}`
    port.postMessage({ id, call })
    await settle()
    return messages.find((message) => message.type === 'reply' && message.id === id)
  }
  return { messages, call }
}

describe('background', () => {
  it('remembers a selection and restores it when the host starts again', async () => {
    const fake = fakeBrowser()
    const host = scriptedHost(fake, ['a', 'b'])
    startBackground(fake.api, 'com.acorn.browser_bridge')
    const first = sidebar(fake)
    expect(await first.call({ op: 'node.select', nodeId: 'b' })).toMatchObject({ ok: true })
    expect(fake.storage.get(SELECTED_NODE_KEY)).toBe('b')

    fake.hosts[0]!.close('Native host has exited.')
    await settle()
    // Started again on its own once. A second stop waits for the next call.
    expect(fake.hosts[1]!.received[0]).toMatchObject({ op: 'node.select', nodeId: 'b' })
    fake.hosts[1]!.close('Native host has exited.')
    await settle()
    host.active = null
    // The first call after a restart reselects before it runs, so a project read finds its Node.
    expect(await first.call({ op: 'projects.list', nodeId: 'b' })).toMatchObject({ ok: true })
    expect(fake.hosts).toHaveLength(3)
    expect(fake.hosts[2]!.received[0]).toMatchObject({ op: 'node.select', nodeId: 'b' })
  })

  it('restores on a fresh port when the first one closes during the restore', async () => {
    const fake = fakeBrowser()
    const host = scriptedHost(fake, ['a'])
    const scripted = fake.onNativeMessage
    fake.storage.set(SELECTED_NODE_KEY, 'a')
    // The first host closes without answering; the second answers normally.
    fake.onNativeMessage = (message, nativeHost) =>
      fake.hosts.length === 1 ? nativeHost.close('Native host has exited.') : scripted(message, nativeHost)
    startBackground(fake.api, 'com.acorn.browser_bridge')
    const panel = sidebar(fake)
    expect(await panel.call({ op: 'nodes.list' })).toMatchObject({ ok: true, result: { activeNodeId: 'a' } })
    expect(host.active).toBe('a')
  })

  it('reports a stale remembered Node without blocking pairing work', async () => {
    const fake = fakeBrowser()
    scriptedHost(fake, ['a'])
    fake.storage.set(SELECTED_NODE_KEY, 'gone')
    startBackground(fake.api, 'com.acorn.browser_bridge')
    const panel = sidebar(fake)
    expect(await panel.call({ op: 'nodes.list' })).toMatchObject({ ok: true, result: { activeNodeId: null } })
    expect(fake.storage.has(SELECTED_NODE_KEY)).toBe(false)
    expect(panel.messages.filter((message) => message.type === 'host').at(-1)).toMatchObject({
      host: { restoreError: 'Could not reselect the last Node: unknown_node' },
    })
    expect(await panel.call({ op: 'node.forget', nodeId: 'a' })).toMatchObject({ ok: true })
  })

  it('keeps nothing but the selected Node ID and its handoffs in browser storage', async () => {
    const fake = fakeBrowser()
    scriptedHost(fake, ['a'])
    startBackground(fake.api, 'com.acorn.browser_bridge')
    const panel = sidebar(fake)
    await panel.call({ op: 'node.select', nodeId: 'a' })
    expect([...fake.storage.entries()]).toEqual([
      [SELECTED_NODE_KEY, 'a'],
      [HANDOFFS_KEY, { nodeId: 'a', handoffs: [] }],
    ])
    await panel.call({ op: 'node.forget', nodeId: 'a' })
    expect(fake.storage.size).toBe(0)
  })

  it('tells each sidebar when the host is missing', async () => {
    const fake = fakeBrowser()
    fake.onNativeConnect = (host) => host.close('Specified native messaging host not found.')
    startBackground(fake.api, 'com.acorn.browser_bridge')
    const panel = sidebar(fake)
    expect(await panel.call({ op: 'nodes.list' })).toMatchObject({ ok: false, error: { code: 'host_unavailable' } })
    expect(panel.messages.filter((message) => message.type === 'host').at(-1)).toMatchObject({
      host: { state: 'missing' },
    })
  })

  it("answers a port named for the sidebar only from the sidebar's own page", async () => {
    const fake = fakeBrowser()
    scriptedHost(fake, ['a'])
    startBackground(fake.api, 'com.acorn.browser_bridge')
    const page = fake.connectFromPage('sidebar')
    const heard: unknown[] = []
    page.onMessage.addListener((message) => heard.push(message))
    page.postMessage({ id: 'c1', call: { op: 'nodes.list' } })
    await settle()
    expect(heard).toEqual([])
    expect(await sidebar(fake).call({ op: 'nodes.list' })).toMatchObject({ ok: true })
  })

  it('opens the sidebar from the toolbar in each browser, handling the click itself', async () => {
    const chrome = fakeBrowser({ flavor: 'chrome' })
    startBackground(chrome.api, 'com.acorn.browser_bridge')
    await settle()
    // Chrome's own open-on-click grants no page access, so the extension opens the panel itself.
    expect(chrome.panelBehavior).toEqual({ openPanelOnActionClick: false })
    chrome.clickAction()
    chrome.clickAction()
    await settle()
    expect(chrome.panelOpens).toEqual([1, 1])
    const firefox = fakeBrowser({ flavor: 'firefox' })
    startBackground(firefox.api, 'com.acorn.browser_bridge')
    firefox.clickAction()
    await settle()
    expect(firefox.panelOpens).toEqual([null])
  })
})

describe('site buttons', () => {
  const handoff = {
    pluginId: 'tracker',
    id: 'item',
    label: 'Open in Acorn',
    match: ['https://tracker.example/items/{id}'],
    anchors: ['.actions'],
  }
  const buttons = [{ key: 'tracker:item', label: 'Open in Acorn', anchors: ['.actions'], task: null }]
  const lastButtons = (fake: ReturnType<typeof fakeBrowser>) =>
    (fake.tabMessages.at(-1)?.message as { buttons?: unknown } | undefined)?.buttons

  async function started(options: { url?: string; flavor?: 'chrome' | 'firefox'; hostName?: string } = {}) {
    const fake = fakeBrowser({ flavor: options.flavor })
    fake.activeTab = { id: 7, windowId: 1, url: options.url ?? 'https://tracker.example/items/42', title: 'Item 42' }
    const host = scriptedHost(fake, ['a', 'b'])
    host.handoffs = [handoff]
    host.taskPages = [pageTask]
    startBackground(fake.api, options.hostName ?? 'com.acorn.browser_bridge')
    const panel = sidebar(fake)
    await panel.call({ op: 'node.select', nodeId: 'a' })
    // The status that lets the background read.
    fake.hosts[0]!.send({ v: 1, event: 'status', status: { nodeId: 'a', state: 'online' } })
    await settle()
    return { fake, host, panel }
  }
  // The task item 42 belongs to.
  const pageTask = {
    id: 't1',
    title: 'Fix billing rounding',
    branch: 'fix/billing',
    projectId: 'p1',
    pages: [{ origin: 'https://tracker.example', pathPrefix: '/items/42', source: 'tracker' }],
  }
  const lastMessage = (fake: ReturnType<typeof fakeBrowser>) =>
    fake.tabMessages.at(-1)?.message as { opensLinks: boolean; opensPanel: boolean }

  it("draws the selected Node's buttons on a matching page it may read", async () => {
    const { fake } = await started({ url: 'https://tracker.example/items/43' })
    expect(fake.injected).toContain(7)
    expect(lastButtons(fake)).toEqual(buttons)
    expect(fake.storage.get(HANDOFFS_KEY)).toEqual({ nodeId: 'a', handoffs: [handoff] })
  })

  it('takes the buttons away after navigation, lost access, or a Node switch', async () => {
    const { fake, host, panel } = await started()
    fake.navigate('https://tracker.example/boards/1')
    await settle()
    expect(lastButtons(fake)).toEqual([])

    fake.navigate('https://tracker.example/items/43')
    await settle()
    expect(lastButtons(fake)).toEqual(buttons)
    // Access removed: the browser stops reporting the address, and the page is told to draw nothing.
    fake.activeTab = { ...fake.activeTab, url: undefined }
    fake.revoke('https://tracker.example/*')
    await settle()
    expect(lastButtons(fake)).toEqual([])

    fake.activeTab = { ...fake.activeTab, url: 'https://tracker.example/items/43' }
    fake.navigate('https://tracker.example/items/43')
    await settle()
    expect(lastButtons(fake)).toEqual(buttons)
    host.handoffs = []
    await panel.call({ op: 'node.select', nodeId: 'b' })
    await settle()
    expect(lastButtons(fake)).toEqual([])
    expect(fake.storage.get(HANDOFFS_KEY)).toEqual({ nodeId: 'b', handoffs: [] })
  })

  it("reads the list again when the Node's plugins change", async () => {
    const { fake, host } = await started({ url: 'https://tracker.example/boards/1' })
    host.handoffs = [{ ...handoff, match: ['https://tracker.example/boards/{id}'] }]
    fake.hosts[0]!.send({ v: 1, event: 'handoffs', nodeId: 'a' })
    await settle()
    expect(lastButtons(fake)).toEqual(buttons)
  })

  it('opens the panel for a click and hands the page to the sidebar, even one that connects later', async () => {
    const fake = fakeBrowser()
    fake.activeTab = { id: 7, windowId: 3, url: 'https://tracker.example/items/42', title: 'Item 42' }
    scriptedHost(fake, ['a']).handoffs = [handoff]
    fake.storage.set(HANDOFFS_KEY, { nodeId: 'a', handoffs: [handoff] })
    startBackground(fake.api, 'com.acorn.browser_bridge')
    await settle()
    // Drawn from the stored list before the host has started.
    expect(fake.hosts).toEqual([])
    expect(lastButtons(fake)).toEqual(buttons)

    fake.sendFromPage({ type: 'acorn:handoff', key: 'tracker:other', start: 'task' })
    fake.sendFromPage({ type: 'acorn:handoff', key: 'tracker:item', start: 'workflow' })
    expect(fake.panelOpens).toEqual([3])
    const panel = sidebar(fake)
    await settle()
    const handed = {
      pluginId: 'tracker',
      handoffId: 'item',
      label: 'Open in Acorn',
      url: 'https://tracker.example/items/42',
      start: 'workflow',
    }
    expect(panel.messages).toContainEqual({ type: 'handoff', handoff: handed })

    // Taken once: a second sidebar doesn't get it again.
    const second = sidebar(fake)
    await settle()
    expect(second.messages.some((message) => message.type === 'handoff')).toBe(false)
  })

  it("hands off the tab's address, not the one Firefox kept from before the page moved in place", async () => {
    const { fake, panel } = await started({ url: 'https://tracker.example/items/43' })
    await fake.sendFromPage(
      { type: 'acorn:handoff', key: 'tracker:item', start: 'task' },
      0,
      'https://tracker.example/items/42',
    )
    await settle()
    expect(panel.messages).toContainEqual({
      type: 'handoff',
      handoff: {
        pluginId: 'tracker',
        handoffId: 'item',
        label: 'Open in Acorn',
        url: 'https://tracker.example/items/43',
        start: 'task',
      },
    })
  })

  it('gives the tab the toolbar button was clicked on its buttons', async () => {
    const { fake } = await started({ url: 'https://tracker.example/boards/1' })
    fake.injected.length = 0
    fake.activeTab = { ...fake.activeTab, url: 'https://tracker.example/items/9' }
    fake.clickAction()
    await settle()
    expect(fake.injected).toEqual([7])
    expect(lastButtons(fake)).toEqual(buttons)
  })

  it("draws the task chip on a page that belongs to a task, with its agents' state and link", async () => {
    const { fake, host, panel } = await started()
    expect(panel.messages).toContainEqual({ type: 'taskPages', nodeId: 'a', tasks: [pageTask] })
    expect(lastButtons(fake)).toEqual([
      { ...buttons[0], task: { title: 'Fix billing rounding', state: null, link: 'acorn://a/t/t1' } },
    ])
    expect(lastMessage(fake)).toMatchObject({ opensLinks: true, opensPanel: true })

    // A hint naming the task reads its conversations again.
    host.sessions = [
      { id: 's1', runtimeState: 'working' },
      { id: 's2', runtimeState: 'working' },
    ]
    fake.hosts[0]!.send({
      v: 1,
      event: 'agent',
      nodeId: 'a',
      sessions: [],
      tasks: ['t1'],
      missed: false,
      requests: false,
    })
    await settle()
    expect((lastButtons(fake) as { task: { state: unknown } }[])[0]!.task.state).toEqual({
      label: '2 working',
      tone: 'ok',
    })

    // The task lost its address: the list is read again on the bridge's tasks event, never on a timer.
    host.taskPages = []
    fake.hosts[0]!.send({ v: 1, event: 'tasks', nodeId: 'a' })
    await settle()
    expect(lastButtons(fake)).toEqual(buttons)
  })

  it('opens the panel on the task for a chip click, with a new chat about the page when asked', async () => {
    const { fake, panel } = await started()
    fake.sendFromPage({ type: 'acorn:chip', key: 'tracker:item', action: 'show' })
    fake.sendFromPage({ type: 'acorn:chip', key: 'tracker:item', action: 'chat' })
    await settle()
    expect(fake.panelOpens).toEqual([1, 1])
    expect(panel.messages.filter((message) => message.type === 'showTask')).toEqual([
      { type: 'showTask', chat: null },
      { type: 'showTask', chat: { url: 'https://tracker.example/items/42', title: 'Item 42' } },
    ])
  })

  it('draws the branch marker on an app a plugin published for a task, and hides it on that origin', async () => {
    const app = 'https://runn-05ea41.runn.localhost:5104'
    const { fake, host, panel } = await started({ url: `${app}/planner` })
    expect(lastButtons(fake)).toBeUndefined()
    host.taskPages = [
      pageTask,
      {
        ...pageTask,
        id: 't2',
        pages: [
          {
            origin: app,
            pathPrefix: '/',
            source: 'runn',
            status: { label: 'Runn stack', state: 'running', tone: 'ok' },
          },
        ],
      },
    ]
    fake.hosts[0]!.send({ v: 1, event: 'tasks', nodeId: 'a' })
    await settle()
    const marker = { branch: 'fix/billing', state: { label: 'running', tone: 'ok' }, link: 'acorn://a/t/t2?pane=runn' }
    expect(fake.injected).toContain(7)
    expect(lastMessage(fake)).toMatchObject({ buttons: [], marker })

    fake.sendFromPage({ type: 'acorn:marker', action: 'show' })
    await settle()
    expect(fake.panelOpens).toEqual([1])
    expect(panel.messages).toContainEqual({ type: 'showTask', chat: null })

    fake.sendFromPage({ type: 'acorn:marker', action: 'hide' })
    await settle()
    expect(fake.storage.get(HIDDEN_MARKERS_KEY)).toEqual([app])
    expect(lastMessage(fake)).toMatchObject({ buttons: [], marker: null })
    // Hidden, it opens nothing. The sidebar shows it again through the same key.
    fake.sendFromPage({ type: 'acorn:marker', action: 'show' })
    await fake.api.storage.local.set({ [HIDDEN_MARKERS_KEY]: [] })
    await settle()
    expect(fake.panelOpens).toEqual([1])
    expect(lastMessage(fake)).toMatchObject({ marker })
  })

  it('tells the page when Acorn links are copied rather than opened, and when it cannot open the panel', async () => {
    const development = await started({ hostName: 'com.acorn.browser_bridge_dev' })
    expect(lastMessage(development.fake)).toMatchObject({ opensLinks: false, opensPanel: true })
    const firefox = await started({ flavor: 'firefox' })
    expect(lastMessage(firefox.fake)).toMatchObject({ opensLinks: true, opensPanel: false })
  })

  describe('ask about an element', () => {
    const ASK = 'ask-acorn-about-element'
    const picks = (fake: ReturnType<typeof fakeBrowser>) =>
      fake.tabMessages
        .map(({ message }) => message)
        .filter((message) => (message as { type: string }).type === 'acorn:pick')

    it('adds the right-click entry at install, for an element of any kind', () => {
      const fake = fakeBrowser()
      startBackground(fake.api, 'com.acorn.browser_bridge')
      fake.install()
      expect(fake.menus.get(ASK)).toEqual({
        title: 'Ask Acorn about this element',
        contexts: ['page', 'link', 'image', 'video', 'audio'],
      })
    })

    it('picks the right-clicked element on a task page that already has the picker', async () => {
      const { fake } = await started()
      expect(fake.injectedFiles.at(-1)).toEqual(['content.js', 'picker.js'])
      // The picker answers its own message.
      fake.pageAnswer = (message) => (message as { type: string }).type === 'acorn:pick'
      const injections = fake.injectedFiles.length
      fake.clickMenu(ASK)
      await settle()
      expect(picks(fake)).toEqual([{ type: 'acorn:pick', mode: 'target' }])
      expect(fake.injectedFiles).toHaveLength(injections)
      expect(fake.panelOpens).toEqual([])
    })

    it("injects the picker on a page that has only the chip's script, which answers nothing", async () => {
      const { fake } = await started()
      const injections = fake.injectedFiles.length
      fake.clickMenu(ASK)
      await settle()
      expect(fake.injectedFiles.slice(injections)).toEqual([['picker.js']])
      expect(picks(fake)).toEqual([
        { type: 'acorn:pick', mode: 'target' },
        { type: 'acorn:pick', mode: 'hover' },
      ])
    })

    it('injects the picker on a task page without it, and lets the person point at the element', async () => {
      const app = 'https://app.example'
      const { fake, host } = await started({ url: `${app}/planner` })
      host.taskPages = [{ ...pageTask, pages: [{ origin: app, pathPrefix: '/', source: 'runn' }] }]
      fake.hosts[0]!.send({ v: 1, event: 'tasks', nodeId: 'a' })
      await settle()
      expect(fake.injectedFiles).toEqual([])
      fake.clickMenu(ASK)
      await settle()
      expect(fake.injectedFiles).toEqual([['picker.js']])
      expect(picks(fake)).toEqual([{ type: 'acorn:pick', mode: 'hover' }])
    })

    it('refuses in one line, with the panel open, off a task page, in a frame, or with no Node', async () => {
      const notices = (panel: ReturnType<typeof sidebar>) =>
        panel.messages.filter((message) => message.type === 'notice').map((message) => message.notice)

      const { fake, panel } = await started({ url: 'https://tracker.example/items/43' })
      fake.clickMenu(ASK)
      fake.activeTab = { ...fake.activeTab, url: 'https://tracker.example/items/42' }
      fake.clickMenu(ASK, 3)
      await settle()
      expect(fake.panelOpens).toEqual([1, 1])
      expect(notices(panel)).toEqual([
        "This page doesn't belong to a task, so there is no agent to ask about it. Open a task's pull request, issue, or app, then try again.",
        "That element is inside a frame, which Acorn can't pick from. Right-click outside the frame, then try again.",
      ])

      const unselected = fakeBrowser()
      scriptedHost(unselected, ['a'])
      startBackground(unselected.api, 'com.acorn.browser_bridge')
      await settle()
      unselected.clickMenu(ASK)
      // A panel the click opened connects a moment later, and gets the notice then.
      const opened = sidebar(unselected)
      await settle()
      expect(unselected.panelOpens).toEqual([1])
      expect(notices(opened)).toEqual([
        'No Node is selected, so there is no agent to ask. Choose or pair a Node, then try again.',
      ])
      expect(picks(fake)).toEqual([])
      expect(picks(unselected)).toEqual([])
    })

    describe('the box', () => {
      // A harness, a named login on it, one that can't start, and a custom agent on the first harness.
      const row = (providerId: string, label: string, extra: Record<string, unknown> = {}) => ({
        providerId,
        profileId: 'default',
        customAgentId: null,
        account: null,
        label,
        text: label,
        description: '',
        glyph: null,
        accountIcon: null,
        available: true,
        ...extra,
      })
      const choices = [
        row('claude', 'Claude'),
        row('claude', 'Claude · work', { account: 'work' }),
        row('codex', 'Codex', { available: false }),
        row('claude', 'Reviewer', { customAgentId: 'reviewer' }),
      ]
      const question = {
        type: 'acorn:ask.send',
        question: '  Why is this button here?  ',
        html: '<button class="save">Save</button>',
        selector: '#app > button:nth-of-type(2)',
        size: { width: 80, height: 32 },
        sessionId: null,
        agent: 'claude::',
      }
      const uploads = (fake: ReturnType<typeof fakeBrowser>) =>
        fake.hosts[0]!.received.filter((message) => (message as { op: string }).op === 'attachment.upload')
      const writes = (fake: ReturnType<typeof fakeBrowser>) =>
        fake.hosts[0]!.received.filter((message) =>
          ['session.create', 'turn.submit'].includes((message as { op: string }).op),
        ) as {
          op: string
          key: string
          sessionId?: string
          input?: unknown
          providerId?: string
          profileId?: string
          account?: string
          customAgentId?: string
        }[]

      // The canvas a background has and Node lacks. Every screenshot is 1600 × 1000 device pixels, and
      // each crop is kept as the area drawn from it.
      const crops: number[][] = []
      beforeEach(() => {
        crops.length = 0
        vi.stubGlobal('createImageBitmap', async () => ({ width: 1600, height: 1000, close() {} }))
        vi.stubGlobal(
          'OffscreenCanvas',
          class {
            getContext() {
              return { drawImage: (_image: unknown, ...area: number[]) => void crops.push(area.slice(0, 4)) }
            }
            async convertToBlob() {
              return new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' })
            }
          },
        )
      })
      afterEach(() => vi.unstubAllGlobals())
      const element = { rect: { x: 100, y: 50, width: 80, height: 32 }, devicePixelRatio: 2 }

      // A task page with the picker open on it, and the conversations the task's chip follows.
      async function opened(
        options: { flavor?: 'chrome' | 'firefox'; at?: typeof element; capture?: () => Promise<string> } = {},
      ) {
        const { fake, host, panel } = await started(options)
        if (options.capture) fake.onCapture = options.capture
        host.choices = choices
        host.sessions = [
          { id: 's1', title: 'Billing rounding', runtimeState: 'idle', archivedAt: null },
          { id: 's2', title: 'Old chat', runtimeState: 'idle', archivedAt: 5 },
        ]
        fake.hosts[0]!.send({
          v: 1,
          event: 'agent',
          nodeId: 'a',
          sessions: [],
          tasks: ['t1'],
          missed: false,
          requests: false,
        })
        await settle()
        const answer = (await fake.sendFromPage({ type: 'acorn:ask.open', ...(options.at ?? element) })) as {
          ok: true
          pickId: string
          screenshot: boolean
        }
        return { fake, host, panel, answer, pickId: answer.pickId }
      }

      it("answers with the task's open conversations and usable agents, the remembered one first", async () => {
        const { answer } = await opened()
        expect(answer).toEqual({
          ok: true,
          pickId: expect.any(String),
          task: 'Fix billing rounding',
          sessions: [{ id: 's1', title: 'Billing rounding' }],
          agents: [
            { key: 'claude::', label: 'Claude' },
            { key: 'claude:work:', label: 'Claude · work' },
            { key: 'claude::reviewer', label: 'Reviewer' },
          ],
          agent: 'claude::',
          screenshot: true,
        })

        // The page's own chip follows no task here, so the conversations are read for the box.
        const app = 'https://app.example'
        const { fake, host } = await started({ url: `${app}/planner` })
        host.taskPages = [{ ...pageTask, pages: [{ origin: app, pathPrefix: '/', source: 'runn' }] }]
        host.choices = choices
        host.sessions = [{ id: 's9', title: 'Planner', runtimeState: 'idle', archivedAt: null }]
        fake.storage.set('askAgent:a', 'claude::reviewer')
        fake.hosts[0]!.send({ v: 1, event: 'tasks', nodeId: 'a' })
        await settle()
        expect(await fake.sendFromPage({ type: 'acorn:ask.open' })).toMatchObject({
          ok: true,
          sessions: [{ id: 's9', title: 'Planner' }],
          agent: 'claude::reviewer',
        })
      })

      it('sends a new chat about the element, with its screenshot, then opens the panel on it', async () => {
        const { fake, panel, pickId } = await opened()
        // The element's box with 8 CSS pixels around it, in device pixels.
        expect(crops).toEqual([[184, 84, 192, 96]])
        expect(await fake.sendFromPage({ ...question, pickId })).toEqual({ ok: true, opensPanel: true })
        expect(fake.panelOpens).toEqual([1])
        expect(uploads(fake)).toEqual([
          expect.objectContaining({
            nodeId: 'a',
            taskId: 't1',
            filename: 'Screenshot of tracker.example.jpg',
            mediaType: 'image/jpeg',
            data: '/9j/',
          }),
        ])
        const [create, submit] = writes(fake)
        expect(create).toMatchObject({
          op: 'session.create',
          nodeId: 'a',
          taskId: 't1',
          providerId: 'claude',
          profileId: 'default',
        })
        expect(create).not.toHaveProperty('account')
        expect(create).not.toHaveProperty('customAgentId')
        expect(submit).toMatchObject({
          op: 'turn.submit',
          sessionId: expect.stringMatching(/^new-/),
          input: [
            { type: 'text', text: 'Why is this button here?' },
            {
              type: 'context',
              label: 'Element on Item 42',
              content:
                'Page: https://tracker.example/items/42\nCSS path: #app > button:nth-of-type(2)\nSize: 80 × 32 CSS pixels\n\n<button class="save">Save</button>',
              source: 'browser-extension',
              resourceId: 'https://tracker.example/items/42',
            },
            { type: 'image', attachmentId: expect.stringMatching(/^att-/), alt: 'Screenshot of Item 42' },
          ],
        })
        const target = { nodeId: 'a', projectId: 'p1', taskId: 't1', sessionId: submit!.sessionId }
        expect(panel.messages).toContainEqual({ type: 'open', target })
        expect(fake.storage.get('askAgent:a')).toBe('claude::')
        expect(fake.storage.get('destination:a')).toEqual({
          projectId: 'p1',
          taskId: 't1',
          sessionId: submit!.sessionId,
        })

        // The pick is spent.
        expect(await fake.sendFromPage({ ...question, pickId })).toEqual({
          ok: false,
          reason: 'This box is out of date, so nothing was sent. Pick the element again.',
        })
      })

      it('starts the row the person chose: a named login, or a custom agent', async () => {
        const login = await opened()
        await login.fake.sendFromPage({ ...question, pickId: login.pickId, agent: 'claude:work:' })
        const [fromLogin] = writes(login.fake)
        expect(fromLogin).toMatchObject({ op: 'session.create', providerId: 'claude', account: 'work' })
        expect(fromLogin).not.toHaveProperty('customAgentId')
        expect(login.fake.storage.get('askAgent:a')).toBe('claude:work:')

        const custom = await opened()
        await custom.fake.sendFromPage({ ...question, pickId: custom.pickId, agent: 'claude::reviewer' })
        const [fromCustom] = writes(custom.fake)
        expect(fromCustom).toMatchObject({ op: 'session.create', providerId: 'claude', customAgentId: 'reviewer' })
        expect(fromCustom).not.toHaveProperty('account')
      })

      it('adds the turn to a chosen conversation, without a new chat', async () => {
        const { fake, pickId } = await opened()
        expect(await fake.sendFromPage({ ...question, pickId, sessionId: 's1', agent: null })).toEqual({
          ok: true,
          opensPanel: true,
        })
        expect(writes(fake)).toEqual([expect.objectContaining({ op: 'turn.submit', sessionId: 's1' })])
        expect(fake.storage.has('askAgent:a')).toBe(false)
      })

      it('keeps the crop inside the screenshot, and goes without one when none of the element is in it', async () => {
        await opened({ at: { rect: { x: -20, y: 480, width: 900, height: 60 }, devicePixelRatio: 2 } })
        expect(crops).toEqual([[0, 944, 1600, 56]])
        const outside = await opened({ at: { rect: { x: 900, y: 10, width: 50, height: 20 }, devicePixelRatio: 2 } })
        expect(outside.answer.screenshot).toBe(false)
        const unsized = await opened({ at: { rect: { x: 1, y: 1, width: 1, height: 1 }, devicePixelRatio: 0 } })
        expect(unsized.answer.screenshot).toBe(false)
        expect(crops).toHaveLength(1)
      })

      it('sends without a screenshot when the browser refuses one, as on a granted site without activeTab', async () => {
        const { fake, pickId, answer } = await opened({
          flavor: 'firefox',
          capture: () => Promise.reject(new Error('Missing activeTab permission')),
        })
        expect(answer.screenshot).toBe(false)
        expect(await fake.sendFromPage({ ...question, pickId })).toEqual({ ok: true, opensPanel: false })
        expect(uploads(fake)).toEqual([])
        expect(writes(fake).at(-1)!.input).toEqual([
          expect.objectContaining({ type: 'text' }),
          expect.objectContaining({ type: 'context' }),
        ])
      })

      it('retries an unconfirmed send with the same attachment and keys, so the Node makes one chat and one turn', async () => {
        const { fake, pickId } = await opened()
        const scripted = fake.onNativeMessage
        const failing = new Set(['attachment.upload', 'session.create', 'turn.submit'])
        // Each write fails once in a way that leaves its outcome unknown.
        fake.onNativeMessage = (raw, host) => {
          const message = raw as { id: string; op: string }
          if (!failing.delete(message.op)) return scripted(raw, host)
          host.send({ v: 1, id: message.id, ok: false, error: { code: 'ambiguous_mutation', message: 'lost' } })
        }
        expect(await fake.sendFromPage({ ...question, pickId })).toEqual({
          ok: false,
          reason: "The Node didn't confirm the screenshot. Send again to retry; the Node keeps one copy.",
        })
        expect(await fake.sendFromPage({ ...question, pickId })).toEqual({
          ok: false,
          reason: "The Node didn't confirm the new chat. Send again to retry; the Node won't make a second one.",
        })
        expect(await fake.sendFromPage({ ...question, pickId })).toEqual({
          ok: false,
          reason:
            "The Node didn't confirm this message, so it may have arrived. Send again to retry; the Node makes at most one turn.",
        })
        expect(await fake.sendFromPage({ ...question, pickId })).toEqual({ ok: true, opensPanel: true })
        const [create, createAgain, submit, submitAgain] = writes(fake)
        expect(createAgain!.key).toBe(create!.key)
        expect(submitAgain!.key).toBe(submit!.key)
        expect(submitAgain!.sessionId).toBe(submit!.sessionId)
        expect(writes(fake)).toHaveLength(4)
        // Uploaded again only after the upload the Node didn't confirm, and then reused.
        expect(uploads(fake)).toHaveLength(2)
        expect(submitAgain!.input).toEqual(submit!.input)

        // Another question is another turn.
        const second = await opened()
        second.fake.onNativeMessage = (raw, host) => {
          const message = raw as { id: string; op: string }
          if (message.op !== 'turn.submit' || writes(second.fake).length > 2) return scripted(raw, host)
          host.send({ v: 1, id: message.id, ok: false, error: { code: 'ambiguous_mutation', message: 'lost' } })
        }
        await second.fake.sendFromPage({ ...question, pickId: second.pickId })
        await second.fake.sendFromPage({ ...question, pickId: second.pickId, question: 'And this one?' })
        const [, first, changed] = writes(second.fake)
        expect(changed!.key).not.toBe(first!.key)
      })

      it('refuses in one line, and sends nothing, when a check fails', async () => {
        const { fake, pickId } = await opened()
        const refused = async (message: Record<string, unknown>) =>
          ((await fake.sendFromPage({ ...question, pickId, ...message })) as { reason?: string }).reason
        expect(await refused({ pickId: 'other' })).toBe(
          'This box is out of date, so nothing was sent. Pick the element again.',
        )
        expect(await refused({ question: '   ' })).toBe('Write a question of up to 20,000 characters.')
        expect(await refused({ question: 'x'.repeat(20_001) })).toBe('Write a question of up to 20,000 characters.')
        expect(await refused({ html: 'é'.repeat(30 * 1024) })).toBe("The element's HTML is too large to send.")
        expect(await refused({ sessionId: 's2', agent: null })).toBe(
          "That conversation isn't one of this task's, so nothing was sent. Choose another.",
        )
        expect(await refused({ agent: 'codex::' })).toBe(
          "That agent can't start a chat on this Node, so nothing was sent. Choose another.",
        )
        // Only the picker in the top frame is answered.
        expect(await fake.sendFromPage({ ...question, pickId }, 2)).toBeUndefined()
        fake.activeTab = { ...fake.activeTab, url: 'https://tracker.example/items/43' }
        expect(await refused({})).toBe(
          'This page no longer belongs to the task the box was opened for, so nothing was sent. Pick the element again.',
        )
        expect(await fake.sendFromPage({ type: 'acorn:ask.open' })).toEqual({
          ok: false,
          reason:
            "This page doesn't belong to a task, so there is no agent to ask about it. Open a task's pull request, issue, or app, then try again.",
        })
        expect(writes(fake)).toEqual([])
      })

      it('forgets a cancelled pick', async () => {
        const { fake, pickId } = await opened()
        await fake.sendFromPage({ type: 'acorn:ask.cancel', pickId })
        expect(await fake.sendFromPage({ ...question, pickId })).toMatchObject({ ok: false })
        expect(writes(fake)).toEqual([])
      })

      it('tells Firefox to say where the reply is', async () => {
        const { fake, pickId } = await opened({ flavor: 'firefox' })
        expect(await fake.sendFromPage({ ...question, pickId })).toEqual({ ok: true, opensPanel: false })
      })
    })
  })
})
