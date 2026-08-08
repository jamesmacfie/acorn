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
})
