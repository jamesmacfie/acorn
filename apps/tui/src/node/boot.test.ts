import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { QueryClient } from '@tanstack/solid-query'
import { persistQueryClient, persistQueryClientRestore } from '@tanstack/query-persist-client-core'
import { lockedBy } from '@acorn/node-core/server/storage/dataRoot.ts'
import { LOCAL_TOKEN_SCOPE } from '@acorn/custody/custody/deviceTokenStore.ts'
import { cacheKeyFor, clientFor, setCacheStorage } from '@acorn/client-core/infra/node/fleet.ts'
import { PERSISTED_QUERY_MAX_AGE_MS, shouldPersistQuery } from '@acorn/client-core/infra/persistence/queryPersistence.ts'
import { tasksKey, type Task } from '@acorn/protocol/api.ts'
import { custody, openNode, type OpenedNode } from './open'
import { fileCacheStorage } from './cache'
import { installPlatform, type Platform } from '../platform'

// The boot test (docs/testing.md § Test layers): does `acorn`'s world come up.
//
// It runs the real thing — a real standalone node against a fresh data root, the real fleet store and
// device-token files in a fresh config directory, the real broker over pinned TLS — and then asks the
// first questions the renderer asks: is there a node, can a `/v2` request reach it, and did the event
// socket authenticate. It draws nothing, so unlike the rest of this package's suite it needs no FFI
// and never skips.
//
// The desktop's twin is apps/desktop/test/boot.test.ts, and the shapes differ for the reason
// 03-process-model.md gives: the desktop has a helper process to talk to over a wire, and this is one
// process, so the test calls the functions directly.

const BUDGET_MS = 180_000

let root: string
let opened: OpenedNode
let platform: Platform

const dataDir = (): string => join(root, 'node')

const waitFor = async (condition: () => boolean, what: string, ms = 15_000): Promise<void> => {
  const deadline = Date.now() + ms
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise((done) => setTimeout(done, 50))
  }
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'acorn-tui-boot-'))
  // Both roots are the test's, so a run never reads or writes the data root or the config directory of
  // whoever is running it. `ACORN_PORT` is cleared because an explicit port is a demand the node never
  // falls back from, and a developer with one exported would collide with their own node.
  process.env.ACORN_DATA_DIR = dataDir()
  process.env.ACORN_TUI_CONFIG_DIR = join(root, 'config')
  process.env.ACORN_PORT = ''

  opened = await openNode(undefined)
  platform = installPlatform(opened, () => {})
}, BUDGET_MS)

afterAll(async () => {
  await platform?.dispose()
  rmSync(root, { recursive: true, force: true })
}, 60_000)

describe('acorn against a node it started', () => {
  it('starts one when nothing holds the data root, and owns its lifetime', () => {
    expect(opened.supervised).toBe(true)
    expect(lockedBy(dataDir())).toBeGreaterThan(0)
  })

  it('remembers the node and its token, at 0600', () => {
    const local = opened.fleet.list().filter((node) => node.local)
    // Exactly one, and it is the node this data root defines.
    expect(local).toHaveLength(1)
    expect(local[0].nodeId).toBe(opened.nodeId)
    expect(opened.fleet.tokenFor(opened.nodeId)).toMatch(/^acorn_dt_/)
    const mode = statSync(join(root, 'config', `device-token-${LOCAL_TOKEN_SCOPE}`)).mode & 0o777
    expect(mode).toBe(0o600)
  })

  it('carries a /v2 request through the broker to the node', async () => {
    const response = await platform.broker.fetch(opened.nodeId, { requestId: 'boot-test', path: '/v2/node', method: 'GET', headers: {} })
    // 200 means the pinned TLS connection came up and the device token authenticated, which is the
    // whole custody stack end to end.
    expect(response.status).toBe(200)
    expect(JSON.parse(new TextDecoder().decode(response.body))).toMatchObject({ nodeId: opened.nodeId })
  })

  it('brings the event socket up with the bearer on the upgrade', async () => {
    // `online` is set when the WebSocket opens, and the upgrade carries the bearer in a header, so
    // reaching it is the one assertion that covers the half of the transport HTTP does not.
    await waitFor(() => platform.broker.statuses().some((status) => status.nodeId === opened.nodeId && status.state === 'online'), 'the socket to open')
  })

  it('never exposes the token in what the renderer can read', async () => {
    const fleet = await (globalThis as { window: { acorn: { fleetList(): Promise<{ nodes: unknown[] }> } } }).window.acorn.fleetList()
    expect(JSON.stringify(fleet)).not.toContain(opened.fleet.tokenFor(opened.nodeId))
  })

  it('attaches rather than starting a second node', async () => {
    const holder = lockedBy(dataDir())
    const second = await openNode(undefined)
    expect(second.nodeId).toBe(opened.nodeId)
    // The whole difference: this one did not start it, so quitting it leaves the node running.
    expect(second.supervised).toBe(false)
    expect(lockedBy(dataDir())).toBe(holder)
    await second.stop()
    expect(lockedBy(dataDir())).toBe(holder)
  }, 30_000)

  it('reports a token the node refuses as revoked, and stops retrying', async () => {
    // A second device with its own config directory and a token that was never issued. The node's
    // answer at the upgrade is a 401, which is the state the footer reads.
    const stranger = custody(join(root, 'stranger'))
    stranger.tokens.write(LOCAL_TOKEN_SCOPE, 'acorn_dt_00000000-0000-4000-8000-000000000000_notatoken')
    const attached = await openNode(undefined, stranger)
    const strangerPlatform = installPlatform(attached, () => {})
    try {
      await waitFor(() => strangerPlatform.broker.statuses().some((status) => status.state === 'revoked'), 'the revoked transition')
      expect(strangerPlatform.broker.statuses().at(-1)).toMatchObject({ state: 'revoked', error: { code: 'unauthorized' } })
    } finally {
      strangerPlatform.broker.dispose()
    }
  }, 30_000)

  // The caching contract, end to end against a real node id (docs/caching.md § Renderer query cache).
  // Before this the TUI installed the file store and never drove a persister, so the directory was
  // empty on every run and every start was cold.
  it('writes one cache file named by the partition key, and reads the rows back out of it', async () => {
    const cacheDir = join(root, 'config', 'cache')
    setCacheStorage(fileCacheStorage(cacheDir))
    const { client, persister } = clientFor(opened.nodeId)
    const [, restored] = persistQueryClient({
      queryClient: client,
      persister,
      maxAge: PERSISTED_QUERY_MAX_AGE_MS,
      dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery },
    })
    await restored

    const rows: Task[] = [{
      id: 'task-persisted', title: 'from the cache', projectId: 'project-1', branch: 'from-the-cache',
      origin: 'local', icon: null, status: 'active', links: [], parentId: null, sort: 0,
      github: null, worktreePath: null, pullNumber: null,
    }]
    client.setQueryData(tasksKey, rows)
    // Waited on by content rather than by existence. The persister writes on every cache event and
    // throttles to one write every five seconds, so the first file on disk may be the empty snapshot
    // it took while restoring.
    const written = join(cacheDir, `${encodeURIComponent(cacheKeyFor(opened.nodeId))}.json`)
    await waitFor(() => existsSync(written) && readFileSync(written, 'utf8').includes('task-persisted'), 'the rows to be persisted')

    // One file, named by the partition key with the colon encoded. Node A's snapshot must never be
    // able to rehydrate into node B, and the name is what makes that structural.
    expect(readdirSync(cacheDir)).toEqual([`${encodeURIComponent(cacheKeyFor(opened.nodeId))}.json`])

    // …and a fresh client restores from that file with no node involved, which is what the next
    // `acorn` does before it has heard from one. Not the same client: this asserts the file, not the
    // memory it was dehydrated from.
    const cold = new QueryClient()
    await persistQueryClientRestore({ queryClient: cold, persister, maxAge: PERSISTED_QUERY_MAX_AGE_MS })
    expect(cold.getQueryData(tasksKey)).toEqual(rows)
  }, 30_000)

  it('drains the node it started and releases the lock', async () => {
    await platform.dispose()
    expect(lockedBy(dataDir())).toBeNull()
  }, 60_000)
})

// The start path, once the root has been opened before (docs/tui.md § Attach or start). The first-ever
// start has no id on disk and nothing cached, so it waits for the handshake; every start after that
// returns as soon as the child is spawned, which is what lets the renderer draw in front of a booting
// node.
describe('acorn starting a node it has started before', () => {
  it('returns the node id from the data root without waiting for the handshake', async () => {
    // The root above has been opened and drained, so `node.json` names its node and nothing holds it.
    expect(lockedBy(dataDir())).toBeNull()
    const second = await openNode(undefined)
    try {
      expect(second.supervised).toBe(true)
      expect(second.nodeId).toBe(opened.nodeId)
      // The distinguishing fact: the boot line is still in flight. `openNode` resolved before the
      // child had bound a port, let alone printed anything.
      expect(second.starting).toBeDefined()
      expect(second.held).toBeDefined()
      expect(lockedBy(dataDir())).toBeNull()

      // …and it does land, with the same id, which is what rewrites the fleet row's endpoint.
      const handshake = await second.starting!
      expect(handshake.nodeId).toBe(opened.nodeId)
      expect(second.fleet.get(opened.nodeId)?.endpoint).toBe(handshake.endpoint)
    } finally {
      await second.stop()
    }
  }, BUDGET_MS)
})
