import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ONEPASSWORD_PREF_KEY } from '@acorn/protocol/api.ts'
import { makeTestDb, type TestDb } from '../../testkit/db'
import { schema } from '../db'

// The spawn is the boundary. Everything above it is the code under test, and a real `op` would ask a
// real person to press a fingerprint reader.
const { runs, result } = vi.hoisted(() => ({
  runs: [] as { file: string; args: readonly string[] }[],
  result: { value: {} as Record<string, unknown> },
}))
vi.mock('./proc', () => ({
  runProcess: async (spec: { file: string; args?: readonly string[] }) => {
    runs.push({ file: spec.file, args: spec.args ?? [] })
    return { code: 0, signal: null, stdout: 'resolved-token\n', stderr: '', timedOut: false, aborted: false, truncated: false, spawnError: null, ...result.value }
  },
}))

const { createOnePasswordResolver, forgetResolved, isSecretRef, OnePasswordError, probe } = await import('./onePassword')
const { parseOnePasswordPref } = await import('@acorn/protocol/api.ts')

const USER = 'owner-1'
const REF = 'op://Private/Linear/credential'

let db: TestDb
const resolverFor = (settings: unknown) => {
  if (settings !== null) {
    db.db.insert(schema.prefs).values({ userId: USER, key: ONEPASSWORD_PREF_KEY, value: JSON.stringify(settings) }).run()
  }
  return createOnePasswordResolver(db.db as never, () => USER)
}

beforeEach(() => {
  db = makeTestDb()
  runs.length = 0
  result.value = {}
  forgetResolved()
})

describe('reference detection', () => {
  it('tells a reference from a token', () => {
    expect(isSecretRef(REF)).toBe(true)
    expect(isSecretRef('lin_api_abcdef')).toBe(false)
  })
})

describe('settings', () => {
  it('is off, and remembers until restart, until someone says otherwise', () => {
    expect(parseOnePasswordPref(null)).toEqual({ enabled: false, ttlMs: null })
    // A half-written or corrupt value must not read as "on". Failing open here would shell out to a
    // binary nobody asked us to run.
    expect(parseOnePasswordPref('{{{')).toEqual({ enabled: false, ttlMs: null })
    expect(parseOnePasswordPref('{"enabled":true,"ttlMs":900000}')).toEqual({ enabled: true, ttlMs: 900_000 })
  })
})

describe('resolving', () => {
  it('refuses without spawning when the switch is off', async () => {
    const resolve = resolverFor({ enabled: false, ttlMs: null })
    await expect(resolve(REF)).rejects.toThrow(OnePasswordError)
    expect(runs).toHaveLength(0)
  })

  it('runs op read and returns the trimmed value', async () => {
    const resolve = resolverFor({ enabled: true, ttlMs: null })
    await expect(resolve(REF)).resolves.toBe('resolved-token')
    expect(runs[0]).toEqual({ file: 'op', args: ['read', '--no-newline', '--', REF] })
  })

  it('asks op once for concurrent reads of the same reference', async () => {
    const resolve = resolverFor({ enabled: true, ttlMs: null })
    const [a, b] = await Promise.all([resolve(REF), resolve(REF)])
    expect([a, b]).toEqual(['resolved-token', 'resolved-token'])
    // The whole point of the queue: two unlock prompts for one credential is the failure people
    // actually notice.
    expect(runs).toHaveLength(1)
  })

  it('asks again after the cache is cleared', async () => {
    const resolve = resolverFor({ enabled: true, ttlMs: null })
    await resolve(REF)
    forgetResolved()
    await resolve(REF)
    expect(runs).toHaveLength(2)
  })

  it('rejects a malformed reference before spawning', async () => {
    const resolve = resolverFor({ enabled: true, ttlMs: null })
    for (const bad of ['op://Private', 'op://Private/Item/field\nrm -rf /', 'op://Private/It"em/field', 'not-a-ref']) {
      await expect(resolve(bad)).rejects.toThrow(OnePasswordError)
    }
    expect(runs).toHaveLength(0)
  })

  it('reports a missing binary apart from a failed read', async () => {
    const resolve = resolverFor({ enabled: true, ttlMs: null })
    result.value = { spawnError: 'spawn op ENOENT' }
    await expect(resolve(REF)).rejects.toMatchObject({ reason: 'not-installed' })
    forgetResolved()
    result.value = { code: 1, stdout: '', stderr: 'could not read item "Linear" in vault "Private"' }
    await expect(resolve(REF)).rejects.toMatchObject({ reason: 'unreadable' })
  })

  it('keeps op stderr out of the error it throws', async () => {
    const resolve = resolverFor({ enabled: true, ttlMs: null })
    result.value = { code: 1, stdout: '', stderr: 'could not read item "Linear" in vault "Private"' }
    const failure = await resolve(REF).then(() => null, (error: Error) => error)
    // The stderr names a vault and an item. It belongs in this node's log, not in a message that
    // travels to a client (docs/security.md § Credential handling).
    expect(failure?.message).not.toContain('Private')
    expect(failure?.message).not.toContain('Linear')
  })

  it('keeps working after a failure rather than wedging the queue', async () => {
    const resolve = resolverFor({ enabled: true, ttlMs: null })
    result.value = { code: 1, stdout: '', stderr: 'nope' }
    await expect(resolve(REF)).rejects.toThrow(OnePasswordError)
    result.value = {}
    await expect(resolve(REF)).resolves.toBe('resolved-token')
  })
})

describe('probe', () => {
  it('reports the version when op runs, and nothing when it does not', async () => {
    result.value = { stdout: '2.30.0\n' }
    await expect(probe()).resolves.toEqual({ available: true, version: '2.30.0' })
    result.value = { spawnError: 'spawn op ENOENT' }
    await expect(probe()).resolves.toEqual({ available: false })
  })
})
