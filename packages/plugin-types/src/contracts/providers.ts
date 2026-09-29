import type { HostOwned } from './shared.js'
import type { PluginFetchHandler, PluginProviderConnectionVisitor } from './routes.js'

export type PluginProviderRegistry = {
  integration(
    provider: HostOwned<'node-core/server/integrations/types.IntegrationProviderContribution'>,
    route?: PluginFetchHandler<never, never>,
  ): void
  connection(provider: HostOwned<'node-core/server/integrations/types.ConnectionProviderContribution'>): void
  model(adapter: ModelProviderAdapter): void
  /** A provider that knows about nodes, and optionally can make and remove them
   *  (docs/plugins.md § Node providers). */
  nodes(provider: HostOwned<'node-core/server/nodeProviders/registry.NodeProviderContribution'>): void
  withConnection<T>(userId: string, providerId: string, visit: PluginProviderConnectionVisitor<T>): Promise<T | undefined>
}

export type GenerateTextInput = {
  system: string
  prompt: string
  modelId?: string
  maxOutputTokens: number
  signal?: AbortSignal
}

export type GenerateTextUsage = { inputTokens?: number; outputTokens?: number }

export type ModelProviderAdapterResult = {
  text: string
  modelId: string
  usage?: GenerateTextUsage
}

export type ModelProviderAdapter = {
  providerId: string
  recommendedModelId: string
  generateText(args: { secret: string; config: unknown; input: GenerateTextInput }): Promise<ModelProviderAdapterResult>
}
