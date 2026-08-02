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
  connectionId: string
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
