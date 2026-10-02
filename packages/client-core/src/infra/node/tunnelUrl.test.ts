import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NodeRecord } from '@acorn/protocol/broker.ts'
import { setActiveNode } from './activeNode'
import { refreshFleet, _resetFleet } from './fleet'
import { previewUrlForClient, remotePreviewBlocked, tunnelUrl, closeTunnelsForTask } from './tunnelUrl'

const close = vi.fn()

const node = (nodeId: string, local: boolean): NodeRecord => ({
  nodeId, label: nodeId, endpoint: `https://127.0.0.1:9${nodeId.length}00`, local,
})

beforeEach(async () => {
  _resetFleet()
  close.mockClear()
  ;(globalThis as { window?: unknown }).window = {
    acorn: {
      desktop: true,
      fleetList: () => Promise.resolve({
        nodes: [node('local', true), node('remote', false)],
        statuses: [{ nodeId: 'local', state: 'online' as const }, { nodeId: 'remote', state: 'online' as const }],
      }),
      onNodeStatus: () => () => {},
      nodeTunnelOpen: () => { throw new Error('remote preview must not open a tunnel') },
      nodeTunnelClose: close,
    },
  }
  await refreshFleet()
})

afterEach(() => {
  _resetFleet()
  setActiveNode(null)
  delete (globalThis as { window?: unknown }).window
})

describe('tunnelUrl', () => {
  it('keeps the local node preview available', async () => {
    setActiveNode('local')
    expect(remotePreviewBlocked()).toBe(false)
    expect(previewUrlForClient('http://localhost:5173/')).toBe('http://localhost:5173/')
    await expect(tunnelUrl('task-1', 'http://localhost:5173/')).resolves.toBe('http://localhost:5173/')
  })

  it('blocks remote loopback, private, and public previews before any tunnel opens', async () => {
    setActiveNode('remote')
    expect(remotePreviewBlocked()).toBe(true)
    expect(previewUrlForClient('http://localhost:5173/')).toBeNull()
    expect(previewUrlForClient('http://192.168.1.1/admin')).toBeNull()
    expect(previewUrlForClient('https://staging.example.com/')).toBeNull()
    await expect(tunnelUrl('task-1', 'http://localhost:5173/')).resolves.toBeNull()
    await expect(tunnelUrl('task-1', 'http://192.168.1.1/admin')).resolves.toBeNull()
    await expect(tunnelUrl('task-1', 'https://staging.example.com/')).resolves.toBeNull()
  })

  it('fails closed when the selected node is absent from custody membership', async () => {
    setActiveNode('unknown')
    expect(remotePreviewBlocked()).toBe(true)
    await expect(tunnelUrl('task-1', 'http://localhost:5173/')).resolves.toBeNull()
  })

  it('fails closed while a desktop has no selected node', async () => {
    setActiveNode(null)
    expect(remotePreviewBlocked()).toBe(true)
    await expect(tunnelUrl('task-1', 'https://example.com/')).resolves.toBeNull()
  })

  it('passes null through', async () => {
    setActiveNode('remote')
    await expect(tunnelUrl('task-1', null)).resolves.toBeNull()
  })
})

it('closes only the captured Node and never makes a task-only close without a Node', () => {
  setActiveNode('remote')
  closeTunnelsForTask('same', 'local')
  expect(close).toHaveBeenCalledWith({ nodeId: 'local', taskId: 'same' })
  closeTunnelsForTask('same', null)
  expect(close).toHaveBeenCalledOnce()
})

it('classifies a URL by its originating Node after the selection changes', async () => {
  setActiveNode('local')
  expect(await tunnelUrl('same', 'http://localhost:3000', 'remote')).toBeNull()
  expect(await tunnelUrl('same', 'http://localhost:3000', 'local')).toBe('http://localhost:3000')
})
