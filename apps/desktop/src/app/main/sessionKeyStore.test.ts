import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Fake safeStorage: encrypt = reversible tag wrap, so a written file round-trips; availability and
// decrypt behaviour are switchable per test. Mirrors the electron API surface resolveSessionKey uses.
const fake = {
  available: true,
  encryptString: (s: string) => Buffer.from(`enc:${s}`),
  decryptString: (b: Buffer) => {
    const s = b.toString()
    if (!s.startsWith('enc:')) throw new Error('bad ciphertext')
    return s.slice(4)
  },
}
vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => fake.available, encryptString: (s: string) => fake.encryptString(s), decryptString: (b: Buffer) => fake.decryptString(b) } }))

const { resolveSessionKey } = await import('./sessionKeyStore')

let dir: string
const ENV_KEY = 'a'.repeat(64)
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'acorn-key-'))
  fake.available = true
  delete process.env.SESSION_ENC_KEY
})
afterEach(() => {
  delete process.env.SESSION_ENC_KEY
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true })
})

describe('resolveSessionKey', () => {
  it('migrates the authoritative env key to safeStorage and reuses it without env', () => {
    process.env.SESSION_ENC_KEY = ENV_KEY
    resolveSessionKey(dir)
    expect(process.env.SESSION_ENC_KEY).toBe(ENV_KEY)
    expect(readFileSync(join(dir, 'session.key')).toString()).toBe(`enc:${ENV_KEY}`)

    delete process.env.SESSION_ENC_KEY
    resolveSessionKey(dir)
    expect(process.env.SESSION_ENC_KEY).toBe(ENV_KEY)
  })

  it('keeps an explicit env key usable when safeStorage is unavailable', () => {
    fake.available = false
    process.env.SESSION_ENC_KEY = ENV_KEY
    resolveSessionKey(dir)
    expect(process.env.SESSION_ENC_KEY).toBe(ENV_KEY)
    expect(existsSync(join(dir, 'session.key'))).toBe(false)
  })

  it('rejects a malformed env key before boot', () => {
    process.env.SESSION_ENC_KEY = 'preset'
    expect(() => resolveSessionKey(dir)).toThrow(/64 hex chars/)
  })

  it('mints a 64-hex key on first run and persists it encrypted', () => {
    resolveSessionKey(dir)
    const key = process.env.SESSION_ENC_KEY ?? ''
    expect(key).toMatch(/^[0-9a-f]{64}$/)
    expect(readFileSync(join(dir, 'session.key')).toString()).toBe(`enc:${key}`)
  })

  it('reuses the existing persisted key (stable identity)', () => {
    resolveSessionKey(dir)
    const first = process.env.SESSION_ENC_KEY
    delete process.env.SESSION_ENC_KEY
    resolveSessionKey(dir)
    expect(process.env.SESSION_ENC_KEY).toBe(first)
  })

  it('refuses to mint a second identity beside an existing database', () => {
    writeFileSync(join(dir, 'acorn.sqlite'), Buffer.alloc(0))
    expect(() => resolveSessionKey(dir)).toThrow(/restore the original SESSION_ENC_KEY/)
    expect(process.env.SESSION_ENC_KEY).toBeUndefined()
    expect(existsSync(join(dir, 'session.key'))).toBe(false)
  })

  it('uses an env key to migrate an existing database safely', () => {
    writeFileSync(join(dir, 'acorn.sqlite'), Buffer.alloc(0))
    process.env.SESSION_ENC_KEY = ENV_KEY
    resolveSessionKey(dir)
    delete process.env.SESSION_ENC_KEY
    resolveSessionKey(dir)
    expect(process.env.SESSION_ENC_KEY).toBe(ENV_KEY)
  })

  it('throws — never regenerates — when an existing key fails to decrypt', () => {
    writeFileSync(join(dir, 'session.key'), Buffer.from('garbage'))
    expect(() => resolveSessionKey(dir)).toThrow()
    expect(process.env.SESSION_ENC_KEY).toBeUndefined()
  })

  it('throws when encryption is unavailable and no env var is set', () => {
    fake.available = false
    expect(() => resolveSessionKey(dir)).toThrow(/unavailable/)
  })
})
