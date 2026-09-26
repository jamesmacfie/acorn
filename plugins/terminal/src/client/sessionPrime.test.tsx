// When the session list is first read. A `.tsx` beside `./sessionStore.test.ts` because this is the
// reactive part, and only the `hosts` project resolves Solid's browser build (plugins/vitest.shared.ts).
import { expect, it, vi } from 'vitest'
import { createSignal } from 'solid-js'
import { evictScope } from '@acorn/plugin-api/testkit/client'

const [testNodeId, setTestNodeId] = createSignal<string | null>('node-a')
const [testNodeState, setTestNodeState] = createSignal<'offline' | 'online'>('offline')
vi.mock('@acorn/plugin-api/client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  activeNodeId: () => testNodeId(),
  nodeState: () => testNodeState(),
  hasHostCapability: () => true,
}))

const { initSessions } = await import('./sessionStore')

const settle = (): Promise<void> => new Promise((done) => setTimeout(done, 0))

// The client plugin host runs `activate` once per launch now, before any node has answered, so the
// read can no longer lean on a second activation to retry it.
it('reads once the node can answer, not at activation, and once per node', async () => {
  const fetch = vi.fn(async () => new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }))
  vi.stubGlobal('fetch', fetch)
  const stop = initSessions()
  await settle()
  expect(fetch).toHaveBeenCalledTimes(0)

  setTestNodeState('online')
  await settle()
  expect(fetch).toHaveBeenCalledTimes(1)

  // A drop and a return is the socket's reconnect to handle, not a second prime.
  setTestNodeState('offline')
  await settle()
  setTestNodeState('online')
  await settle()
  expect(fetch).toHaveBeenCalledTimes(1)

  // A switch to a node that cannot answer yet reads nothing until it can. The signal changes first
  // and the eviction follows, which is the order setActiveNode uses.
  setTestNodeState('offline')
  setTestNodeId('node-b')
  evictScope({ scope: 'node-switched' })
  await settle()
  expect(fetch).toHaveBeenCalledTimes(1)
  setTestNodeState('online')
  await settle()
  expect(fetch).toHaveBeenCalledTimes(2)

  stop()
  setTestNodeId('node-c')
  await settle()
  expect(fetch).toHaveBeenCalledTimes(2)
  vi.unstubAllGlobals()
})
