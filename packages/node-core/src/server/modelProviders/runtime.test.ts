import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { schema } from '../db'
import { ProviderRequestScheduler } from '../integrations/budgetRuntime'
import { ConnectionProviderRegistry } from '../integrations/connectionRegistry'
import { publicConnectionProvider } from '../integrations/providers/shared'
import { ProviderOperationError } from '../integrations/types'
import { makeTestDb, type TestDb } from '../routes/testDb'
import { encryptSecret } from '../session'
import { ModelProviderRegistry } from './registry'
import { generateTextForConnection } from './runtime'
import type { ModelProviderAdapter, ModelProviderAdapterResult } from './types'

const ENCRYPTION_KEY = '22'.repeat(32)
const PROVIDER_ID = 'runtime-model-test'

const provider = publicConnectionProvider({
  id: PROVIDER_ID,
  label: 'Runtime model',
  glyph: 'R',
  kind: 'model-provider',
  connection: {
    authKind: 'api-key',
    fields: [{ id: 'apiKey', label: 'API key', type: 'password', required: true }],
    connectable: true,
    disconnectable: true,
    async validate(credentials) {
      return credentials.apiKey ?? ''
    },
    normalize(_credentials, secret) {
      return {
        secret,
        label: 'Runtime model',
        account: null,
        scopes: [],
        config: {},
        capabilities: { textGeneration: 'available' as const },
      }
    },
    async test() {
      return { ok: true }
    },
  },
  capabilities: { textGeneration: true },
  budgets: { maxConcurrentRequests: 1, maxConcurrentRequestsPerConnection: 1 },
})

const input = {
  system: 'Return a useful answer.',
  prompt: 'Write SQL.',
  maxOutputTokens: 500,
}

describe('generateTextForConnection', () => {
  let testDb: TestDb
  let connections: ConnectionProviderRegistry
  let models: ModelProviderRegistry
  let adapter: ModelProviderAdapter

  const dependencies = () => ({
    connectionProviders: connections,
    modelProviders: models,
    scheduler: new ProviderRequestScheduler(),
  })

  const insertConnection = async (
    overrides: Partial<typeof schema.integrations.$inferInsert> = {},
  ) => {
    await testDb.db.insert(schema.integrations).values({
      id: 'connection-1',
      userId: 'alice',
      provider: PROVIDER_ID,
      label: 'Runtime model',
      authRef: await encryptSecret('private-key', ENCRYPTION_KEY),
      authKind: 'api-key',
      account: null,
      scopes: '[]',
      capabilities: '{"textGeneration":"available"}',
      config: '{"safe":true}',
      status: 'connected',
      lastValidatedAt: 1,
      lastError: null,
      createdAt: 1,
      updatedAt: 1,
      ...overrides,
    })
  }

  const args = () => ({
    db: testDb.db,
    userId: 'alice',
    encryptionKey: ENCRYPTION_KEY,
    connectionId: 'connection-1',
    input,
  })

  beforeEach(() => {
    testDb = makeTestDb()
    connections = new ConnectionProviderRegistry()
    connections.register(provider)
    models = new ModelProviderRegistry(connections)
    adapter = {
      providerId: PROVIDER_ID,
      recommendedModelId: 'recommended-model',
      generateText: vi.fn(async ({ input: requestInput }) => ({
        text: 'SELECT 1',
        modelId: requestInput.modelId ?? 'missing',
        usage: { inputTokens: 10, outputTokens: 3 },
      })),
    }
    models.register(adapter)
  })

  afterEach(() => {
    testDb.cleanup()
  })

  it('uses only the scoped connection, decrypts just in time, and returns a safe result', async () => {
    await insertConnection()

    const result = await generateTextForConnection(args(), dependencies())

    expect(result).toEqual({
      text: 'SELECT 1',
      providerId: PROVIDER_ID,
      connectionId: 'connection-1',
      modelId: 'recommended-model',
      usage: { inputTokens: 10, outputTokens: 3 },
    })
    expect(adapter.generateText).toHaveBeenCalledWith({
      secret: 'private-key',
      config: { safe: true },
      input: expect.objectContaining({
        system: input.system,
        prompt: input.prompt,
        modelId: 'recommended-model',
        signal: expect.any(AbortSignal),
      }),
    })
    expect(JSON.stringify(result)).not.toContain('private-key')
  })

  it('does not reveal whether another user owns a connection', async () => {
    await insertConnection()

    await expect(generateTextForConnection(
      { ...args(), userId: 'bob' },
      dependencies(),
    )).rejects.toMatchObject({ code: 'provider_not_connected', status: 404 })
  })

  it.each([
    ['disabled', 'provider_not_connected'],
    ['needs-auth', 'provider_needs_auth'],
    ['degraded', 'provider_unavailable'],
  ] as const)('rejects a %s connection', async (status, code) => {
    await insertConnection({ status })

    await expect(generateTextForConnection(args(), dependencies())).rejects.toMatchObject({ code })
    expect(adapter.generateText).not.toHaveBeenCalled()
  })

  it('marks unreadable and provider-rejected credentials as needing authentication', async () => {
    await insertConnection({ authRef: 'not-a-jwe' })

    await expect(generateTextForConnection(args(), dependencies())).rejects.toMatchObject({
      code: 'provider_secret_unreadable',
    })
    expect((await testDb.db.select().from(schema.integrations))[0]).toMatchObject({
      status: 'needs-auth',
      lastError: 'provider_secret_unreadable',
    })

    await testDb.db.delete(schema.integrations)
    await insertConnection()
    adapter.generateText = vi.fn(async () => {
      throw new ProviderOperationError('provider_needs_auth', 401)
    })

    await expect(generateTextForConnection(args(), dependencies())).rejects.toMatchObject({
      code: 'provider_needs_auth',
    })
    expect((await testDb.db.select().from(schema.integrations))[0]).toMatchObject({
      status: 'needs-auth',
      lastError: 'provider_needs_auth',
    })
  })

  it('rejects empty output and invalid unbounded input', async () => {
    await insertConnection()
    adapter.generateText = vi.fn(async () => ({ text: ' ', modelId: 'recommended-model' }))

    await expect(generateTextForConnection(args(), dependencies())).rejects.toMatchObject({
      code: 'provider_unavailable',
    })
    await expect(generateTextForConnection(
      { ...args(), input: { ...input, maxOutputTokens: 128_001 } },
      dependencies(),
    )).rejects.toMatchObject({ code: 'provider_bad_config' })
  })

  it('propagates cancellation and prevents a queued provider call from starting', async () => {
    await insertConnection()
    let releaseFirst: (() => void) | undefined
    let calls = 0
    adapter.generateText = vi.fn(({ input: requestInput }) => {
      calls++
      if (calls === 1) {
        return new Promise<ModelProviderAdapterResult>((resolve) => {
          releaseFirst = () => resolve({ text: 'first', modelId: requestInput.modelId ?? 'missing' })
        })
      }
      return Promise.resolve({ text: 'second', modelId: requestInput.modelId ?? 'missing' })
    })
    const sharedDependencies = dependencies()
    const first = generateTextForConnection(args(), sharedDependencies)
    const controller = new AbortController()
    const second = generateTextForConnection(
      { ...args(), input: { ...input, signal: controller.signal } },
      sharedDependencies,
    )

    await vi.waitFor(() => expect(calls).toBe(1))
    controller.abort()
    await expect(second).rejects.toMatchObject({ code: 'provider_unavailable' })
    releaseFirst?.()
    await expect(first).resolves.toMatchObject({ text: 'first' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(calls).toBe(1)
  })

  it('times out an active provider request and passes the aborted signal to the adapter', async () => {
    await insertConnection()
    let observedSignal: AbortSignal | undefined
    adapter.generateText = vi.fn(({ input: requestInput }) => {
      observedSignal = requestInput.signal
      return new Promise<ModelProviderAdapterResult>((_resolve, reject) => {
        requestInput.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      })
    })

    await expect(generateTextForConnection(
      { ...args(), timeoutMs: 5 },
      dependencies(),
    )).rejects.toMatchObject({ code: 'provider_unavailable' })
    expect(observedSignal?.aborted).toBe(true)
  })
})
