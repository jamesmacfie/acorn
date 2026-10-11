import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SEALED_NODE_KEYS_FILE } from '@acorn/protocol/serviceProtocol.ts'
import { checkSessionKey, ensureSessionKey } from './sessionKey'
import { SecretService } from './core/secrets'
import { makeTestDb } from '../testkit/db'
import { seedProviderConnection } from '../testkit/integration'

const roots: string[] = []
const root = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'acorn-key-'))
  roots.push(dir)
  return dir
}
const originalEnv = process.env.SESSION_ENC_KEY
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
  if (originalEnv === undefined) delete process.env.SESSION_ENC_KEY
  else process.env.SESSION_ENC_KEY = originalEnv
})

describe('the secret-encryption key', () => {
  it('mints one into the data root and returns the same one every boot after', () => {
    delete process.env.SESSION_ENC_KEY
    const dir = root()
    const first = ensureSessionKey(dir)
    expect(first).toMatch(/^[0-9a-f]{64}$/)
    // Stability is the whole contract: a second value would leave everything the first encrypted
    // unreadable, with nothing to say so.
    expect(ensureSessionKey(dir)).toBe(first)
    expect(readFileSync(join(dir, 'session.key'), 'utf8').trim()).toBe(first)
    expect(statSync(join(dir, 'session.key')).mode & 0o777).toBe(0o600)
  })

  it('lets the environment win, and does not write a file it will never read', () => {
    process.env.SESSION_ENC_KEY = 'a'.repeat(64)
    const dir = root()
    expect(ensureSessionKey(dir)).toBe('a'.repeat(64))
    expect(() => statSync(join(dir, 'session.key'))).toThrow()
  })

  it('refuses a damaged key file rather than minting a replacement', () => {
    delete process.env.SESSION_ENC_KEY
    const dir = root()
    writeFileSync(join(dir, 'session.key'), 'truncated')
    // Silently re-minting here turns a recoverable "this file is wrong" into an unrecoverable
    // "every stored credential is gone", so it has to be loud.
    expect(() => ensureSessionKey(dir)).toThrow(/64-hex/)
  })

  it('refuses to mint a key on a root the desktop has sealed', () => {
    delete process.env.SESSION_ENC_KEY
    const dir = root()
    writeFileSync(join(dir, SEALED_NODE_KEYS_FILE), 'sealed')
    expect(() => ensureSessionKey(dir)).toThrow(/sealed by the desktop app/)
    expect(() => statSync(join(dir, 'session.key'))).toThrow()
  })
})

describe('the session key check', () => {
  it('answers none with nothing stored, ok when one credential opens, and failed when none does', async () => {
    const test = makeTestDb()
    try {
      const key = 'b'.repeat(64)
      expect(await checkSessionKey(test.db, new SecretService(key))).toBe('none')
      await seedProviderConnection(test.db, 'github', 'owner', 'ghp_example', 'c'.repeat(64))
      expect(await checkSessionKey(test.db, new SecretService(key))).toBe('failed')
      await seedProviderConnection(test.db, 'linear', 'owner', 'lin_example', key)
      expect(await checkSessionKey(test.db, new SecretService(key))).toBe('ok')
    } finally {
      test.cleanup()
    }
  })
})
