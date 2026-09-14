import { describe, expect, it } from 'vitest'
import { rpcError } from './pluginRpc'
import { isProviderOperationError, ProviderOperationError } from '../integrations/types'

// A bundled plugin runs in an isolated worker, so every error it throws is torn down to a wire record
// and rebuilt on the host side as a plain Error. Only the fields named here survive, which makes this
// the list that decides whether the host can still tell one failure from another.
describe('plugin RPC error marshalling', () => {
  // Reconstruction, as pluginRpc does it on receipt. Kept here rather than exported, because the only
  // thing worth pinning is that a round trip leaves the host able to answer.
  const received = (error: unknown): Error => {
    const wire = rpcError(error)
    const rebuilt = new Error(wire.message)
    rebuilt.name = wire.name
    return Object.assign(rebuilt, {
      ...(wire.code === undefined ? {} : { code: wire.code }),
      ...(wire.status === undefined ? {} : { status: wire.status }),
    })
  }

  // The bug. `status` used to be dropped, so a provider error arrived with its code intact and no
  // status, stopped matching the shape the host checks, and a rejected credential was answered as
  // "the provider is unavailable".
  it('keeps a provider error recognisable after the trip out of the worker', () => {
    const thrown = new ProviderOperationError('provider_needs_auth', 401)
    const arrived = received(thrown)

    expect(arrived).not.toBeInstanceOf(ProviderOperationError)
    expect(isProviderOperationError(arrived)).toBe(true)
    expect(isProviderOperationError(arrived) && arrived.status).toBe(401)
    expect(isProviderOperationError(arrived) && arrived.code).toBe('provider_needs_auth')
  })

  it('defaults the status the same way the constructor does', () => {
    const arrived = received(new ProviderOperationError('provider_unavailable'))
    expect(isProviderOperationError(arrived) && arrived.status).toBe(502)
  })

  it('leaves an ordinary error alone', () => {
    const arrived = received(new TypeError('fetch failed'))
    expect(arrived.name).toBe('TypeError')
    expect(isProviderOperationError(arrived)).toBe(false)
  })
})
