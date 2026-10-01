import { createEffect, Show } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, expect, it, vi } from 'vitest'
import { activeNodeId, clientEvents, onScopeEvicted, registerCommands, setActiveNode } from '@acorn/plugin-api/client'
import { evictScope } from '@acorn/plugin-api/testkit/client'
import { refreshFleet } from '@acorn/plugin-api/testkit/client'
import { initSessions, sessions, sessionNode } from './sessionStore'
import { holdTerminal, heldTerminalCount } from './heldTerminals'
import { initPtyChannel, wsAttach } from './wsChannel'
import { _resetWsClient } from '@acorn/plugin-api/testkit/ws-client'
import type { TerminalSession } from '../contract/wire'


// These ownership gates supply a running terminal service; availability is covered by the host.
vi.mock('@acorn/plugin-api/client', async (importOriginal) => ({
  ...await importOriginal<typeof import('@acorn/plugin-api/client')>(),
  hasHostCapability: () => true,
}))

vi.mock('./terminalClient', () => ({ terminalApi: (nodeId: string) => ({ list: async () => {
  order.push(`read:${nodeId}`)
  return [{ id: 'same-session', taskId: 'same-task', title: nodeId }] as TerminalSession[]
} }) }))
const order: string[] = []
afterEach(() => { setActiveNode(null); _resetWsClient(); delete (window as { acorn?: unknown }).acorn; order.length = 0 })

it('clears and releases A before B primes and registers under the authoritative batched selection', async () => {
  Object.assign(window, { acorn: {
    desktop: true,
    fleetList: async () => ({ nodes: ['a', 'b'].map((nodeId) => ({ nodeId, endpoint: 'https://127.0.0.1:1', label: nodeId, local: false })), statuses: ['a', 'b'].map((nodeId) => ({ nodeId, state: 'online' })) }),
    nodeFetch: () => Promise.reject(Error('unused')),
    nodeSend: (nodeId: string, frame: { channel: string }) => order.push(`${frame.channel}:${nodeId}`),
    onNodeFrame: () => () => {}, onNodeBytes: () => () => {}, onNodeStatus: () => () => {},
  } })
  _resetWsClient(); await refreshFleet(); setActiveNode('a')
  const host = document.createElement('div')
  const mapping = clientEvents.on('runtime:node-switched', ({ from, to }) => {
    order.push(`event:${activeNodeId()}:dom=${host.textContent}`)
    evictScope({ scope: 'node-switched', from, to })
  })
  const channel = initPtyChannel()
  const roster = initSessions()
  const observe = onScopeEvicted((event) => { if (event.scope === 'node-switched') order.push(`cleared:${sessions().length}`) })
  let disposed = 0
  const Shell = (props: { nodeId: string }) => {
    order.push(`build:${props.nodeId}`)
    const commands = registerCommands([{ id: `probe.${props.nodeId}`, title: props.nodeId, category: 'terminal', run: () => {} }])
    createEffect(() => { if (sessionNode() === props.nodeId) order.push(`draw:${props.nodeId}:${sessions().length}`) })
    const detach = wsAttach('same-session', () => {}, undefined, props.nodeId)
    holdTerminal(props.nodeId, 'same-session', () => ({ nodeId: props.nodeId, sessionId: 'same-session', mounted: false, dispose: () => { disposed++; order.push(`release:${props.nodeId}`); detach(); commands.dispose() } }))
    return <span>{props.nodeId}</span>
  }
  const stop = render(() => <Show keyed when={activeNodeId()}>{nodeId => <Shell nodeId={nodeId} />}</Show>, host)
  await Promise.resolve(); await Promise.resolve()
  setActiveNode('b')
  await Promise.resolve(); await Promise.resolve()
  expect(order).toContain('event:b:dom=a')
  expect(order.indexOf('release:a')).toBeLessThan(order.indexOf('build:b'))
  expect(order.indexOf('cleared:0')).toBeLessThan(order.indexOf('read:b'))
  expect(sessions()[0]?.title).toBe('b')
  expect(sessionNode()).toBe('b')
  expect(heldTerminalCount()).toBe(1)
  expect(disposed).toBe(1)
  stop(); observe(); roster(); channel(); mapping()
  expect(heldTerminalCount()).toBe(0)
})
