import { describe, expect, it } from 'vitest'
import type { BackgroundMessage } from '../messages'
import { fakeBrowser, settle, type FakeHost } from '../test/fakeBrowser'
import { SELECTED_NODE_KEY, startBackground } from './background'
import { HANDOFFS_KEY } from './siteButtons'

// A scripted host with the real host's selection rules: it knows some Nodes and selects one at a time.
function scriptedHost(fake: ReturnType<typeof fakeBrowser>, known: string[]) {
  const state = { active: null as string | null, handoffs: [] as unknown[] }
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
  const buttons = [{ key: 'tracker:item', label: 'Open in Acorn', anchors: ['.actions'] }]
  const lastButtons = (fake: ReturnType<typeof fakeBrowser>) =>
    (fake.tabMessages.at(-1)?.message as { buttons?: unknown } | undefined)?.buttons

  async function started(options: { url?: string } = {}) {
    const fake = fakeBrowser()
    fake.activeTab = { id: 7, windowId: 1, url: options.url ?? 'https://tracker.example/items/42', title: 'Item 42' }
    const host = scriptedHost(fake, ['a', 'b'])
    host.handoffs = [handoff]
    startBackground(fake.api, 'com.acorn.browser_bridge')
    const panel = sidebar(fake)
    await panel.call({ op: 'node.select', nodeId: 'a' })
    await settle()
    return { fake, host, panel }
  }

  it("draws the selected Node's buttons on a matching page it may read", async () => {
    const { fake } = await started()
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

    fake.sendFromPage({ type: 'acorn:handoff', key: 'tracker:other' })
    fake.sendFromPage({ type: 'acorn:handoff', key: 'tracker:item' })
    expect(fake.panelOpens).toEqual([3])
    const panel = sidebar(fake)
    await settle()
    const handed = {
      pluginId: 'tracker',
      handoffId: 'item',
      label: 'Open in Acorn',
      url: 'https://tracker.example/items/42',
    }
    expect(panel.messages).toContainEqual({ type: 'handoff', handoff: handed })

    // Taken once: a second sidebar doesn't get it again.
    const second = sidebar(fake)
    await settle()
    expect(second.messages.some((message) => message.type === 'handoff')).toBe(false)
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
})
