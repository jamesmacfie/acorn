export type GenerateTextInput = {
  system: string
  prompt: string
  modelId?: string
  maxOutputTokens: number
  signal?: AbortSignal
}

export type GenerateTextUsage = {
  inputTokens?: number
  outputTokens?: number
}

export type GenerateTextResult = {
  text: string
  providerId: string
  // Which backend answered. `harness:<profileId>` for a CLI; for a connection this is the bare row id
  // the connection runtime has always returned, which still resolves as a connection because a
  // prefix-less id does (@acorn/protocol/modelProviders.ts § parseBackendId). Renaming the field
  // rather than prefixing the value is what keeps a stored pick working.
  backendId: string
  modelId: string
  usage?: GenerateTextUsage
}

export type ModelProviderAdapterResult = {
  text: string
  modelId: string
  usage?: GenerateTextUsage
}

export type ModelProviderAdapter = {
  providerId: string
  recommendedModelId: string
  generateText(args: {
    secret: string
    config: unknown
    input: GenerateTextInput
  }): Promise<ModelProviderAdapterResult>
}
