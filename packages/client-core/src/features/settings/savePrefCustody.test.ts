import { QueryClient } from '@tanstack/solid-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { prefsKey } from '@acorn/protocol/api.ts'
import { savePref, setPref } from './savePref'
import { setActiveNode } from '../../infra/node/activeNode'
import { _resetFleet, clientFor, refreshFleet, setCacheStorage } from '../../infra/node/fleet'

const notices = vi.hoisted(() => ({ pushBackgroundError: vi.fn() }))
vi.mock('../notifications/notifications', () => notices)
const targets: { nodeId: string; value: string }[] = []
let respond: (nodeId: string, value: string) => Promise<boolean>
beforeEach(async () => {
  _resetFleet()
  setCacheStorage({ getItem: async () => undefined, setItem: async () => {}, removeItem: async () => {} })
  targets.length = 0
  respond = async () => true
  vi.stubGlobal('window', { acorn: {
    fleetList: async () => ({ nodes: ['A', 'B'].map((nodeId) => ({ nodeId, label: nodeId, endpoint: 'https://synthetic.invalid' })), statuses: ['A', 'B'].map((nodeId) => ({ nodeId, state: 'online' })) }),
    onNodeStatus: () => () => {},
    nodeFetch: async (nodeId: string, request: { body: { kind: 'bytes'; bytes: Uint8Array } }) => {
      const body = JSON.parse(new TextDecoder().decode(request.body.bytes))
      targets.push({ nodeId, value: body.value })
      const ok = await respond(nodeId, body.value)
      return { status: ok ? 200 : 500, headers: {}, body: new TextEncoder().encode(JSON.stringify(ok ? body : { error: { code: 'fixture_failure', message: 'failed' } })) }
    },
  } })
  await refreshFleet()
  setActiveNode('A')
})
afterEach(() => {
  setActiveNode(null)
  _resetFleet()
  vi.unstubAllGlobals()
})

describe('preference origin custody', () => {
  it('uses the registered QueryClient partition before and after the Promise tail and selection switch', async () => {
    const qA = clientFor('A').client
    const saving = savePref(qA, 'node-owned', 'A-value')
    setActiveNode('B')
    expect(await saving).toBe(true)
    expect(targets).toEqual([{ nodeId: 'A', value: 'A-value' }])
    await savePref(qA, 'node-owned', 'A-after-switch')
    expect(targets[1].nodeId).toBe('A')
  })

  it('captures a custom client fallback immediately and never redirects a captured null target', async () => {
    const qc = new QueryClient()
    const saving = savePref(qc, 'custom', 'from-A')
    setActiveNode('B')
    await saving
    expect(targets[0].nodeId).toBe('A')
    setActiveNode(null)
    const absent = savePref(new QueryClient(), 'custom', 'no-target')
    setActiveNode('B')
    expect(await absent).toBe(false)
    expect(targets).toHaveLength(1)
  })

  it('keeps independent same-key confirmation, ordering, and rollback for A and B', async () => {
    const qA = clientFor('A').client, qB = clientFor('B').client
    qA.setQueryData(prefsKey, { same: 'A-confirmed' })
    qB.setQueryData(prefsKey, { same: 'B-confirmed' })
    let releaseA!: () => void
    respond = async (id, value) => {
      if (id === 'A' && value === 'A-new-confirmed') await new Promise<void>((resolve) => { releaseA = resolve })
      return value === 'A-new-confirmed'
    }
    const a1 = savePref(qA, 'same', 'A-new-confirmed')
    const a2 = savePref(qA, 'same', 'A-rejected')
    const b = savePref(qB, 'same', 'B-rejected')
    await vi.waitFor(() => expect(releaseA).toBeTypeOf('function'))
    expect(await b).toBe(false)
    expect(qB.getQueryData(prefsKey)).toEqual({ same: 'B-confirmed' })
    expect(targets.some((request) => request.value === 'A-rejected')).toBe(false)
    releaseA()
    expect(await Promise.all([a1, a2])).toEqual([true, false])
    expect(qA.getQueryData(prefsKey)).toEqual({ same: 'A-new-confirmed' })
    expect(qB.getQueryData(prefsKey)).toEqual({ same: 'B-confirmed' })
  })

  it('preserves direct browser setPref and origin partition semantics', async () => {
    vi.unstubAllGlobals()
    const fetch = vi.fn(async (_path: string, options: { body: Uint8Array }) => Response.json(JSON.parse(new TextDecoder().decode(options.body))))
    vi.stubGlobal('fetch', fetch)
    setActiveNode('B')
    await setPref('node-owned', 'direct')
    await savePref(clientFor('origin').client, 'node-owned', 'origin')
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(targets).toEqual([])
  })
})
