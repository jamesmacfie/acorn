import { afterEach, describe, expect, it, vi } from 'vitest'
import { OnePasswordError } from '../core/onePassword'
import { providerError } from './respondProvider'
import { ProviderOperationError } from './types'

// Only the two calls providerError makes on the context. A real Hono context would add a router, a
// request and an environment, none of which this function reads.
const context = () => {
  const sent: { status?: number; body?: unknown } = {}
  return {
    sent,
    c: {
      get: (key: string) => (key === 'requestId' ? 'r76-1789377618767' : undefined),
      json: (body: unknown, status: number) => {
        sent.body = body
        sent.status = status
        return new Response()
      },
    } as unknown as Parameters<typeof providerError>[0],
  }
}

const codeOf = (sent: { body?: unknown }) => (sent.body as { error: { code: string } }).error.code

describe('providerError', () => {
  afterEach(() => vi.restoreAllMocks())

  it('passes a deliberate provider failure through with its own status', () => {
    const { c, sent } = context()
    providerError(c, new ProviderOperationError('provider_needs_auth', 401))
    expect(sent.status).toBe(401)
    expect(codeOf(sent)).toBe('provider_needs_auth')
  })

  it('tells an unreadable 1Password reference apart from a rejected credential', () => {
    const { c, sent } = context()
    providerError(c, new OnePasswordError('not-installed'))
    expect(codeOf(sent)).toBe('provider_secret_ref_unreadable')
  })

  // The reason this file exists. `provider_unavailable` is the shrug every unplanned throw lands on,
  // so the log line is the only thing that says which one it was. Losing it leaves the code on the
  // caller's screen pointing at nothing.
  it('logs what actually threw before answering provider_unavailable', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { c, sent } = context()
    providerError(c, new TypeError('fetch failed'))
    expect(codeOf(sent)).toBe('provider_unavailable')
    expect(warn).toHaveBeenCalledOnce()
    const line = warn.mock.calls[0][0] as string
    expect(line).toContain('TypeError')
    expect(line).toContain('fetch failed')
    expect(line).toContain('r76-1789377618767')
  })

  it('survives a thrown value that is not an Error at all', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { c, sent } = context()
    providerError(c, 'something went sideways')
    expect(codeOf(sent)).toBe('provider_unavailable')
  })
})
