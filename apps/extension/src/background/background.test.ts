import { describe, expect, it } from 'vitest'
import type { BackgroundMessage } from '../messages'
import { fakeBrowser, settle, type FakeHost } from '../test/fakeBrowser'
import { SELECTED_NODE_KEY, startBackground } from './background'

// A scripted host with the real host's selection rules: it knows some Nodes and selects one at a time.
function scriptedHost(fake: ReturnType<typeof fakeBrowser>, known: string[]) {
  const state = { active: null as string | null }
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
    host.active = null
    // The first call after a restart reselects before it runs, so a project read finds its Node.
    expect(await first.call({ op: 'projects.list', nodeId: 'b' })).toMatchObject({ ok: true })
    expect(fake.hosts).toHaveLength(2)
    expect(fake.hosts[1]!.received[0]).toMatchObject({ op: 'node.select', nodeId: 'b' })
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

  it('keeps nothing but the selected Node ID in browser storage', async () => {
    const fake = fakeBrowser()
    scriptedHost(fake, ['a'])
    startBackground(fake.api, 'com.acorn.browser_bridge')
    const panel = sidebar(fake)
    await panel.call({ op: 'node.select', nodeId: 'a' })
    expect([...fake.storage.entries()]).toEqual([[SELECTED_NODE_KEY, 'a']])
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

  it('opens the sidebar from the toolbar in each browser', async () => {
    const chrome = fakeBrowser({ flavor: 'chrome' })
    startBackground(chrome.api, 'com.acorn.browser_bridge')
    await settle()
    expect(chrome.panelBehavior).toEqual({ openPanelOnActionClick: true })

    const firefox = fakeBrowser({ flavor: 'firefox' })
    startBackground(firefox.api, 'com.acorn.browser_bridge')
    firefox.clickAction()
    await settle()
    expect(firefox.sidebarToggles).toBe(1)
  })
})
