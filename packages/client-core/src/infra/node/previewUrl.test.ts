import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { NodeRecord } from '@acorn/protocol/broker.ts'
import { setActiveNode } from './activeNode'
import { refreshFleet, _resetFleet } from './fleet'
import { previewTarget, previewUrlForClient, remotePreviewBlocked } from './previewUrl'

const node = (nodeId: string, local: boolean): NodeRecord => ({
  nodeId,
  label: nodeId,
  endpoint: `https://127.0.0.1:9${nodeId.length}00`,
  local,
})

beforeEach(async () => {
  _resetFleet()
  ;(globalThis as { window?: unknown }).window = {
    acorn: {
      desktop: true,
      fleetList: () =>
        Promise.resolve({
          nodes: [node('local', true), node('remote', false)],
          statuses: [
            { nodeId: 'local', state: 'online' as const },
            { nodeId: 'remote', state: 'online' as const },
          ],
        }),
      onNodeStatus: () => () => {},
      previewProxy: { open: async () => ({ origin: '', entry: '' }), onBlocked: () => () => {} },
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

describe('previewTarget', () => {
  it("loads the local Node's address as it is", () => {
    expect(previewTarget('http://localhost:5173/', 'local')).toEqual({ kind: 'direct', url: 'http://localhost:5173/' })
    expect(previewTarget('https://staging.example.com/', 'local')).toEqual({
      kind: 'direct',
      url: 'https://staging.example.com/',
    })
  })

  it("proxies a remote Node's app on its own loopback, keeping the start page", () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]'])
      expect(previewTarget(`http://${host}:5173/app?x=1#top`, 'remote')).toEqual({
        kind: 'proxied',
        nodeId: 'remote',
        path: '/app?x=1#top',
      })
  })

  it("blocks a remote Node's address that isn't plain http on its loopback", () => {
    for (const url of [
      'http://192.168.1.1/admin',
      'https://localhost:5173/',
      'https://staging.example.com/',
      'nonsense',
    ])
      expect(previewTarget(url, 'remote')).toEqual({ kind: 'blocked', reason: 'not-loopback' })
  })

  it("blocks every remote Node where this computer can't proxy, or doesn't know the Node", () => {
    expect(previewTarget('http://localhost:5173/', 'unknown')).toEqual({ kind: 'blocked', reason: 'unsupported' })
    expect(previewTarget('http://localhost:5173/', null)).toEqual({ kind: 'blocked', reason: 'unsupported' })
    delete (window as { acorn?: { previewProxy?: unknown } }).acorn!.previewProxy
    expect(previewTarget('http://localhost:5173/', 'remote')).toEqual({ kind: 'blocked', reason: 'unsupported' })
  })
})
