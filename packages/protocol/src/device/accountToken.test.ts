import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { generateSigningKey, signToken, verifyToken } from './accountToken.ts'

const claimsSchema = z.object({ sub: z.string(), exp: z.number().optional() })

describe('signed account tokens', () => {
  const now = 1_000

  it('verifies a token it signed, and reads its claims', async () => {
    const { signing, keys } = await generateSigningKey('k1')
    const token = await signToken('ticket', { sub: 'account', exp: now + 60 }, signing)
    expect(await verifyToken(token, 'ticket', claimsSchema, keys, now)).toEqual({ sub: 'account', exp: now + 60 })
  })

  it('accepts a token with no expiry, and one that expires later', async () => {
    const { signing, keys } = await generateSigningKey('k1')
    const token = await signToken('credential', { sub: 'node' }, signing)
    expect(await verifyToken(token, 'credential', claimsSchema, keys, now)).toEqual({ sub: 'node' })
  })

  it('refuses a token past its expiry', async () => {
    const { signing, keys } = await generateSigningKey('k1')
    const token = await signToken('ticket', { sub: 'account', exp: now }, signing)
    expect(await verifyToken(token, 'ticket', claimsSchema, keys, now)).toBeNull()
  })

  it('refuses a token of another type', async () => {
    const { signing, keys } = await generateSigningKey('k1')
    const token = await signToken('ticket', { sub: 'account', exp: now + 60 }, signing)
    expect(await verifyToken(token, 'assertion', claimsSchema, keys, now)).toBeNull()
  })

  it('refuses a token another key signed, even under the same key ID', async () => {
    const { signing } = await generateSigningKey('k1')
    const { keys } = await generateSigningKey('k1')
    const token = await signToken('ticket', { sub: 'account', exp: now + 60 }, signing)
    expect(await verifyToken(token, 'ticket', claimsSchema, keys, now)).toBeNull()
  })

  it('refuses a token whose claims were edited', async () => {
    const { signing, keys } = await generateSigningKey('k1')
    const [header, , signature] = (await signToken('ticket', { sub: 'account', exp: now + 60 }, signing)).split('.')
    const forged = btoa(JSON.stringify({ sub: 'someone-else', exp: now + 60 })).replaceAll('=', '')
    expect(await verifyToken(`${header}.${forged}.${signature}`, 'ticket', claimsSchema, keys, now)).toBeNull()
  })

  it('refuses claims the schema does not accept, and text that is no token', async () => {
    const { signing, keys } = await generateSigningKey('k1')
    const token = await signToken('ticket', { sub: 7 }, signing)
    expect(await verifyToken(token, 'ticket', claimsSchema, keys, now)).toBeNull()
    for (const text of ['', 'a.b', 'a.b.c', 'a.b.c.d'])
      expect(await verifyToken(text, 'ticket', claimsSchema, keys, now)).toBeNull()
  })
})
