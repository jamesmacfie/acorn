import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { lockedBy } from '@acorn/node-core/server/storage/dataRoot.ts'
import { LOCAL_TOKEN_SCOPE } from '@acorn/custody/custody/deviceTokenStore.ts'
import { custody, openNode, type OpenedNode } from './open'
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

  it('drains the node it started and releases the lock', async () => {
    await platform.dispose()
    expect(lockedBy(dataDir())).toBeNull()
  }, 60_000)
})
