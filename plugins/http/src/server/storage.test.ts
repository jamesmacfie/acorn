import { describe, expect, it } from 'vitest'
import { SecretService } from '@acorn/node-core/main/core/secrets.ts'
import { HttpStorageError, openHttpValue, protectHttpValue } from './storage'

const SECRETS = new SecretService('0'.repeat(64))

describe('HTTP storage encryption', () => {
  it('round-trips a sealed field without leaking the plaintext', async () => {
    const sealed = await protectHttpValue('https://example.test?token=secret', SECRETS)
    expect(sealed).not.toContain('secret')
    expect(await openHttpValue(sealed, true, SECRETS)).toBe('https://example.test?token=secret')
  })

  it('refuses to read a row that was never encrypted', async () => {
    await expect(openHttpValue('plain', false, SECRETS)).rejects.toBeInstanceOf(HttpStorageError)
  })

  // The regression this package's own fixtures hid by always filling every field: a GET with no body is
  // the default shape of a new request, and sealing "" produced a row that saved and then would not open.
  it('round-trips an empty field, which is what a request with no body has', async () => {
    const stored = await protectHttpValue('', SECRETS)
    expect(stored).toBe('')
    expect(await openHttpValue(stored, true, SECRETS)).toBe('')
  })

  it('still refuses a value it cannot decrypt', async () => {
    await expect(openHttpValue('not-a-ciphertext', true, SECRETS)).rejects.toBeInstanceOf(HttpStorageError)
  })
})
