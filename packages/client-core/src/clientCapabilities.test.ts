import { afterEach, describe, expect, it } from 'vitest'
import {
  _resetClientCapabilities,
  clientCapability,
  clientCapabilityId,
  clientCapabilityIds,
  provideClientCapability,
} from './clientCapabilities'

type Greeter = { hello(): string }
const GREETER = clientCapabilityId<Greeter>('test.greeter')

afterEach(() => _resetClientCapabilities())

describe('client capability registry', () => {
  it('is undefined until provided, so a consumer can degrade', () => {
    expect(clientCapability(GREETER)).toBeUndefined()
    provideClientCapability(GREETER, { hello: () => 'hi' })
    expect(clientCapability(GREETER)?.hello()).toBe('hi')
  })

  it('throws on a duplicate id rather than replacing', () => {
    provideClientCapability(GREETER, { hello: () => 'first' })
    expect(() => provideClientCapability(GREETER, { hello: () => 'second' })).toThrow(/already provided/)
  })

  it('disposal is idempotent and never clobbers a later provider', () => {
    const first = provideClientCapability(GREETER, { hello: () => 'first' })
    first.dispose()
    first.dispose() // no-op, not a throw
    provideClientCapability(GREETER, { hello: () => 'second' })
    // The stale handle must not delete the new impl — this is the re-activation case the plugin host
    // hits when it disposes a plugin's contributions and immediately re-registers them.
    first.dispose()
    expect(clientCapability(GREETER)?.hello()).toBe('second')
  })

  it('lists provided ids sorted', () => {
    provideClientCapability(clientCapabilityId('b.thing'), 1)
    provideClientCapability(clientCapabilityId('a.thing'), 2)
    expect(clientCapabilityIds()).toEqual(['a.thing', 'b.thing'])
  })
})
