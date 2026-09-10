import { describe, expect, it } from 'vitest'
import { authHeader, describeDsn, envelopeEndpoint, parseDsn } from './dsn'

describe('parseDsn', () => {
  it('takes a sentry.io DSN apart', () => {
    expect(parseDsn('https://abc123@o42.ingest.us.sentry.io/1234567')).toEqual({
      protocol: 'https',
      publicKey: 'abc123',
      host: 'o42.ingest.us.sentry.io',
      path: '',
      projectId: '1234567',
    })
  })

  it('keeps the path a self-hosted install is mounted under', () => {
    // `/api/<project>/envelope/` goes after the path, not before it, so losing this would post to
    // the wrong URL on every self-hosted node.
    expect(parseDsn('https://key@sentry.example.com/prefix/9')).toMatchObject({ path: 'prefix', projectId: '9' })
    expect(envelopeEndpoint(parseDsn('https://key@sentry.example.com/prefix/9')!))
      .toBe('https://sentry.example.com/prefix/api/9/envelope/')
  })

  it('accepts a DSN that still carries the deprecated secret half, and drops it', () => {
    const dsn = parseDsn('https://public:secret@sentry.example.com/7')
    expect(dsn?.publicKey).toBe('public')
    expect(JSON.stringify(dsn)).not.toContain('secret')
  })

  it('keeps a port', () => {
    expect(parseDsn('http://key@localhost:9000/3')?.host).toBe('localhost:9000')
  })

  it.each([
    ['not a url', 'sentry.io/1'],
    ['no public key', 'https://o1.ingest.sentry.io/1'],
    ['no project id', 'https://key@o1.ingest.sentry.io/'],
    ['a project slug rather than an id', 'https://key@o1.ingest.sentry.io/my-project'],
    ['a scheme that is not http', 'ftp://key@o1.ingest.sentry.io/1'],
    ['empty', ''],
  ])('refuses one with %s', (_reason, raw) => {
    expect(parseDsn(raw)).toBeNull()
  })
})

describe('the endpoint and the header', () => {
  const dsn = parseDsn('https://abc123@o42.ingest.us.sentry.io/1234567')!

  it('posts to the envelope endpoint, trailing slash included', () => {
    expect(envelopeEndpoint(dsn)).toBe('https://o42.ingest.us.sentry.io/api/1234567/envelope/')
  })

  it('authenticates with protocol version 7 and the public key', () => {
    expect(authHeader(dsn, 'acorn.sentry-telemetry/0.1.0'))
      .toBe('Sentry sentry_version=7, sentry_client=acorn.sentry-telemetry/0.1.0, sentry_key=abc123')
  })

  it('describes a connection by host and project, never by key', () => {
    expect(describeDsn(dsn)).toBe('o42.ingest.us.sentry.io/1234567')
  })
})
