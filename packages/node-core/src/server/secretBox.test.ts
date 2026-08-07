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
    // The tamper has to be guaranteed to change a DECODED byte, and the obvious spellings do not.
    // Overwriting the last two characters with a fixed `xy` collides with the original roughly once in
    // 4096 seals (base64url has 64 symbols), which is a red suite with no bug behind it — seen in the
    // wild and mistaken for the suite's load sensitivity. Flipping the final character is worse: the tag
    // is 16 bytes, so its base64url tail is 22 characters carrying 132 bits, and the last character's low
    // four bits are padding a lenient decoder discards. So tamper the first character of the ciphertext
    // segment, where every bit is significant.
    const parts = sealed.split('.')
    expect(parts).toHaveLength(5) // header.key.iv.ciphertext.tag — compact JWE
    parts[3] = `${parts[3][0] === 'A' ? 'B' : 'A'}${parts[3].slice(1)}`
    const tampered = parts.join('.')
    expect(tampered).not.toBe(sealed)
    expect(await decryptSecret(tampered, KEY)).toBeNull()
  })

  it('returns null for garbage rather than throwing', async () => {
    for (const bad of ['', 'not-a-jwe', 'a.b.c.d.e']) expect(await decryptSecret(bad, KEY)).toBeNull()
  })

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
