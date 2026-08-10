import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Fake safeStorage, same shape as sessionKeyStore.test.ts: a reversible tag wrap so a written token
// round-trips, with availability switchable to exercise the keychain-less path.
const fake = { available: true }
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => fake.available,
    encryptString: (s: string) => Buffer.from(`enc:${s}`),
    decryptString: (b: Buffer) => {
      const s = b.toString()
      if (!s.startsWith('enc:')) throw new Error('bad ciphertext')
      return s.slice(4)
    },
  },
}))

const { FleetStore, toNodeRecord } = await import('./fleetStore')

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'acorn-fleet-'))
  fake.available = true
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const remote = {
  nodeId: 'node-remote',
  label: 'Studio',
  endpoint: 'https://192.168.1.9:7443',
  fingerprint: 'ab'.repeat(32),
  certPem: '-----BEGIN CERTIFICATE-----\nx\n-----END CERTIFICATE-----\n',
  deviceId: 'device-1',
  local: false,
} as const

describe('FleetStore', () => {
  it('persists membership and the token across instances', () => {
    new FleetStore(dir).remember({ ...remote }, 'tok-remote')

    const reloaded = new FleetStore(dir)
    expect(reloaded.list()).toEqual([remote])
    expect(reloaded.tokenFor('node-remote')).toBe('tok-remote')
  })

  it('keeps the token out of fleet.json and both files owner-only', () => {
    new FleetStore(dir).remember({ ...remote }, 'tok-remote')
    const raw = readFileSync(join(dir, 'fleet.json'), 'utf8')

    expect(raw).not.toContain('tok-remote')
    expect(statSync(join(dir, 'fleet.json')).mode & 0o777).toBe(0o600)
    expect(statSync(join(dir, 'device-token-node-remote')).mode & 0o777).toBe(0o600)
  })

  it('scopes the local node\'s token by the data dir, not its nodeId', () => {
    // The local token has to be readable BEFORE the service starts, and starting it is the only thing
    // that can report the nodeId (deviceTokenStore.ts).
    new FleetStore(dir).remember({ nodeId: 'node-local', label: 'This computer', endpoint: 'https://127.0.0.1:1', local: true }, 'tok-local')

    expect(existsSync(join(dir, 'device-token-local'))).toBe(true)
    expect(existsSync(join(dir, 'device-token-node-local'))).toBe(false)
    expect(new FleetStore(dir).tokenFor('node-local')).toBe('tok-local')
  })

  it('replaces a node rather than duplicating it, so a re-pair cannot leave a stale endpoint', () => {
    const fleet = new FleetStore(dir)
    fleet.remember({ ...remote }, 'tok-1')
    fleet.remember({ ...remote, endpoint: 'https://192.168.1.10:7443' }, 'tok-2')

    expect(fleet.list()).toHaveLength(1)
    expect(fleet.get('node-remote')?.endpoint).toBe('https://192.168.1.10:7443')
    expect(fleet.tokenFor('node-remote')).toBe('tok-2')
  })

  it('keeps the local node a singleton when the data root comes back under a new identity', () => {
    // The local node is one node whose nodeId can change: replace the data root and the same machine
    // reports a new one. A leftover `local: true` row is never connected — the boot loop skips local rows
    // and `adoptLocalNode` only upserts the id it just started — so `homeNode()`, which takes the FIRST
    // local row, would point the whole window at an address the broker answers `Unknown node` for.
    const fleet = new FleetStore(dir)
    fleet.remember({ ...remote }, 'tok-remote')
    fleet.remember({ nodeId: 'node-was', label: 'This computer', endpoint: 'https://127.0.0.1:1', local: true }, 'tok-old')
    fleet.remember({ nodeId: 'node-now', label: 'This computer', endpoint: 'https://127.0.0.1:2', local: true }, 'tok-new')

    expect(fleet.list().filter((node) => node.local).map((node) => node.nodeId)).toEqual(['node-now'])
    expect(fleet.get('node-was')).toBeUndefined()
    // Pairings are untouched, and the shared local token scope now holds the live node's credential.
    expect(fleet.get('node-remote')?.endpoint).toBe(remote.endpoint)
    expect(fleet.tokenFor('node-now')).toBe('tok-new')
    expect(new FleetStore(dir).list().filter((node) => node.local)).toHaveLength(1)
  })

  it('does not let a pairing displace the local node', () => {
    // The singleton rule is one-directional: remembering a remote node must leave the local row alone.
    const fleet = new FleetStore(dir)
    fleet.remember({ nodeId: 'node-local', label: 'This computer', endpoint: 'https://127.0.0.1:1', local: true }, 'tok-local')
    fleet.remember({ ...remote }, 'tok-remote')

    expect(fleet.list().map((node) => node.nodeId)).toEqual(['node-local', 'node-remote'])
  })

  it('renames without touching the token', () => {
    const fleet = new FleetStore(dir)
    fleet.remember({ ...remote }, 'tok-remote')

    expect(fleet.rename('node-remote', 'Loft')?.label).toBe('Loft')
    expect(new FleetStore(dir).get('node-remote')?.label).toBe('Loft')
    expect(fleet.tokenFor('node-remote')).toBe('tok-remote')
    expect(fleet.rename('nope', 'x')).toBeUndefined()
  })

  it('forgets the row and the credential together', () => {
    const fleet = new FleetStore(dir)
    fleet.remember({ ...remote }, 'tok-remote')
    fleet.forget('node-remote')

    expect(fleet.list()).toEqual([])
    expect(existsSync(join(dir, 'device-token-node-remote'))).toBe(false)
    // An orphaned credential would outlive the membership it belonged to.
    expect(new FleetStore(dir).tokenFor('node-remote')).toBeUndefined()
  })

  it('keeps the node listed when there is no keychain to remember its token', () => {
    // deviceTokenStore's "no keychain ⇒ simply do not remember": the fleet still knows the node, so the
    // owner can see it and re-pair, rather than the row vanishing with the token.
    fake.available = false
    const fleet = new FleetStore(dir)
    fleet.remember({ ...remote }, 'tok-remote')

    expect(fleet.list()).toEqual([remote])
    expect(fleet.tokenFor('node-remote')).toBeUndefined()
  })

  it('starts from an empty fleet rather than guessing at an unparseable file', () => {
    writeFileSync(join(dir, 'fleet.json'), '{"version":1,"nodes":[{"nodeId":"x"}]}')
    expect(new FleetStore(dir).list()).toEqual([])
  })

  it('never projects the certificate or the device id to the renderer', () => {
    expect(toNodeRecord({ ...remote })).toEqual({
      nodeId: 'node-remote',
      label: 'Studio',
      endpoint: 'https://192.168.1.9:7443',
      fingerprint: 'ab'.repeat(32),
      local: false,
    })
  })
})
