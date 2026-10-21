import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SEAM_GROUPS, seamProblems, type SeamGroup } from '@acorn/client-core/infra/platform'
import type { NodeStatus } from '@acorn/protocol/broker.ts'
import { SIGNED_OUT_CLOSE_CODE as GATEWAY_SIGNED_OUT } from '../gateway/gateway'

// The phone's half of the platform-seam contract, beside the desktop's and the terminal's
// (apps/tui/src/platform.test.ts). The list below is the decision: a group added to the seam fails
// here until it is named as implemented or left out.
const IMPLEMENTED: SeamGroup[] = ['transport', 'fleet']
const LEFT_OUT: SeamGroup[] = [
  'desktop',
  'pairing',
  'plugins',
  'config',
  'desktopExtras',
  'cli',
  'folderPicker',
  'files',
  'notify',
  'recovery',
  'oauthCallback',
  'rendererLayer',
  'preview',
  'webviews',
]

class FakeSocket {
  static readonly OPEN = 1
  static opened: FakeSocket[] = []
  readyState = 0
  binaryType = 'blob'
  sent: string[] = []
  onopen?: () => void
  onmessage?: (event: { data: unknown }) => void
  onclose?: (event: { code: number }) => void
  constructor(readonly url: string) {
    FakeSocket.opened.push(this)
  }
  send(message: string): void {
    this.sent.push(message)
  }
  close(): void {
    this.readyState = 3
  }
  open(): void {
    this.readyState = FakeSocket.OPEN
    this.onopen?.()
  }
  receive(data: unknown): void {
    this.onmessage?.({ data })
  }
  drop(code = 1006): void {
    this.readyState = 3
    this.onclose?.({ code })
  }
}

type Acorn = {
  nodeFetch(
    nodeId: string,
    request: unknown,
  ): Promise<{ status: number; headers: Record<string, string>; body: Uint8Array }>
  nodeAbort(requestId: string): void
  nodeSend(nodeId: string, frame: unknown, options?: unknown): void
  onNodeFrame(cb: (nodeId: string, frame: unknown) => void): () => void
  onNodeStatus(cb: (status: NodeStatus) => void): () => void
  fleetList(): Promise<{ nodes: { nodeId: string; label: string }[] }>
}

const ONLINE: NodeStatus = { nodeId: 'node-1', state: 'online' }
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

let fetchMock: ReturnType<typeof vi.fn>
let acorn: Acorn
let signedOut: () => boolean
const socket = () => FakeSocket.opened.at(-1)!

beforeEach(async () => {
  vi.useFakeTimers()
  FakeSocket.opened = []
  fetchMock = vi.fn(async () => json(200, { nodeId: 'node-1', label: 'Studio Mac' }))
  vi.stubGlobal('window', globalThis)
  vi.stubGlobal('location', new URL('http://127.0.0.1:4321/t/task-1'))
  vi.stubGlobal('WebSocket', FakeSocket)
  vi.stubGlobal('fetch', fetchMock)
  vi.resetModules()
  const platform = await import('./platform')
  platform.installPlatform()
  signedOut = platform.signedOut
  acorn = (globalThis as unknown as { acorn: Acorn }).acorn
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  delete (globalThis as { acorn?: unknown }).acorn
})

describe('the phone satisfies the platform seam', () => {
  it('implements the groups it claims, completely, and nothing else', () => {
    expect(seamProblems(IMPLEMENTED)).toEqual([])
    expect([...IMPLEMENTED, ...LEFT_OUT].sort()).toEqual([...SEAM_GROUPS].sort())
  })

  it('closes on the code the gateway sends a revoked phone', async () => {
    const { SIGNED_OUT_CLOSE_CODE } = await import('./platform')
    expect(SIGNED_OUT_CLOSE_CODE).toBe(GATEWAY_SIGNED_OUT)
  })
})

describe('the transport', () => {
  it('sends a Node request to the gateway under /node and hands back its answer', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { tasks: [] }))
    const answer = await acorn.nodeFetch('node-1', {
      requestId: 'r1',
      path: '/v1/core/tasks?archived=1',
      method: 'GET',
      headers: { 'x-request-id': 'r1' },
    })
    expect(fetchMock).toHaveBeenCalledWith(
      '/node/v1/core/tasks?archived=1',
      expect.objectContaining({ method: 'GET', headers: { 'x-request-id': 'r1' } }),
    )
    expect(answer.status).toBe(200)
    expect(answer.headers['content-type']).toBe('application/json')
    expect(new TextDecoder().decode(answer.body)).toBe('{"tasks":[]}')
  })

  it('aborts a request by its ID', async () => {
    fetchMock.mockImplementationOnce(
      (_url: string, init: RequestInit) =>
        new Promise((_done, fail) => init.signal!.addEventListener('abort', () => fail(new Error('aborted')))),
    )
    const pending = acorn.nodeFetch('node-1', { requestId: 'r2', path: '/v1/core/tasks' })
    acorn.nodeAbort('r2')
    await expect(pending).rejects.toThrow('aborted')
  })

  it('holds frames until the socket opens, then relays both ways', () => {
    const frames: unknown[] = []
    acorn.onNodeFrame((_nodeId, frame) => frames.push(frame))
    acorn.nodeSend('node-1', { channel: 'term:attach', sessionId: 's1' }, { intent: { kind: 'subscribe' } })
    expect(socket().url).toBe('ws://127.0.0.1:4321/events')
    expect(socket().sent).toEqual([])
    socket().open()
    expect(socket().sent.map((message) => JSON.parse(message))).toEqual([
      { frame: { channel: 'term:attach', sessionId: 's1' }, intent: { kind: 'subscribe' } },
    ])
    socket().receive(JSON.stringify({ frame: { channel: 'tasks:changed' } }))
    expect(frames).toEqual([{ channel: 'tasks:changed' }])
  })

  it('says the Node is offline while the gateway is gone, and reconnects', async () => {
    const statuses: NodeStatus[] = []
    acorn.onNodeStatus((status) => statuses.push(status))
    socket().open()
    socket().receive(JSON.stringify({ status: ONLINE }))
    socket().drop()
    expect(statuses.at(-1)).toMatchObject({ nodeId: 'node-1', state: 'offline', error: { code: 'unreachable' } })
    await vi.advanceTimersByTimeAsync(250)
    expect(FakeSocket.opened).toHaveLength(2)
    expect(signedOut()).toBe(false)
  })
})

describe('signing out', () => {
  it('follows the gateway when it closes the socket for a revoked session', () => {
    socket().open()
    socket().drop(GATEWAY_SIGNED_OUT)
    expect(signedOut()).toBe(true)
  })

  it('tells a refused socket from a stopped gateway', async () => {
    fetchMock.mockResolvedValueOnce(json(401, { error: { code: 'signed_out' } }))
    socket().drop()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(signedOut()).toBe(true)
    expect(FakeSocket.opened).toHaveLength(1)
  })

  it('follows a signed-out answer to a Node request', async () => {
    fetchMock.mockResolvedValueOnce(json(401, { error: { code: 'signed_out' } }))
    await acorn.nodeFetch('node-1', { requestId: 'r3', path: '/v1/core/tasks' })
    expect(signedOut()).toBe(true)
  })
})

describe('the fleet', () => {
  it('lists the gateway’s one Node by the name the gateway gives it', async () => {
    const fleet = await acorn.fleetList()
    expect(fleet.nodes).toEqual([
      { nodeId: 'node-1', label: 'Studio Mac', endpoint: 'http://127.0.0.1:4321', local: false },
    ])
  })
})
