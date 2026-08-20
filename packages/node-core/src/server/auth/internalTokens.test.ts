import { describe, expect, it } from 'vitest'
import { mintInternalToken, verifyInternalToken } from './internalTokens'

const KEY = 'signing-key-0123456789'

describe('scoped internal tokens', () => {
  it('round-trips a service token and a task token', () => {
    expect(verifyInternalToken(KEY, mintInternalToken(KEY, { scope: 'service' }))).toEqual({
      scope: 'service',
      taskId: undefined,
      sessionId: undefined,
    })
    expect(verifyInternalToken(KEY, mintInternalToken(KEY, { scope: 'task', taskId: 'task-1', sessionId: 'sess-1' }))).toEqual({
      scope: 'task',
      taskId: 'task-1',
      sessionId: 'sess-1',
    })
  })

  it('survives payloads whose base64 contains the separator-adjacent characters', () => {
    // The bug this pins: base64url's alphabet is [A-Za-z0-9_-], so a payload routinely contains '_'.
    // The first implementation split the token on '_' and every such token failed to verify. Ids long
    // enough to force padding-free base64 with both '-' and '_' are the interesting case.
    for (const taskId of ['a'.repeat(1), 'ø-task_id/with+chars', '9f8e7d6c-5b4a-4938-8271-0a1b2c3d4e5f', '~'.repeat(40)]) {
      const token = mintInternalToken(KEY, { scope: 'task', taskId })
      expect(verifyInternalToken(KEY, token)?.taskId).toBe(taskId)
    }
  })

  it('refuses a token signed with a different key', () => {
    const token = mintInternalToken(KEY, { scope: 'service' })
    expect(verifyInternalToken('another-key-0123456789', token)).toBeNull()
    // Rotating the signing key is the revocation lever, since these tokens don't expire.
    expect(verifyInternalToken(KEY, token)).not.toBeNull()
  })

  it('refuses a tampered payload, a tampered signature, and a truncated token', () => {
    const token = mintInternalToken(KEY, { scope: 'task', taskId: 'task-1' })
    const [payload, signature] = token.replace('acorn_it_', '').split('.')
    // Re-signing is the point: swapping the claims without the key must not verify.
    const forged = Buffer.from(JSON.stringify({ s: 'service' })).toString('base64url')
    expect(verifyInternalToken(KEY, `acorn_it_${forged}.${signature}`)).toBeNull()
    expect(verifyInternalToken(KEY, `acorn_it_${payload}.${signature.slice(0, -2)}xy`)).toBeNull()
    expect(verifyInternalToken(KEY, `acorn_it_${payload}`)).toBeNull()
    expect(verifyInternalToken(KEY, payload)).toBeNull()
  })

  it('refuses garbage, an empty token, and an empty key', () => {
    for (const token of ['', 'nonsense', 'acorn_it_.', 'acorn_it_!!!.!!!', 'acorn_dt_abc.def']) {
      expect(verifyInternalToken(KEY, token)).toBeNull()
    }
    // An unset key must never authenticate anything: a node with no signing key has no internal callers.
    expect(verifyInternalToken('', mintInternalToken(KEY, { scope: 'service' }))).toBeNull()
    expect(() => mintInternalToken('', { scope: 'service' })).toThrow(/signing key/)
  })

  it('refuses an unknown scope and a task scope with no task', () => {
    // Both are forgeable only with the key, so these are the shapes a future bug could mint. The
    // verifier rejecting them is what keeps 'task' meaning "bound to a task".
    const bad = (claims: object) => {
      const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
      // Sign it properly, so only the claim check can reject it.
      return verifyInternalToken(KEY, mintInternalToken(KEY, { scope: 'service' }).replace(/acorn_it_[^.]+/, `acorn_it_${payload}`))
    }
    expect(bad({ s: 'admin' })).toBeNull()
    expect(bad({ s: 'task' })).toBeNull()
    expect(() => mintInternalToken(KEY, { scope: 'task' })).toThrow(/requires a taskId/)
  })
})
