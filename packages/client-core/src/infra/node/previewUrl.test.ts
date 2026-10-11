import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { NodeRecord } from '@acorn/protocol/broker.ts'
import { setActiveNode } from './activeNode'
import { refreshFleet, _resetFleet } from './fleet'
import { previewUrlForClient, remotePreviewBlocked } from './previewUrl'

const node = (nodeId: string, local: boolean): NodeRecord => ({
  nodeId, label: nodeId, endpoint: `https://127.0.0.1:9${nodeId.length}00`, local,
})

beforeEach(async () => {
  _resetFleet()
  ;(globalThis as { window?: unknown }).window = {
    acorn: {
      desktop: true,
      fleetList: () => Promise.resolve({
        nodes: [node('local', true), node('remote', false)],
        statuses: [{ nodeId: 'local', state: 'online' as const }, { nodeId: 'remote', state: 'online' as const }],
      }),
      onNodeStatus: () => () => {},
    },
  }
  await refreshFleet()
})

afterEach(() => {
  _resetFleet()
  setActiveNode(null)
  delete (globalThis as { window?: unknown }).window
})

describe('previewUrlForClient', () => {
  it('keeps the local node preview available', () => {
    setActiveNode('local')
    expect(remotePreviewBlocked()).toBe(false)
    expect(previewUrlForClient('http://localhost:5173/')).toBe('http://localhost:5173/')
  })

  it('blocks remote loopback, private, and public previews', () => {
    setActiveNode('remote')
    expect(remotePreviewBlocked()).toBe(true)
    expect(previewUrlForClient('http://localhost:5173/')).toBeNull()
    expect(previewUrlForClient('http://192.168.1.1/admin')).toBeNull()
    expect(previewUrlForClient('https://staging.example.com/')).toBeNull()
  })

  it('fails closed when the selected node is absent from custody membership', () => {
    setActiveNode('unknown')
    expect(remotePreviewBlocked()).toBe(true)
    expect(previewUrlForClient('http://localhost:5173/')).toBeNull()
  })

  it('fails closed while a desktop has no selected node', () => {
    setActiveNode(null)
    expect(remotePreviewBlocked()).toBe(true)
    expect(previewUrlForClient('https://example.com/')).toBeNull()
  })

  it('passes null through', () => {
    setActiveNode('remote')
    expect(previewUrlForClient(null)).toBeNull()
  })
})

it('classifies a URL by its originating Node after the selection changes', () => {
  setActiveNode('local')
  expect(previewUrlForClient('http://localhost:3000', 'remote')).toBeNull()
  expect(previewUrlForClient('http://localhost:3000', 'local')).toBe('http://localhost:3000')
})
