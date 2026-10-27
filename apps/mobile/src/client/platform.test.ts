import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SEAM_GROUPS, seamProblems, type SeamGroup } from '@acorn/client-core/infra/platform'
import type { ChannelClient, ChannelListeners, ChannelResponse } from '@acorn/channel/client.ts'
import type { NodeStatus } from '@acorn/protocol/broker.ts'

// The phone's half of the platform-seam contract, beside the desktop's and the terminal's
// (apps/tui/src/platform.test.ts). The list below is the decision: a group added to the seam fails
// here until it is named as implemented or left out.
const IMPLEMENTED: SeamGroup[] = ['transport', 'fleet']
// There only when the build names a sandbox domain, for the plugin code it keeps to run on.
const WITH_A_SANDBOX: SeamGroup[] = ['plugins']
const LEFT_OUT: SeamGroup[] = [
  'desktop',
  'pairing',
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
  'previewProxy',
  'webviews',
]

type Acorn = {
  nodeFetch(
    nodeId: string,
    request: unknown,
  ): Promise<{ status: number; headers: Record<string, string>; body: Uint8Array }>
  nodeAbort(requestId: string): void
  nodeSend(nodeId: string, frame: unknown, options?: unknown): void
  nodeInterest(nodeId: string | null): void
  onNodeFrame(cb: (nodeId: string, frame: unknown) => void): () => void
  onNodeStatus(cb: (status: NodeStatus) => void): () => void
  fleetList(): Promise<{
    nodes: { nodeId: string; label: string; endpoint: string; local: boolean }[]
    statuses: NodeStatus[]
  }>
  nodeForget(nodeId: string, revoke: boolean): Promise<void>
  nodeRename(nodeId: string, label: string): Promise<unknown>
  nodeAdopt(): Promise<unknown>
}

const stored = vi.hoisted(() => ({
  nodes: new Map<string, { nodeId: string; label: string; channelKey: string; pairedAt: number }>(),
  // Errors the next channels fail to open with.
  openFails: [] as Error[],
}))
vi.mock('./pairedNodes', () => ({
  pairedNodes: async () => [...stored.nodes.values()],
  readToken: async (nodeId: string) => (stored.nodes.has(nodeId) ? `token-for-${nodeId}` : null),
  forgetPaired: async (nodeId: string) => void stored.nodes.delete(nodeId),
  renamePaired: async (nodeId: string, label: string) => {
    const node = stored.nodes.get(nodeId)
    if (node) stored.nodes.set(nodeId, { ...node, label })
  },
}))

type Opened = {
  nodeId: string
  channelKey: string
  listeners: ChannelListeners
  client: ChannelClient & { sent: unknown[] }
}
const opened: Opened[] = []
vi.mock('./openChannel', () => ({
  openNodeChannel: async (nodeId: string, channelKey: string, listeners: ChannelListeners) => {
    const failure = stored.openFails.shift()
    if (failure) throw failure
    let end!: () => void
    const sent: unknown[] = []
    const client = {
      sent,
      closed: new Promise<void>((resolve) => (end = resolve)),
      close: () => end(),
      openEvents: async () => true,
      sendFrame: (json: string) => void sent.push(JSON.parse(json)),
      request: (
        request: { path: string; headers: Record<string, string>; body?: Uint8Array },
        signal?: AbortSignal,
      ) => {
        sent.push(request)
        if (request.path === '/v1/slow')
          return new Promise<ChannelResponse>((_resolve, reject) =>
            signal?.addEventListener('abort', () => reject(new Error('aborted'))),
          )
        return Promise.resolve({
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: new TextEncoder().encode(`{"node":"${nodeId}"}`),
        })
      },
    }
    opened.push({ nodeId, channelKey, listeners, client })
    return client
  },
}))

let acorn: Acorn
let signedOut: () => boolean
const settle = () => vi.advanceTimersByTimeAsync(0)

beforeEach(async () => {
  vi.useFakeTimers()
  opened.length = 0
  stored.openFails.length = 0
  stored.nodes.clear()
  stored.nodes.set('node-1', { nodeId: 'node-1', label: 'Studio Mac', channelKey: 'aa'.repeat(32), pairedAt: 1 })
  stored.nodes.set('node-2', { nodeId: 'node-2', label: 'Linux box', channelKey: 'bb'.repeat(32), pairedAt: 2 })
  vi.stubGlobal('window', globalThis)
  vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }))
  vi.resetModules()
  const platform = await import('./platform')
  platform.installPlatform()
  signedOut = platform.signedOut
  acorn = (globalThis as unknown as { acorn: Acorn }).acorn
  await acorn.fleetList()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  delete (globalThis as { acorn?: unknown }).acorn
})

describe('the phone satisfies the platform seam', () => {
  it('implements the groups it claims, completely, and nothing else', () => {
    expect(seamProblems(IMPLEMENTED)).toEqual([])
    expect([...IMPLEMENTED, ...WITH_A_SANDBOX, ...LEFT_OUT].sort()).toEqual([...SEAM_GROUPS].sort())
  })
})

// What the plugin group asks of the rest of the phone. The rules and the storage have their own tests
// (./pluginCustody.test.ts), so the custody module is replaced here.
const custody = vi.hoisted(() => ({
  fetchers: [] as { fetch: (nodeId: string, request: unknown) => Promise<unknown> }[],
}))
vi.mock('./pluginCustody', () => ({
  openPluginCustody: async (fetcher: (typeof custody.fetchers)[number]) => {
    custody.fetchers.push(fetcher)
    return {
      custody: { state: async () => ({ cached: {}, acks: [], devGrants: [] }) },
      forgetNode: async () => {},
    }
  },
}))

describe('the phone’s plugin group', () => {
  async function installWithSandbox(domain: string | null) {
    vi.stubGlobal('__ACORN_SANDBOX_DOMAIN__', domain)
    delete (globalThis as { acorn?: unknown }).acorn
    vi.resetModules()
    ;(await import('./platform')).installPlatform()
    const installed = (globalThis as unknown as { acorn: Acorn & { plugins?: { state(): Promise<unknown> } } }).acorn
    await installed.fleetList()
    return installed
  }

  it('is absent when the build names no sandbox domain, so no prompt is asked for code that can’t run', async () => {
    expect((await installWithSandbox(null)).plugins).toBeUndefined()
    expect(seamProblems(IMPLEMENTED)).toEqual([])
  })

  it('satisfies the seam when there is one, loading custody only when something asks', async () => {
    custody.fetchers.length = 0
    const { plugins } = await installWithSandbox('sandbox.test')
    expect(seamProblems([...IMPLEMENTED, ...WITH_A_SANDBOX])).toEqual([])
    expect(custody.fetchers).toEqual([])
    await expect(plugins!.state()).resolves.toEqual({ cached: {}, acks: [], devGrants: [] })
    await plugins!.state()
    expect(custody.fetchers).toHaveLength(1)
  })

  it('fetches bundles over the channel of the Node that offers them', async () => {
    custody.fetchers.length = 0
    const { plugins } = await installWithSandbox('sandbox.test')
    await plugins!.state()
    await custody.fetchers[0]!.fetch('node-2', { requestId: 'bundle', path: '/v1/core/plugins/runn/bundles/abc' })
    expect(opened.map((channel) => channel.nodeId)).toEqual(['node-2'])
    expect(opened[0]!.client.sent[0]).toMatchObject({ method: 'GET', path: '/v1/core/plugins/runn/bundles/abc' })
  })
})

describe('the fleet', () => {
  it('lists every Node this phone is paired with, as not on this computer, at the name the relay uses', async () => {
    const { nodes } = await acorn.fleetList()
    expect(nodes).toEqual([
      { nodeId: 'node-1', label: 'Studio Mac', endpoint: 'https://node-1.relay.acorn', local: false },
      { nodeId: 'node-2', label: 'Linux box', endpoint: 'https://node-2.relay.acorn', local: false },
    ])
  })

  it('forgets a Node on this phone only, and closes its channel', async () => {
    await acorn.nodeFetch('node-1', { requestId: 'r', path: '/v1/node' })
    await acorn.nodeForget('node-1', true)
    expect((await acorn.fleetList()).nodes.map((node) => node.nodeId)).toEqual(['node-2'])
    await expect(opened[0]!.client.closed).resolves.toBeUndefined()
    await expect(acorn.nodeFetch('node-1', { requestId: 'r2', path: '/v1/node' })).rejects.toThrow('isn’t paired')
  })

  it('renames a Node, and has no screen for the other ways into the fleet', async () => {
    await acorn.nodeRename('node-2', 'Build box')
    expect((await acorn.fleetList()).nodes.at(-1)?.label).toBe('Build box')
    await expect(acorn.nodeAdopt()).rejects.toThrow('Nodes screen')
  })
})

describe('the transport', () => {
  it('sends each request over the channel of the Node it names, with that Node’s pinned key', async () => {
    const one = await acorn.nodeFetch('node-1', { requestId: 'r1', path: '/v1/core/tasks?archived=1' })
    const two = await acorn.nodeFetch('node-2', { requestId: 'r2', path: '/v1/core/tasks' })
    expect(JSON.parse(new TextDecoder().decode(one.body))).toEqual({ node: 'node-1' })
    expect(JSON.parse(new TextDecoder().decode(two.body))).toEqual({ node: 'node-2' })
    expect(opened.map((channel) => [channel.nodeId, channel.channelKey])).toEqual([
      ['node-1', 'aa'.repeat(32)],
      ['node-2', 'bb'.repeat(32)],
    ])
    expect(opened[0]!.client.sent[0]).toMatchObject({ method: 'GET', path: '/v1/core/tasks?archived=1' })
    expect(one.status).toBe(200)
    expect(one.headers['content-type']).toBe('application/json')
  })

  it('sends a form as the bytes a browser would, with the type that names its boundary', async () => {
    await acorn.nodeFetch('node-1', {
      requestId: 'form',
      path: '/v1/core/attachments',
      method: 'POST',
      body: { kind: 'form', parts: [{ name: 'note', value: 'hello' }] },
    })
    const sent = opened[0]!.client.sent[0] as { headers: Record<string, string>; body: Uint8Array }
    expect(sent.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/)
    expect(new TextDecoder().decode(sent.body)).toContain('hello')
  })

  it('aborts a request by its ID', async () => {
    const pending = acorn.nodeFetch('node-1', { requestId: 'slow', path: '/v1/slow' })
    await settle()
    acorn.nodeAbort('slow')
    await expect(pending).rejects.toThrow('aborted')
  })

  it('fails a request that outlasts its deadline as a timeout', async () => {
    const pending = acorn.nodeFetch('node-1', { requestId: 'late', path: '/v1/slow', timeoutMs: 2000 })
    const failure = pending.catch((error: Error) => error)
    await vi.advanceTimersByTimeAsync(2000)
    expect(await failure).toMatchObject({ name: 'TimeoutError', message: expect.stringContaining('2000ms') })
  })

  it('opens the event feed only for the Node on screen, and hears its frames and status', async () => {
    const heard: unknown[] = []
    const statuses: NodeStatus[] = []
    acorn.onNodeFrame((nodeId, frame) => heard.push([nodeId, frame]))
    acorn.onNodeStatus((status) => statuses.push(status))
    acorn.nodeInterest('node-1')
    await settle()
    expect(opened.map((channel) => channel.nodeId)).toEqual(['node-1'])
    expect(statuses.at(-1)).toMatchObject({ nodeId: 'node-1', state: 'online' })
    opened[0]!.listeners.onFrame('{"channel":"term:status","seq":1}')
    expect(heard).toEqual([['node-1', { channel: 'term:status', seq: 1 }]])

    acorn.nodeSend('node-1', { channel: 'term:attach', id: 't1' })
    expect(opened[0]!.client.sent.at(-1)).toEqual({ channel: 'term:attach', id: 't1' })
  })

  it('opens the feed of a Node named on screen before the paired list was read', async () => {
    acorn.nodeInterest('node-3')
    await settle()
    expect(opened).toEqual([])
    stored.nodes.set('node-3', { nodeId: 'node-3', label: 'Laptop', channelKey: 'cc'.repeat(32), pairedAt: 3 })
    await acorn.fleetList()
    await settle()
    expect(opened.map((channel) => channel.nodeId)).toEqual(['node-3'])
  })

  it('replays the latest status of each Node to someone who starts listening late', async () => {
    acorn.nodeInterest('node-2')
    await settle()
    const late: NodeStatus[] = []
    acorn.onNodeStatus((status) => late.push(status))
    expect(late).toEqual([expect.objectContaining({ nodeId: 'node-2', state: 'online' })])
  })

  it('replaces the channel of the Node on screen when the page comes back to the foreground', async () => {
    acorn.nodeInterest('node-1')
    await settle()
    ;(document as unknown as EventTarget).dispatchEvent(new Event('visibilitychange'))
    await settle()
    expect(opened.filter((channel) => channel.nodeId === 'node-1')).toHaveLength(2)
  })
})

describe('the account', () => {
  it('shows the sign-in screen once a link learns the account session ended', async () => {
    const { AccountError } = await import('./accountError')
    expect(signedOut()).toBe(false)
    stored.openFails.push(new AccountError(401, 'invalid_token'))
    acorn.nodeInterest('node-1')
    await settle()
    expect(signedOut()).toBe(true)
  })
})
