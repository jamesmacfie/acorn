import { describe, expect, it } from 'vitest'
import { openSession, sealSession, type SessionData } from './session'

// jose's A256GCM uses WebCrypto (crypto.subtle), a Node global since v20 — no Workers-only
// APIs here, so this runs under vitest's default Node environment.

const KEY = 'a'.repeat(64) // 32 bytes of hex
const OTHER_KEY = 'b'.repeat(64)

const data: SessionData = {
  token: 'gho_secret',
  login: 'octocat',
  name: 'The Octocat',
  avatar: 'https://example.com/a.png',
  scopes: ['repo', 'read:user'],
}

describe('sealSession / openSession round-trip', () => {
  it('seals and re-opens an identical session with the same key', async () => {
    const jwt = await sealSession(data, KEY)
    expect(typeof jwt).toBe('string')
    expect(await openSession(jwt, KEY)).toEqual(data)
  })

  it('applies defaults for absent optional fields', async () => {
    const jwt = await sealSession({ token: 't', login: 'l', name: '', avatar: '', scopes: [] }, KEY)
    expect(await openSession(jwt, KEY)).toEqual({ token: 't', login: 'l', name: '', avatar: '', scopes: [] })
  })

  it('returns null when opened with the wrong key (tampered/forged cookie)', async () => {
    const jwt = await sealSession(data, KEY)
    expect(await openSession(jwt, OTHER_KEY)).toBeNull()
  })

  it('returns null for a tampered ciphertext (AEAD tag mismatch)', async () => {
    const jwt = await sealSession(data, KEY)
    expect(await openSession(jwt.slice(0, -2) + 'xx', KEY)).toBeNull()
  })

  it('returns null for garbage / non-JWE input', async () => {
    expect(await openSession('not-a-jwt', KEY)).toBeNull()
    expect(await openSession('', KEY)).toBeNull()
    expect(await openSession('a.b.c.d.e', KEY)).toBeNull()
  })

  it('rejects keys that are not 64 hex chars', async () => {
    await expect(sealSession(data, 'tooshort')).rejects.toThrow(/64 hex chars/)
    await expect(sealSession(data, 'z'.repeat(64))).rejects.toThrow(/64 hex chars/)
  })
})
