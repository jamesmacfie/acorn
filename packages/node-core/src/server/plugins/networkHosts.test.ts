import { describe, expect, it } from 'vitest'
import { networkHostAllowed } from './networkHosts'

describe('networkHostAllowed', () => {
  it('keeps exact hostname grants exact', () => {
    const grants = new Set(['api.linear.app'])
    expect(networkHostAllowed('api.linear.app', grants)).toBe(true)
    expect(networkHostAllowed('other.api.linear.app', grants)).toBe(false)
  })

  it('allows one subdomain label under a wildcard grant', () => {
    const grants = new Set(['*.ingest.us.sentry.io'])
    expect(networkHostAllowed('o42.ingest.us.sentry.io', grants)).toBe(true)
    expect(networkHostAllowed('ingest.us.sentry.io', grants)).toBe(false)
    expect(networkHostAllowed('other.o42.ingest.us.sentry.io', grants)).toBe(false)
    expect(networkHostAllowed('o42.ingest.us.sentry.io.attacker.test', grants)).toBe(false)
    expect(networkHostAllowed('notingest.us.sentry.io', grants)).toBe(false)
  })

  it('reserves the bare wildcard for access to any hostname', () => {
    expect(networkHostAllowed('example.org', new Set(['*']))).toBe(true)
  })
})
