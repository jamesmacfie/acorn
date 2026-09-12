import { ProviderOperationError } from '@acorn/plugin-api/node'
import { describe, expect, it, vi } from 'vitest'
import { connectionConfig, createSentryTelemetryProvider } from './provider'

const SDK = { name: 'acorn.sentry-telemetry', version: '0.1.0' }
const DSN = 'https://abc123@o42.ingest.us.sentry.io/1234567'

const provider = (fetchImpl: typeof fetch) =>
  createSentryTelemetryProvider({ fetch: fetchImpl, client: 'acorn/1', sdk: SDK })

const answers = (status: number) => vi.fn(async () => new Response(null, { status })) as unknown as typeof fetch

describe('the descriptor', () => {
  it('is an observability connection holding one api key', () => {
    const descriptor = provider(answers(200)).toPublic()
    expect(descriptor).toMatchObject({
      id: 'sentry-telemetry',
      kind: 'observability',
      glyph: 'brand:sentry-telemetry',
      connection: { authKind: 'api-key', maxConnections: 1 },
    })
    expect(descriptor.connection.fields.map((field) => [field.id, field.type, field.required])).toEqual([
      ['dsn', 'password', true],
      ['environment', 'text', false],
      ['release', 'text', false],
    ])
  })

  it('claims no capability, because a sink browses nothing', () => {
    expect(provider(answers(200)).toPublic().capabilities).toEqual({})
  })
})

describe('validate', () => {
  it('parses the DSN and proves the host answers', async () => {
    const fetchImpl = answers(200)
    const validated = await provider(fetchImpl).connection.validate({ dsn: ` ${DSN} `, environment: ' staging ', release: '' })
    expect(validated).toMatchObject({
      dsn: { host: 'o42.ingest.us.sentry.io', projectId: '1234567', publicKey: 'abc123' },
      environment: 'staging',
      release: '',
    })
    // An empty envelope: Sentry stores nothing, so a connection test costs no quota and creates no
    // invented event.
    expect(String((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body)).not.toContain('"type"')
  })

  it('refuses a malformed DSN without making a request', async () => {
    const fetchImpl = answers(200)
    await expect(provider(fetchImpl).connection.validate({ dsn: 'not-a-dsn' }))
      .rejects.toMatchObject({ code: 'provider_bad_config', status: 400 })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it.each([
    [401, 'provider_needs_auth'],
    [403, 'provider_needs_auth'],
    [404, 'provider_resource_not_found'],
    [429, 'provider_rate_limited'],
    [400, 'provider_bad_config'],
  ])('turns a %i into %s', async (status, code) => {
    const failed = await provider(answers(status)).connection.validate({ dsn: DSN }).catch((error: unknown) => error)
    expect(failed).toBeInstanceOf(ProviderOperationError)
    expect(failed).toMatchObject({ code })
  })

  it('reports an unreachable host rather than a bad key', async () => {
    const offline = vi.fn(async () => { throw new Error('ENOTFOUND') }) as unknown as typeof fetch
    await expect(provider(offline).connection.validate({ dsn: DSN })).rejects.toMatchObject({ code: 'provider_unavailable' })
  })
})

describe('normalize', () => {
  it('labels the row by host and project, and never by key', () => {
    const contract = provider(answers(200)).connection
    const validated = { dsn: { protocol: 'https' as const, publicKey: 'abc123', host: 'o42.ingest.us.sentry.io', path: '', projectId: '1234567' }, environment: 'staging', release: 'acorn@0.1.0' }
    const normalized = contract.normalize({ dsn: DSN }, validated)
    expect(normalized.label).toBe('Sentry · o42.ingest.us.sentry.io/1234567')
    expect(normalized.label).not.toContain('abc123')
    expect(normalized.secret).toBe(DSN)
    expect(normalized.config).toEqual({
      host: 'o42.ingest.us.sentry.io',
      projectId: '1234567',
      environment: 'staging',
      release: 'acorn@0.1.0',
    })
  })
})

describe('test', () => {
  it('re-posts the empty envelope', async () => {
    const fetchImpl = answers(200)
    expect(await provider(fetchImpl).connection.test(DSN, {})).toEqual({ ok: true })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('answers bad config for a stored DSN that no longer parses', async () => {
    expect(await provider(answers(200)).connection.test('rubbish', {})).toEqual({ ok: false, error: 'provider_bad_config' })
  })
})

describe('connectionConfig', () => {
  it('reads the two non-secret fields back off the row', () => {
    expect(connectionConfig('{"environment":"staging","release":"acorn@1"}')).toEqual({ environment: 'staging', release: 'acorn@1' })
  })

  it('answers empty for a row written before either field existed, or for nonsense', () => {
    expect(connectionConfig('{}')).toEqual({ environment: '', release: '' })
    expect(connectionConfig(null)).toEqual({ environment: '', release: '' })
    expect(connectionConfig('not json')).toEqual({ environment: '', release: '' })
  })
})
