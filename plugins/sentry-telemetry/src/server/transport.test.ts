import { describe, expect, it, vi } from 'vitest'
import { parseDsn } from './dsn'
import { probeEnvelope } from './envelope'
import { parseRateLimits, postEnvelope } from './transport'

const NOW = 1_700_000_000_000
const DSN = parseDsn('https://abc123@o42.ingest.us.sentry.io/1234567')!
const SDK = { name: 'acorn.sentry-telemetry', version: '0.1.0' }

const answer = (status: number, headers: Record<string, string> = {}) =>
  vi.fn(async () => new Response(null, { status, headers }))

describe('parseRateLimits', () => {
  it('reads the documented example', () => {
    expect(parseRateLimits('60:transaction:key, 2700:default;error;security:organization', NOW)).toEqual([
      { categories: ['transaction'], untilMs: NOW + 60_000 },
      { categories: ['error'], untilMs: NOW + 2_700_000 },
    ])
  })

  it('treats an empty category list as everything', () => {
    expect(parseRateLimits('30::organization', NOW)).toEqual([{ categories: 'all', untilMs: NOW + 30_000 }])
  })

  it('ignores whitespace anywhere', () => {
    expect(parseRateLimits('  10 : log_item ; trace_metric : key ', NOW)).toEqual([
      { categories: ['log_item', 'trace_metric'], untilMs: NOW + 10_000 },
    ])
  })

  it('skips a quota naming only categories this exporter does not send', () => {
    // The specification asks for this by name: a category from a later Sentry must not close the
    // ones in front of it.
    expect(parseRateLimits('60:replay;profile:organization', NOW)).toEqual([])
  })

  it('answers empty for a missing or unparseable header', () => {
    expect(parseRateLimits(null, NOW)).toEqual([])
    expect(parseRateLimits('later:error', NOW)).toEqual([])
  })
})

describe('postEnvelope', () => {
  it('posts to the envelope endpoint with both forms of authentication', async () => {
    const fetchImpl = answer(200)
    await postEnvelope({ fetch: fetchImpl, dsn: DSN, envelope: probeEnvelope(), client: 'acorn/1', sdk: SDK, now: NOW })

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://o42.ingest.us.sentry.io/api/1234567/envelope/')
    expect(init.headers).toMatchObject({
      'content-type': 'application/x-sentry-envelope',
      'x-sentry-auth': 'Sentry sentry_version=7, sentry_client=acorn/1, sentry_key=abc123',
    })
    // Sentry checks the two agree, so the envelope header carries the DSN without the secret half.
    expect(JSON.parse(String(init.body).split('\n')[0])).toEqual({
      dsn: 'https://abc123@o42.ingest.us.sentry.io/1234567',
      sdk: SDK,
      sent_at: '2023-11-14T22:13:20.000Z',
    })
  })

  it('reads rate limits off a 200, because Sentry sends them on any response', async () => {
    const result = await postEnvelope({
      fetch: answer(200, { 'x-sentry-rate-limits': '60:log_item:key' }),
      dsn: DSN, envelope: probeEnvelope(), client: 'acorn/1', sdk: SDK, now: NOW,
    })
    expect(result).toMatchObject({ status: 200, limits: [{ categories: ['log_item'], untilMs: NOW + 60_000 }] })
  })

  it('falls back to Retry-After on a 429 with no rate-limit header', async () => {
    const result = await postEnvelope({
      fetch: answer(429, { 'retry-after': '45' }),
      dsn: DSN, envelope: probeEnvelope(), client: 'acorn/1', sdk: SDK, now: NOW,
    })
    expect(result.limits).toEqual([{ categories: 'all', untilMs: NOW + 45_000 }])
  })

  it('falls back to sixty seconds on a 429 with neither header', async () => {
    const result = await postEnvelope({
      fetch: answer(429), dsn: DSN, envelope: probeEnvelope(), client: 'acorn/1', sdk: SDK, now: NOW,
    })
    expect(result.limits).toEqual([{ categories: 'all', untilMs: NOW + 60_000 }])
  })

  it('reports a network failure as a null status, which is the case worth retrying', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('ENOTFOUND') })
    expect(await postEnvelope({ fetch: fetchImpl, dsn: DSN, envelope: probeEnvelope(), client: 'acorn/1', sdk: SDK, now: NOW }))
      .toEqual({ status: null, limits: [], detail: null })
  })

  it("passes back Relay's own explanation of a rejected envelope", async () => {
    const result = await postEnvelope({
      fetch: answer(400, { 'x-sentry-error': 'invalid item header' }),
      dsn: DSN, envelope: probeEnvelope(), client: 'acorn/1', sdk: SDK, now: NOW,
    })
    expect(result.detail).toBe('invalid item header')
  })
})
