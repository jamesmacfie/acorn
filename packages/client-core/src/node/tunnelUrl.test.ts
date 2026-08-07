import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { NodeRecord } from '@acorn/protocol/broker.ts'
import { setActiveNode } from './activeNode'
import { refreshFleet, _resetFleet } from './fleet'
import { loopbackTarget, tunnelUrl } from './tunnelUrl'

const node = (nodeId: string, local: boolean): NodeRecord => ({
  nodeId, label: nodeId, endpoint: `https://127.0.0.1:9${nodeId.length}00`, local,
})

let asked: { nodeId: string; taskId: string; port: number }[] = []
let opens: (request: { nodeId: string; taskId: string; port: number }) => Promise<{ port: number }>

beforeEach(async () => {
  _resetFleet()
  asked = []
  opens = (request) => {
    asked.push(request)
    return Promise.resolve({ port: 51000 })
  }
  ;(globalThis as { window?: unknown }).window = {
    acorn: {
      desktop: true,
      fleetList: () => Promise.resolve({
        nodes: [node('local', true), node('remote', false)],
        statuses: [{ nodeId: 'local', state: 'online' as const }, { nodeId: 'remote', state: 'online' as const }],
      }),
      onNodeStatus: () => () => {},
      nodeTunnelOpen: (request: { nodeId: string; taskId: string; port: number }) => opens(request),
      nodeTunnelClose: () => {},
    },
  }
  await refreshFleet()
})

afterEach(() => {
  _resetFleet()
  setActiveNode(null)
  delete (globalThis as { window?: unknown }).window
})

describe('loopbackTarget', () => {
  it('recognises the loopback spellings and keeps the rest of the URL', () => {
    expect(loopbackTarget('http://localhost:5173/app?x=1#top')).toEqual({ port: 5173, rest: '/app?x=1#top' })
    expect(loopbackTarget('http://127.0.0.1:3000')).toEqual({ port: 3000, rest: '/' })
    expect(loopbackTarget('https://localhost')).toEqual({ port: 443, rest: '/' })
    expect(loopbackTarget('http://localhost')).toEqual({ port: 80, rest: '/' })
  })

  it('is null for anything that does not need a tunnel or must not get one', () => {
    // A real host is already reachable from here, and tunnelling it would be the general proxy protocol.md
    // rules out. `localhost@evil.test` is the userinfo trick the preview URL guard also refuses.
    expect(loopbackTarget('https://staging.example.com')).toBeNull()
    expect(loopbackTarget('http://localhost@evil.test/')).toBeNull()
    expect(loopbackTarget('file:///etc/passwd')).toBeNull()
    expect(loopbackTarget('not a url')).toBeNull()
  })
})

describe('tunnelUrl', () => {
  it('leaves the URL alone for the local node', async () => {
    // Same machine: a tunnel would be a pointless extra hop, and every single-node install takes this path.
    setActiveNode('local')
    await expect(tunnelUrl('task-1', 'http://localhost:5173/')).resolves.toBe('http://localhost:5173/')
    expect(asked).toEqual([])
  })

  it('rewrites a loopback URL to a tunnel port for a remote node', async () => {
    setActiveNode('remote')
    await expect(tunnelUrl('task-1', 'http://localhost:5173/app?x=1')).resolves.toBe('http://127.0.0.1:51000/app?x=1')
    expect(asked).toEqual([{ nodeId: 'remote', taskId: 'task-1', port: 5173 }])
  })

  it('leaves a non-loopback URL alone even on a remote node', async () => {
    setActiveNode('remote')
    await expect(tunnelUrl('task-1', 'https://staging.example.com/')).resolves.toBe('https://staging.example.com/')
    expect(asked).toEqual([])
  })

  it('returns NULL when the tunnel cannot be opened, rather than the original URL', async () => {
    // This case asserted the opposite until the Phase 4 review, and the original reasoning ("no worse than
    // before tunnels existed") was wrong. The URL is loopback and the node is REMOTE, so falling back loads
    // whatever is on the OWNER'S machine at that port while the pane claims to show the remote task's
    // preview — a repo configured `previewMode: 'url' = http://localhost:8025` on a build box rendered the
    // owner's own Mailhog. Showing nothing is the only honest answer; main logs why.
    setActiveNode('remote')
    opens = () => Promise.reject(new Error('403'))
    await expect(tunnelUrl('task-1', 'http://localhost:5173/')).resolves.toBeNull()
  })

  it('returns NULL for a remote loopback URL in a build with no tunnel support', async () => {
    // Same reasoning: no `nodeTunnelOpen` means no way to reach the node's port, so the pane must not be
    // handed a URL that resolves here instead.
    setActiveNode('remote')
    const bridge = (globalThis as { window?: { acorn?: Record<string, unknown> } }).window?.acorn
    delete bridge?.nodeTunnelOpen
    await expect(tunnelUrl('task-1', 'http://localhost:5173/')).resolves.toBeNull()
  })

  it('passes null through', async () => {
    setActiveNode('remote')
    await expect(tunnelUrl('task-1', null)).resolves.toBeNull()
  })
})
