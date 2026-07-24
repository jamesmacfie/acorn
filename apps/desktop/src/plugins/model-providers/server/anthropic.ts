import Anthropic from '@anthropic-ai/sdk'
import { publicConnectionProvider } from '../../../core/server/integrations/providers/shared'
import { ProviderOperationError } from '../../../core/server/integrations/types'
import type { ModelProviderAdapter } from '../../../core/server/modelProviders/types'
import { modelProviderError, modelProviderHealth } from './errors'

export const ANTHROPIC_RECOMMENDED_MODEL_ID = 'claude-sonnet-5'

type AnthropicMessage = {
  content: Array<{ type: string; text?: string }>
  model: string
  usage: {
    input_tokens: number
    output_tokens: number
  }
}

export type AnthropicGateway = {
  listModels(): Promise<unknown>
  createMessage(
    request: {
      model: string
      system: string
      messages: [{ role: 'user'; content: string }]
      max_tokens: number
    },
    signal?: AbortSignal,
  ): Promise<AnthropicMessage>
}

export type AnthropicGatewayFactory = (apiKey: string) => AnthropicGateway

const defaultGateway: AnthropicGatewayFactory = (apiKey) => {
  const client = new Anthropic({ apiKey })
  return {
    listModels: () => client.models.list(),
    createMessage: (request, signal) => client.messages.create(request, { signal }),
  }
}

export const createAnthropicProviders = (
  gateway: AnthropicGatewayFactory = defaultGateway,
) => {
  const connectionProvider = publicConnectionProvider({
    id: 'anthropic',
    label: 'Anthropic',
    glyph: 'A',
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
        placeholder: 'sk-ant-…',
        hint: 'Claude Console → API keys. The key stays encrypted on this Mac.',
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
          label: 'Anthropic',
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
    budgets: {
      maxConcurrentRequests: 4,
      maxConcurrentRequestsPerConnection: 2,
    },
  })

  const modelAdapter: ModelProviderAdapter = {
    providerId: 'anthropic',
    recommendedModelId: ANTHROPIC_RECOMMENDED_MODEL_ID,
    async generateText({ secret, input }) {
      try {
        const message = await gateway(secret).createMessage({
          model: input.modelId ?? ANTHROPIC_RECOMMENDED_MODEL_ID,
          system: input.system,
          messages: [{ role: 'user', content: input.prompt }],
          max_tokens: input.maxOutputTokens,
        }, input.signal)
        return {
          text: message.content
            .filter((block): block is { type: 'text'; text: string } =>
              block.type === 'text' && typeof block.text === 'string')
            .map((block) => block.text)
            .join(''),
          modelId: message.model,
          usage: {
            inputTokens: message.usage.input_tokens,
            outputTokens: message.usage.output_tokens,
          },
        }
      } catch (error) {
        throw modelProviderError(error)
      }
    },
  }

  return { connectionProvider, modelAdapter }
}

export const {
  connectionProvider: anthropicConnectionProvider,
  modelAdapter: anthropicModelProvider,
} = createAnthropicProviders()
