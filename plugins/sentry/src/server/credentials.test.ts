import { describe, expect, it } from 'vitest'
import { ENV_CONNECTION_ID } from '../shared/api'
import { readEnvironment } from './credentials'

const full = { ACORN_SENTRY_TOKEN: 'sntryu_secret', ACORN_SENTRY_ORG: 'acme', ACORN_SENTRY_PROJECT: 'web' }

describe('readEnvironment', () => {
  it('counts as unset with nothing set, and says nothing', () => {
    expect(readEnvironment({})).toEqual({ target: null })
  })

  it('reads all three, with sentry.io by default', () => {
    expect(readEnvironment(full).target).toEqual({
      connectionId: ENV_CONNECTION_ID,
      label: 'Sentry · acme/web (from ACORN_SENTRY_TOKEN)',
      token: 'sntryu_secret',
      host: 'sentry.io',
      organization: 'acme',
      project: 'web',
    })
  })

  it('takes the EU region from ACORN_SENTRY_URL', () => {
    expect(readEnvironment({ ...full, ACORN_SENTRY_URL: 'https://de.sentry.io' }).target?.host).toBe('de.sentry.io')
  })

  it.each([
    [{ ACORN_SENTRY_TOKEN: 'sntryu_secret', ACORN_SENTRY_ORG: 'acme' }],
    [{ ACORN_SENTRY_ORG: 'acme', ACORN_SENTRY_PROJECT: 'web' }],
    [{ ...full, ACORN_SENTRY_URL: 'https://sentry.example.com' }],
    [{ ...full, ACORN_SENTRY_URL: 'http://sentry.io' }],
  ])('counts as unset when it is incomplete or names another host, and warns without the token', (env) => {
    const read = readEnvironment(env)
    expect(read.target).toBeNull()
    expect(read.warning).toMatch(/ACORN_SENTRY_/)
    expect(read.warning).not.toContain('sntryu_secret')
  })
})
