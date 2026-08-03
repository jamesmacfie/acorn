import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeTestDb, type TestDb } from '../routes/testDb'
import { idempotencyStore, requestHash, type IdempotencyStore } from './idempotency'

let harness: TestDb
let store: IdempotencyStore
let clock: number
const DEVICE = 'device-a'
const DAY_MS = 24 * 60 * 60_000

beforeEach(() => {
  harness = makeTestDb()
  clock = 1_700_000_000_000
  store = idempotencyStore(harness.db, () => clock)
})

afterEach(() => {
  harness.cleanup()
})

describe('requestHash', () => {
  it('is stable and separates method, path and body', () => {
    expect(requestHash('POST', '/v2/core/tasks', '{"a":1}')).toBe(requestHash('POST', '/v2/core/tasks', '{"a":1}'))
    expect(requestHash('POST', '/v2/core/tasks', '{"a":1}')).not.toBe(requestHash('PUT', '/v2/core/tasks', '{"a":1}'))
    expect(requestHash('POST', '/v2/core/tasks', '{"a":1}')).not.toBe(requestHash('POST', '/v2/core/other', '{"a":1}'))
    expect(requestHash('POST', '/v2/core/tasks', '{"a":1}')).not.toBe(requestHash('POST', '/v2/core/tasks', '{"a":2}'))
  })

  // The separator matters: without it, ('POST', '/a', 'b') and ('POST', '/ab', '') would collide.
  it('cannot be confused by field-boundary shifting', () => {
    expect(requestHash('POST', '/a', 'b')).not.toBe(requestHash('POST', '/ab', ''))
  })
})

describe('idempotency store', () => {
  it('round-trips a stored response', async () => {
    const hash = requestHash('POST', '/v2/core/tasks', '{}')
    await store.save(DEVICE, 'key-1', hash, 201, '{"id":"t1"}')
    expect(await store.lookup(DEVICE, 'key-1')).toEqual({ requestHash: hash, responseStatus: 201, responseBody: '{"id":"t1"}' })
  })

  it('misses on an unknown key and scopes by device', async () => {
    await store.save(DEVICE, 'key-1', 'h', 200, '{}')
    expect(await store.lookup(DEVICE, 'key-2')).toBeNull()
    // Two devices retrying with the same key must not read each other's responses.
    expect(await store.lookup('device-b', 'key-1')).toBeNull()
  })

  it('reads an expired row as absent', async () => {
    await store.save(DEVICE, 'key-1', 'h', 200, '{}')
    clock += DAY_MS - 1
    expect(await store.lookup(DEVICE, 'key-1')).not.toBeNull()
    clock += 1 // exactly at expiry
    expect(await store.lookup(DEVICE, 'key-1')).toBeNull()
  })

  // A concurrent duplicate may have stored first; its response is the one already returned to the
  // other caller, so keeping it is what makes the replay consistent.
  it('keeps the first stored response when a duplicate races it', async () => {
    await store.save(DEVICE, 'key-1', 'h', 201, 'first')
    await store.save(DEVICE, 'key-1', 'h', 500, 'second')
    expect((await store.lookup(DEVICE, 'key-1'))?.responseBody).toBe('first')
  })

  it('sweeps only expired rows', async () => {
    await store.save(DEVICE, 'old', 'h', 200, '{}')
    clock += DAY_MS
    await store.save(DEVICE, 'new', 'h', 200, '{}')
    await store.cleanupExpired()
    expect(await store.lookup(DEVICE, 'old')).toBeNull()
    expect(await store.lookup(DEVICE, 'new')).not.toBeNull()
  })
})
