import { describe, expect, it } from 'vitest'
import { decryptSecret, encryptSecret, keyBytes } from './secretBox'

const KEY = '0'.repeat(64)
const OTHER_KEY = '1'.repeat(64)

describe('secret box', () => {
  it('round-trips a secret under the same key', async () => {
    const sealed = await encryptSecret('ghp_supersecret', KEY)
    expect(sealed).not.toContain('ghp_supersecret') // ciphertext, not encoding
    expect(await decryptSecret(sealed, KEY)).toBe('ghp_supersecret')
  })

  it('returns null under the wrong key', async () => {
    expect(await decryptSecret(await encryptSecret('s', KEY), OTHER_KEY)).toBeNull()
  })

  it('returns null for a tampered ciphertext (AEAD tag mismatch)', async () => {
    const sealed = await encryptSecret('s', KEY)
    expect(await decryptSecret(`${sealed.slice(0, -2)}xy`, KEY)).toBeNull()
  })

  it('returns null for garbage rather than throwing', async () => {
    for (const bad of ['', 'not-a-jwe', 'a.b.c.d.e']) expect(await decryptSecret(bad, KEY)).toBeNull()
  })

  // No expiry by design: an integration credential lives until the owner disconnects it, unlike the
  // session cookie this used to share a module with.
  it('does not expire', async () => {
    const sealed = await encryptSecret('s', KEY)
    expect(await decryptSecret(sealed, KEY)).toBe('s')
  })

  it('rejects keys that are not exactly 64 hex chars', () => {
    for (const bad of ['', '0'.repeat(63), '0'.repeat(65), 'z'.repeat(64), `${'0'.repeat(62)}zz`]) {
      expect(() => keyBytes(bad)).toThrow(/64 hex chars/)
    }
    expect(keyBytes(KEY)).toHaveLength(32)
  })

  it('parses hex big-endian per byte', () => {
    expect(Array.from(keyBytes(`0aff${'00'.repeat(30)}`)).slice(0, 2)).toEqual([0x0a, 0xff])
  })
})
