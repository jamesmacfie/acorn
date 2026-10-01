import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FleetStore } from '@acorn/custody/broker'
import type { DeviceTokens } from '@acorn/custody/custody/deviceTokenStore.ts'
import { matchingNode, probeFailure } from './node'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
const fleet = () => {
  const dir = mkdtempSync(join(tmpdir(), 'acorn-cli-test-'))
  dirs.push(dir)
  const values = new Map<string, string>()
  const tokens: DeviceTokens = { read: (key) => values.get(key), write: (key, value) => { values.set(key, value) }, forget: (key) => { values.delete(key) } }
  return new FleetStore(dir, tokens)
}

describe('remembered Node selection', () => {
  it('selects a stable ID without falling through to another Node', () => {
    const store = fleet()
    store.remember({ nodeId: 'one', label: 'Build', endpoint: 'https://one.test', local: false }, 'secret-one')
    store.remember({ nodeId: 'two', label: 'Staging', endpoint: 'https://two.test', local: false }, 'secret-two')
    expect(matchingNode(store, 'two')?.nodeId).toBe('two')
    expect(matchingNode(store, 'missing')).toBeUndefined()
  })

  it('rejects a label shared by two Nodes with their IDs', () => {
    const store = fleet()
    store.remember({ nodeId: 'one', label: 'Build', endpoint: 'https://one.test', local: false }, 'secret-one')
    store.remember({ nodeId: 'two', label: 'Build', endpoint: 'https://two.test', local: false }, 'secret-two')
    expect(() => matchingNode(store, 'Build')).toThrow('one, two')
  })
})

describe('probe failures', () => {
  it('keeps transport, identity, and protocol failures distinct', () => {
    expect(probeFailure(new Error('connect ECONNREFUSED')).code).toBe('node_unreachable')
    expect(probeFailure(new Error('certificate presented does not match fingerprint')).code).toBe('identity_mismatch')
    expect(probeFailure(new Error('protocol version differs')).code).toBe('protocol_mismatch')
  })
})
