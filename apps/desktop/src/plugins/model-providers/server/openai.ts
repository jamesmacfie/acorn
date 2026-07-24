import OpenAI from 'openai'
import { publicConnectionProvider } from '../../../core/server/integrations/providers/shared'
import { ProviderOperationError } from '../../../core/server/integrations/types'
import type { ModelProviderAdapter } from '../../../core/server/modelProviders/types'
import type { ModelCatalogEntry } from '../../../core/shared/integrations'
import { modelProviderError, modelProviderHealth } from './errors'

export const OPENAI_RECOMMENDED_MODEL_ID = 'gpt-5.6-sol'

export const OPENAI_MODELS: ModelCatalogEntry[] = [
  { id: 'gpt-5.6-sol', label: 'gpt-5.6-sol' },
  { id: 'gpt-5.6-luna', label: 'gpt-5.6-luna' },
  { id: 'gpt-5.6-terra', label: 'gpt-5.6-terra' },
]

type OpenAIResponse = {
  output_text: string
  model: string
  usage?: {
    input_tokens: number
    output_tokens: number
  } | null
}

export type OpenAIGateway = {
  listModels(): Promise<unknown>
  createResponse(
    request: {
      model: string
      instructions: string
      input: string
      max_output_tokens: number
      store: false
    },
    signal?: AbortSignal,
  ): Promise<OpenAIResponse>
}

export type OpenAIGatewayFactory = (apiKey: string) => OpenAIGateway

const defaultGateway: OpenAIGatewayFactory = (apiKey) => {
  const client = new OpenAI({ apiKey })
  return {
    listModels: () => client.models.list(),
    createResponse: (request, signal) => client.responses.create(request, { signal }),
  }
}

export const createOpenAIProviders = (
  gateway: OpenAIGatewayFactory = defaultGateway,
) => {
  const connectionProvider = publicConnectionProvider({
    id: 'openai',
    label: 'OpenAI',
    glyph: '◎',
    kind: 'model-provider',
    connection: {
      authKind: 'api-key',
      connectable: true,
      disconnectable: true,
      maxConnections: 1,
      fields: [{
        id: 'apiKey',
        label: 'API key',
        type: 'password',
        placeholder: 'sk-…',
        hint: 'OpenAI Platform → API keys. The key stays encrypted on this Mac.',
        required: true,
      }],
      async validate(credentials) {
        const secret = credentials.apiKey?.trim()
        if (!secret) throw new ProviderOperationError('provider_bad_config', 400)
        try {
          await gateway(secret).listModels()
          return secret
        } catch (error) {
          throw modelProviderError(error)
        }
      },
      normalize(_credentials, secret) {
        return {
          secret,
          label: 'OpenAI',
          account: null,
          scopes: [],
          config: {},
          capabilities: { textGeneration: 'available' as const },
        }
      },
      async test(secret) {
        try {
          await gateway(secret).listModels()
          return { ok: true }
        } catch (error) {
          return modelProviderHealth(error)
        }
      },
    },
    capabilities: { textGeneration: true },
    models: OPENAI_MODELS,
    defaultModelId: OPENAI_RECOMMENDED_MODEL_ID,
    budgets: {
      maxConcurrentRequests: 4,
      maxConcurrentRequestsPerConnection: 2,
    },
  })

  const modelAdapter: ModelProviderAdapter = {
    providerId: 'openai',
    recommendedModelId: OPENAI_RECOMMENDED_MODEL_ID,
    async generateText({ secret, input }) {
      try {
        const response = await gateway(secret).createResponse({
          model: input.modelId ?? OPENAI_RECOMMENDED_MODEL_ID,
          instructions: input.system,
          input: input.prompt,
          max_output_tokens: input.maxOutputTokens,
          store: false,
        }, input.signal)
        return {
          text: response.output_text,
          modelId: response.model,
          ...(response.usage
            ? {
                usage: {
                  inputTokens: response.usage.input_tokens,
                  outputTokens: response.usage.output_tokens,
                },
              }
            : {}),
        }
      } catch (error) {
        throw modelProviderError(error)
      }
    },
  }

  return { connectionProvider, modelAdapter }
}

export const {
  connectionProvider: openAIConnectionProvider,
  modelAdapter: openAIModelProvider,
} = createOpenAIProviders()
