import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PluginCustody } from '@acorn/client-core/infra/platform'
import type { BundledAck } from '@acorn/custody/rules'

// The phone's custody, with the custody rules real and IndexedDB a map: what the person is promised
// holds across a reload, and a bundle that isn't what the Node advertised never reaches it.
const db = vi.hoisted(() => ({
  rows: new Map<string, unknown>(),
  failOn: null as string | null,
  source: null as ((hash: string) => Promise<ArrayBuffer>) | null,
}))
vi.mock('idb-keyval', () => ({
  createStore: () => 'store',
  get: async (key: string) => db.rows.get(key),
  getMany: async (keys: string[]) => keys.map((key) => db.rows.get(key)),
  keys: async () => [...db.rows.keys()],
  set: async (key: string, value: unknown) => {
    if (key === db.failOn) throw new Error('quota exceeded')
    db.rows.set(key, value)
  },
  del: async (key: string) => void db.rows.delete(key),
}))
vi.mock('@acorn/client-core/host/tree', () => ({
  setTreeBundleSource: (source: typeof db.source) => void (db.source = source),
}))
vi.mock('@acorn/client-core/infra/telemetry', () => ({
  createLogger: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}))

import { openPluginCustody } from './pluginCustody'

const bundle = new TextEncoder().encode('export default { entry: "runn" }')
const hash = createHash('sha256').update(bundle).digest('hex')
const put = { nodeId: 'node-1', pluginId: 'runn', hash, version: '1.0.0' }

let served: Uint8Array
const fetcher = {
  fetch: vi.fn(async () => ({ status: 200, headers: {}, body: served as Uint8Array<ArrayBuffer> })),
}
const open = async (firstParty: readonly BundledAck[] = []): Promise<PluginCustody> =>
  (await openPluginCustody(fetcher, firstParty)).custody

type PluginTrustDecision = Parameters<PluginCustody['trustRecord']>[0]

const decision = (answer: 'accepted' | 'rejected'): PluginTrustDecision => ({
  pluginId: 'runn',
  hash,
  nodeId: 'node-1',
  version: '1.0.0',
  declaration: 'runn@1.0.0',
  permissions: {
    api: [],
    events: [],
    node: { core: [], capabilities: [], secrets: false, exec: false, net: [], sockets: false },
  },
  webviews: [],
  keyClaims: [],
  navigationDestinations: [],
  extensions: [],
  schedules: [],
  taskChecks: [],
  harnesses: [],
  agentTools: [],
  contextSections: [],
  customAgents: [],
  decision: answer,
})

beforeEach(() => {
  db.rows.clear()
  db.failOn = null
  db.source = null
  served = bundle
  fetcher.fetch.mockClear()
})

describe('a bundle from the Node', () => {
  it('is fetched by its hash route, kept under the hash of what arrived, and handed to the sandbox', async () => {
    const custody = await open()
    expect(await custody.cachePut(put)).toEqual({ hash })
    expect(fetcher.fetch).toHaveBeenCalledWith(
      'node-1',
      expect.objectContaining({ path: `/v1/core/plugins/runn/bundles/${hash}` }),
      expect.anything(),
    )
    expect((await custody.state()).cached[hash]).toMatchObject({
      pluginId: 'runn',
      version: '1.0.0',
      nodeIds: ['node-1'],
    })
    expect(new Uint8Array(await db.source!(hash))).toEqual(bundle)
  })

  it('is refused when its bytes aren’t the ones the Node advertised, and nothing is kept', async () => {
    served = new TextEncoder().encode('export default { evil: true }')
    const custody = await open()
    expect(await custody.cachePut(put)).toEqual({ error: 'hash-mismatch' })
    expect((await custody.state()).cached).toEqual({})
    expect([...db.rows.keys()].filter((key) => key.startsWith('bundle:'))).toEqual([])
    await expect(db.source!(hash)).rejects.toThrow('holds no bundle')
  })
})

describe('a first-party bundle this release carries', () => {
  const { decision: _, ...disclosure } = decision('accepted')
  const carried: BundledAck = { ...disclosure, nodeId: 'bundled:acorn-test', decision: 'accepted' }

  it('is accepted with the disclosure the build recorded, with no prompt, and stays accepted after a reload', async () => {
    const custody = await open([carried])
    expect(await custody.cachePut(put)).toEqual({ hash })
    const acks = [
      expect.objectContaining({ pluginId: 'runn', hash, decision: 'accepted', nodeId: 'bundled:acorn-test' }),
    ]
    expect((await custody.state()).acks).toEqual(acks)
    expect((await (await open()).state()).acks).toEqual(acks)
  })

  it('is not accepted under another plugin’s name', async () => {
    const custody = await open([carried])
    await custody.cachePut({ ...put, pluginId: 'other' })
    expect((await custody.state()).acks).toEqual([])
  })

  it('leaves a release the phone doesn’t carry to the prompt', async () => {
    const custody = await open([{ ...carried, hash: 'a'.repeat(64) }])
    await custody.cachePut(put)
    expect((await custody.state()).acks).toEqual([])
  })
})

describe('what the person decided', () => {
  it('holds after a reload: an acceptance stays accepted and a denial stays denied', async () => {
    const first = await open()
    await first.cachePut(put)
    await first.trustRecord(decision('accepted'))
    const reloaded = await open()
    expect((await reloaded.state()).acks).toEqual([
      expect.objectContaining({ pluginId: 'runn', hash, decision: 'accepted' }),
    ])

    await reloaded.trustRecord(decision('rejected'))
    expect((await (await open()).state()).acks).toEqual([expect.objectContaining({ hash, decision: 'rejected' })])
  })

  it('is asked about again when the browser cleared its storage', async () => {
    const first = await open()
    await first.cachePut(put)
    await first.trustRecord(decision('accepted'))
    db.rows.clear()
    expect(await (await open()).state()).toEqual({ cached: {}, acks: [], devGrants: [] })
  })

  it('is reported as failed when it couldn’t be kept, so the prompt shows the error', async () => {
    const custody = await open()
    await custody.cachePut(put)
    db.failOn = 'trust'
    await expect(custody.trustRecord(decision('accepted'))).rejects.toThrow('quota exceeded')
  })
})

describe('what a phone can’t do', () => {
  it('installs and removes no plugin, and says where to', async () => {
    const custody = await open()
    await expect(custody.install({ source: { path: '/tmp/runn' } })).rejects.toThrow('Install plugins from the desktop')
    await expect(custody.remove({ pluginId: 'runn' })).rejects.toThrow('Install plugins from the desktop')
  })
})

describe('housekeeping', () => {
  it('drops bundles no index row names when it opens', async () => {
    db.rows.set(`bundle:${'f'.repeat(64)}`, new ArrayBuffer(4))
    const custody = await open()
    await custody.state()
    await vi.waitFor(() => expect([...db.rows.keys()]).toEqual([]))
  })

  it('forgets a Node as the source of what it offered', async () => {
    const opened = await openPluginCustody(fetcher)
    await opened.custody.cachePut(put)
    await opened.forgetNode('node-1')
    expect((await opened.custody.state()).cached[hash]).toMatchObject({ nodeIds: [] })
  })
})
