import { describe, expect, it, vi } from 'vitest'
import { encryptSecret } from '../../server/secretBox'
import { redact, SecretService, SecretUnavailableError } from './secrets'

const KEY = 'a'.repeat(64)
const TOKEN = 'ghp_averyrealisticlookinggithubtoken'
const service = new SecretService(KEY)
const sealed = async () => encryptSecret(TOKEN, KEY)

describe('use-scoped access', () => {
  it('hands the plaintext to the scope and returns the scope result', async () => {
    const ref = await sealed()
    await expect(service.use(ref, 'github: list pulls', (token) => token.length)).resolves.toBe(TOKEN.length)
  })

  it('throws SecretUnavailable for a missing, empty or undecryptable ref', async () => {
    const attempt = (ref: string | null) => service.use(ref, 'github: list pulls', () => 'unreachable')
    await expect(attempt(null)).rejects.toThrow(SecretUnavailableError)
    await expect(attempt('')).rejects.toThrow(SecretUnavailableError)
    await expect(attempt('not-a-jwe')).rejects.toThrow(SecretUnavailableError)
    // A ref sealed under a DIFFERENT key is indistinguishable from tampering, and both are "no
    // usable credential" rather than an error the owner can act on differently.
    await expect(attempt(await encryptSecret(TOKEN, 'b'.repeat(64)))).rejects.toThrow(SecretUnavailableError)
  })

  it('names the purpose and never the ciphertext in the error', async () => {
    const failure = await service.use('not-a-jwe', 'github: list pulls', () => 'x').catch((e: Error) => e)
    expect((failure as Error).message).toContain('github: list pulls')
    expect((failure as Error).message).not.toContain('not-a-jwe')
  })

  it('useOptional distinguishes "not connected" from a real failure', async () => {
    await expect(service.useOptional(null, 'github', () => 'x')).resolves.toBeNull()
    const ref = await sealed()
    await expect(
      service.useOptional(ref, 'github', () => {
        throw new Error('network down')
      }),
    ).rejects.toThrow('network down')
  })
})

describe('non-disclosure through the failure path', () => {
  it('scrubs the plaintext out of anything thrown from the scope', async () => {
    const ref = await sealed()
    // Providers really do echo credentials back: a malformed-header response can contain the token,
    // and that body gets wrapped in an Error, logged, and sometimes returned to the client.
    const failure = await service
      .use(ref, 'github: list pulls', () => {
        throw new Error(`GitHub rejected header: Authorization: Bearer ${TOKEN}`)
      })
      .catch((e: Error) => e)
    expect(failure.message).not.toContain(TOKEN)
    expect(failure.message).toContain('[redacted]')
  })

  it('scrubs the stack and a nested cause too', async () => {
    const ref = await sealed()
    const failure = await service
      .use(ref, 'github', () => {
        throw new Error('outer', { cause: new Error(`inner leaked ${TOKEN}`) })
      })
      .catch((e: Error) => e)
    expect(JSON.stringify({ msg: failure.message, stack: failure.stack })).not.toContain(TOKEN)
    expect((failure.cause as Error).message).not.toContain(TOKEN)
  })

  it('preserves the error CLASS, so callers keep branching on it', async () => {
    class ProviderError extends Error {
      constructor(readonly status: number) {
        super(`failed with ${TOKEN}`)
      }
    }
    const ref = await sealed()
    const failure = await service.use(ref, 'github', () => {
      throw new ProviderError(403)
    }).catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(ProviderError)
    expect((failure as ProviderError).status).toBe(403)
    expect((failure as ProviderError).message).not.toContain(TOKEN)
  })

  it('scrubs a thrown string', async () => {
    const ref = await sealed()
    const failure = await service.use(ref, 'github', () => {
      throw `raw ${TOKEN}`
    }).catch((e: unknown) => e)
    expect(String(failure)).not.toContain(TOKEN)
  })
})

describe('redact', () => {
  it('replaces every occurrence', () => {
    expect(redact(`${TOKEN} and ${TOKEN}`, [TOKEN])).toBe('[redacted] and [redacted]')
  })

  it('leaves short strings alone, so redaction cannot mangle unrelated prose', () => {
    // A 3-char "secret" would otherwise rewrite every occurrence of those letters in a message.
    expect(redact('the cat sat on the mat', ['cat'])).toBe('the cat sat on the mat')
  })

  it('is a no-op for empty input', () => {
    expect(redact('unchanged', ['', undefined as unknown as string])).toBe('unchanged')
  })
})

describe('reveal', () => {
  it('is the named escape hatch, and it still fails closed', async () => {
    const ref = await sealed()
    await expect(service.reveal(ref, 'pg pool')).resolves.toBe(TOKEN)
    await expect(service.reveal('bad', 'pg pool')).rejects.toThrow(SecretUnavailableError)
  })
})

describe('seal', () => {
  it('round-trips through use()', async () => {
    const ref = await service.seal('round-trip')
    await expect(service.use(ref, 'probe', (value) => value)).resolves.toBe('round-trip')
  })

  it('does not log the plaintext', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ref = await service.seal(TOKEN)
    await service.use(ref, 'probe', () => 'x')
    for (const spy of [log, warn]) {
      for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain(TOKEN)
    }
    log.mockRestore()
    warn.mockRestore()
  })
})
