import { describe, expect, it } from 'vitest'
import { NATIVE_REPLY_MAX_CHARS } from '@acorn/protocol/extensionBridge.ts'
import type { HostState } from '../messages'
import { fakeBrowser, settle } from '../test/fakeBrowser'
import { nativeBridge } from './nativeBridge'

function subject(flavor: 'chrome' | 'firefox' = 'chrome', firstReplyMs?: number) {
  const fake = fakeBrowser({ flavor })
  const hostStates: Pick<HostState, 'state' | 'message'>[] = []
  const statuses: unknown[] = []
  const hints: unknown[] = []
  const handoffChanges: string[] = []
  const projectChanges: string[] = []
  const taskChanges: string[] = []
  const bridge = nativeBridge(
    fake.api,
    'com.acorn.browser_bridge',
    {
      status: (status) => statuses.push(status),
      agents: (hint) => hints.push(hint),
      handoffs: (nodeId) => handoffChanges.push(nodeId),
      projects: (nodeId) => projectChanges.push(nodeId),
      tasks: (nodeId) => taskChanges.push(nodeId),
      host: (state) => hostStates.push(state),
    },
    { firstReplyMs },
  )
  return { fake, bridge, hostStates, statuses, hints, handoffChanges, projectChanges, taskChanges }
}

const idOf = (message: unknown) => (message as { id: string }).id

describe('native bridge', () => {
  it('passes on the Node change events', async () => {
    const { fake, bridge, handoffChanges, projectChanges, taskChanges } = subject()
    fake.onNativeMessage = (message, host) => {
      host.send({ v: 1, event: 'handoffs', nodeId: 'n1' })
      host.send({ v: 1, event: 'projects', nodeId: 'n1' })
      host.send({ v: 1, event: 'tasks', nodeId: 'n1' })
      host.send({ v: 1, id: idOf(message), ok: true, result: { nodes: [], activeNodeId: null, status: null } })
    }
    await bridge.request({ op: 'nodes.list' })
    expect(handoffChanges).toEqual(['n1'])
    expect(projectChanges).toEqual(['n1'])
    expect(taskChanges).toEqual(['n1'])
  })

  it('sends the protocol envelope and resolves the matching reply', async () => {
    const { fake, bridge, hostStates } = subject()
    fake.onNativeMessage = (message, host) =>
      host.send({ v: 1, id: idOf(message), ok: true, result: { nodes: [], activeNodeId: null, status: null } })
    await expect(bridge.request({ op: 'nodes.list' })).resolves.toEqual({ nodes: [], activeNodeId: null, status: null })
    expect(fake.hosts[0]!.received).toEqual([{ v: 1, id: expect.any(String), op: 'nodes.list' }])
    expect(hostStates.at(-1)).toEqual({ state: 'connected', message: null })
  })

  it('rebuilds a chunked reply in any order', async () => {
    const { fake, bridge } = subject()
    fake.onNativeMessage = (message, host) => {
      const json = JSON.stringify({ v: 1, id: idOf(message), ok: true, result: { nodeId: 'n', projects: [] } })
      const half = Math.ceil(json.length / 2)
      host.send({ v: 1, id: idOf(message), chunk: { index: 1, count: 2, data: json.slice(half) } })
      host.send({ v: 1, id: idOf(message), chunk: { index: 0, count: 2, data: json.slice(0, half) } })
    }
    await expect(bridge.request({ op: 'projects.list', nodeId: 'n' })).resolves.toEqual({ nodeId: 'n', projects: [] })
  })

  it('refuses a transfer beyond the assembly limit or with inconsistent chunks', async () => {
    const { fake, bridge } = subject()
    fake.onNativeMessage = (message, host) =>
      host.send({
        v: 1,
        id: idOf(message),
        chunk: { index: 0, count: 3, data: 'x'.repeat(NATIVE_REPLY_MAX_CHARS + 1) },
      })
    await expect(bridge.request({ op: 'nodes.list' })).rejects.toMatchObject({ code: 'reply_too_large' })
    fake.onNativeMessage = (message, host) => {
      host.send({ v: 1, id: idOf(message), chunk: { index: 0, count: 2, data: '{' } })
      host.send({ v: 1, id: idOf(message), chunk: { index: 0, count: 2, data: '{' } })
    }
    await expect(bridge.request({ op: 'nodes.list' })).rejects.toMatchObject({ code: 'reply_too_large' })
  })

  it('discards an unfinished transfer and fails every pending request when the host exits', async () => {
    const { fake, bridge, hostStates } = subject()
    fake.onNativeMessage = (message, host) => {
      if ((message as { op: string }).op === 'projects.list')
        host.send({ v: 1, id: idOf(message), chunk: { index: 0, count: 2, data: '{"v":1' } })
    }
    const partial = bridge.request({ op: 'projects.list', nodeId: 'n' })
    const waiting = bridge.request({ op: 'nodes.list' })
    await settle()
    fake.hosts[0]!.close('Native host has exited.')
    await expect(partial).rejects.toMatchObject({ code: 'host_unavailable' })
    await expect(waiting).rejects.toMatchObject({ code: 'host_unavailable' })
    expect(hostStates.at(-1)).toEqual({ state: 'exited', message: 'The bridge stopped: Native host has exited.' })
    expect(bridge.closed).toBe(true)
  })

  it.each([
    ['chrome', 'Specified native messaging host not found.'],
    ['firefox', 'No such native application com.acorn.browser_bridge'],
  ] as const)('reports a missing host as %s words it', async (flavor, reason) => {
    const { fake, bridge, hostStates } = subject(flavor)
    fake.onNativeConnect = (host) => host.close(reason)
    await expect(bridge.request({ op: 'nodes.list' })).rejects.toMatchObject({ code: 'host_unavailable' })
    expect(hostStates.at(-1)).toEqual({ state: 'missing', message: 'The Acorn browser bridge is not installed.' })
  })

  it('gives up on a port that never answers, and opens a new one for the next call', async () => {
    const { fake, bridge, hostStates } = subject('firefox', 20)
    await expect(bridge.request({ op: 'nodes.list' })).rejects.toMatchObject({ code: 'host_unavailable' })
    expect(hostStates.at(-1)).toEqual({ state: 'exited', message: 'The bridge did not answer.' })
    fake.onNativeMessage = (message, host) => host.send({ v: 1, id: idOf(message), ok: true, result: 'answered' })
    await expect(bridge.request({ op: 'nodes.list' })).resolves.toBe('answered')
    expect(fake.hosts).toHaveLength(2)
  })

  it('passes status events through and ignores another protocol version', async () => {
    const { fake, bridge, statuses } = subject()
    fake.onNativeMessage = (message, host) => {
      host.send({ v: 2, id: idOf(message), ok: true, result: 'wrong version' })
      host.send({ v: 1, event: 'status', status: { nodeId: 'n', state: 'online' } })
      host.send({ v: 1, id: idOf(message), ok: false, error: { code: 'unknown_node', message: 'Unknown.' } })
    }
    await expect(bridge.request({ op: 'node.select', nodeId: 'n' })).rejects.toMatchObject({ code: 'unknown_node' })
    expect(statuses).toEqual([{ nodeId: 'n', state: 'online' }])
  })

  it('passes an agents hint on without its envelope', async () => {
    const { fake, bridge, hints } = subject()
    fake.onNativeMessage = (message, host) => {
      host.send({ v: 1, event: 'agent', nodeId: 'n', sessions: ['s1'], tasks: [], missed: false })
      host.send({ v: 1, id: idOf(message), ok: true, result: { nodes: [], activeNodeId: null, status: null } })
    }
    await bridge.request({ op: 'nodes.list' })
    expect(hints).toEqual([{ nodeId: 'n', sessions: ['s1'], tasks: [], missed: false }])
  })
})
