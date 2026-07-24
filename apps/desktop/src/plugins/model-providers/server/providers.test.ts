import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { schema } from '../../../core/server/db'
import { connectionProviderRegistry } from '../../../core/server/integrations/connectionRegistry'
import { connectProvider, rotateConnection, testConnection } from '../../../core/server/integrations/connections'
import { makeTestDb, type TestDb } from '../../../core/server/routes/testDb'
import { decryptSecret } from '../../../core/server/session'
import {
  ANTHROPIC_RECOMMENDED_MODEL_ID,
  createAnthropicProviders,
  type AnthropicGateway,
} from './anthropic'
import {
  createOpenAIProviders,
  OPENAI_RECOMMENDED_MODEL_ID,
  type OpenAIGateway,
} from './openai'

const ENCRYPTION_KEY = '33'.repeat(32)

const openAI = {
  listModels: vi.fn(async () => ({ data: [{ id: OPENAI_RECOMMENDED_MODEL_ID }] })),
  createResponse: vi.fn(async () => ({
    output_text: 'SELECT 1;\nSELECT 2;',
    model: OPENAI_RECOMMENDED_MODEL_ID,
    usage: { input_tokens: 12, output_tokens: 6 },
  })),
} satisfies OpenAIGateway

const anthropic = {
  listModels: vi.fn(async () => ({ data: [{ id: ANTHROPIC_RECOMMENDED_MODEL_ID }] })),
  createMessage: vi.fn(async () => ({
    content: [
      { type: 'thinking' },
      { type: 'text', text: 'SELECT ' },
      { type: 'text', text: '1;' },
    ],
    model: ANTHROPIC_RECOMMENDED_MODEL_ID,
    usage: { input_tokens: 8, output_tokens: 3 },
  })),
} satisfies AnthropicGateway

const openAIProviders = createOpenAIProviders(() => openAI)
const anthropicProviders = createAnthropicProviders(() => anthropic)

describe('model provider connections', () => {
  let testDb: TestDb

  beforeAll(() => {
    if (!connectionProviderRegistry.get('openai')) {
      connectionProviderRegistry.register(openAIProviders.connectionProvider)
      connectionProviderRegistry.register(anthropicProviders.connectionProvider)
    }
  })

  beforeEach(() => {
    testDb = makeTestDb()
    vi.clearAllMocks()
  })

  afterEach(() => {
    testDb.cleanup()
  })

  it('publishes one write-only API key field per provider', () => {
    for (const provider of [
      openAIProviders.connectionProvider,
      anthropicProviders.connectionProvider,
    ]) {
      expect(provider.toPublic()).toMatchObject({
        kind: 'model-provider',
        connection: {
          fields: [{ id: 'apiKey', type: 'password', required: true }],
          maxConnections: 1,
        },
        capabilities: { textGeneration: true },
      })
      expect(JSON.stringify(provider.toPublic())).not.toContain('plaintext-key')
    }
  })

  it('validates with model listing and persists only encrypted OpenAI credentials', async () => {
    const connected = await connectProvider(
      testDb.db,
      'alice',
      { providerId: 'openai', credentials: { apiKey: ' plaintext-key ' } },
      ENCRYPTION_KEY,
    )

    expect(openAI.listModels).toHaveBeenCalledOnce()
    expect(connected).toMatchObject({
      providerId: 'openai',
      label: 'OpenAI',
      capabilities: { textGeneration: 'available' },
    })
    const [row] = await testDb.db.select().from(schema.integrations)
    expect(row.authRef).not.toContain('plaintext-key')
    expect(await decryptSecret(row.authRef, ENCRYPTION_KEY)).toBe('plaintext-key')
    expect(JSON.stringify({ ...row, authRef: undefined })).not.toContain('plaintext-key')
  })

  it('rotates and tests Anthropic credentials through the same non-generating endpoint', async () => {
    const connected = await connectProvider(
      testDb.db,
      'alice',
      { providerId: 'anthropic', credentials: { apiKey: 'first-key' } },
      ENCRYPTION_KEY,
    )
    await rotateConnection(
      testDb.db,
      'alice',
      connected.id,
      { credentials: { apiKey: 'rotated-key' } },
      ENCRYPTION_KEY,
    )
    const summary = await testConnection(testDb.db, 'alice', connected.id, ENCRYPTION_KEY)

    expect(anthropic.listModels).toHaveBeenCalledTimes(3)
    expect(summary.status).toBe('connected')
    const [row] = await testDb.db.select().from(schema.integrations)
    expect(await decryptSecret(row.authRef, ENCRYPTION_KEY)).toBe('rotated-key')
  })

  it.each([
    [401, 'provider_needs_auth'],
    [403, 'provider_needs_auth'],
    [429, 'provider_rate_limited'],
    [500, 'provider_unavailable'],
    [undefined, 'provider_unavailable'],
  ] as const)('maps OpenAI validation status %s to %s', async (status, code) => {
    openAI.listModels.mockRejectedValueOnce(status === undefined ? new Error('network') : { status })

    await expect(openAIProviders.connectionProvider.connection.validate({ apiKey: 'key' }))
      .rejects.toMatchObject({ code })
  })
})

describe('model provider adapters', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses the OpenAI Responses API safety contract and aggregated output text', async () => {
    const signal = new AbortController().signal
    const result = await openAIProviders.modelAdapter.generateText({
      secret: 'openai-key',
      config: {},
      input: {
        system: 'Generate SQL.',
        prompt: 'List users.',
        maxOutputTokens: 600,
        signal,
      },
    })

    expect(openAI.createResponse).toHaveBeenCalledWith({
      model: OPENAI_RECOMMENDED_MODEL_ID,
      instructions: 'Generate SQL.',
      input: 'List users.',
      max_output_tokens: 600,
      store: false,
    }, signal)
    expect(result).toEqual({
      text: 'SELECT 1;\nSELECT 2;',
      modelId: OPENAI_RECOMMENDED_MODEL_ID,
      usage: { inputTokens: 12, outputTokens: 6 },
    })
  })

  it('uses Anthropic system/user fields and concatenates only text blocks', async () => {
    const signal = new AbortController().signal
    const result = await anthropicProviders.modelAdapter.generateText({
      secret: 'anthropic-key',
      config: {},
      input: {
        system: 'Generate SQL.',
        prompt: 'List users.',
        modelId: 'claude-explicit',
        maxOutputTokens: 700,
        signal,
      },
    })

    expect(anthropic.createMessage).toHaveBeenCalledWith({
      model: 'claude-explicit',
      system: 'Generate SQL.',
      messages: [{ role: 'user', content: 'List users.' }],
      max_tokens: 700,
    }, signal)
    expect(result).toEqual({
      text: 'SELECT 1;',
      modelId: ANTHROPIC_RECOMMENDED_MODEL_ID,
      usage: { inputTokens: 8, outputTokens: 3 },
    })
  })

  it.each([
    [401, 'provider_needs_auth'],
    [429, 'provider_rate_limited'],
    [503, 'provider_unavailable'],
  ] as const)('maps Anthropic generation status %s to %s', async (status, code) => {
    anthropic.createMessage.mockRejectedValueOnce({ status })

    await expect(anthropicProviders.modelAdapter.generateText({
      secret: 'anthropic-key',
      config: {},
      input: {
        system: 'Generate SQL.',
        prompt: 'List users.',
        maxOutputTokens: 100,
      },
    })).rejects.toMatchObject({ code })
  })
})
