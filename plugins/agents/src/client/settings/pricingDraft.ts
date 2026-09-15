import {
  claudePriceCatalog,
  codexPriceCatalog,
  validateAgentPricingPreferences,
  type AgentModelPrice,
  type AgentPricingPreferences,
} from '../../shared/pricing'

export type AgentPriceField = keyof AgentModelPrice
export type AgentPriceDraft = Record<AgentPriceField, string>

export type AgentPricingCatalogDraft = {
  catalogId: string
  overridden: boolean
  price: AgentPriceDraft
}

export type AgentPricingCustomDraft = {
  id: string
  model: string
  price: AgentPriceDraft
}

export type AgentPricingProvider = 'claude' | 'codex'

export type AgentPricingProviderDraft = {
  catalog: AgentPricingCatalogDraft[]
  customModels: AgentPricingCustomDraft[]
}

export type AgentPricingDraft = Record<AgentPricingProvider, AgentPricingProviderDraft>

export const blankAgentPriceDraft = (): AgentPriceDraft => ({
  input: '',
  output: '',
  cacheWrite: '',
  cacheRead: '',
})

const priceDraft = (price: AgentModelPrice): AgentPriceDraft => ({
  input: String(price.input),
  output: String(price.output),
  cacheWrite: String(price.cacheWrite),
  cacheRead: String(price.cacheRead),
})

const numberPrice = (price: AgentPriceDraft): AgentModelPrice => ({
  input: price.input.trim() === '' ? Number.NaN : Number(price.input),
  output: price.output.trim() === '' ? Number.NaN : Number(price.output),
  cacheWrite: price.cacheWrite.trim() === '' ? Number.NaN : Number(price.cacheWrite),
  cacheRead: price.cacheRead.trim() === '' ? Number.NaN : Number(price.cacheRead),
})

export function pricingDraftFromPreferences(
  preferences: AgentPricingPreferences,
  at = Date.now(),
): AgentPricingDraft {
  const providerDraft = (
    provider: AgentPricingProvider,
    catalog: typeof claudePriceCatalog,
  ): AgentPricingProviderDraft => ({
    catalog: catalog.map((entry) => {
      const override = preferences[provider].overrides.find((candidate) => candidate.catalogId === entry.id)
      return {
        catalogId: entry.id,
        overridden: !!override,
        price: priceDraft(override?.price ?? entry.defaultPrice(at)),
      }
    }),
    customModels: preferences[provider].customModels.map((entry, index) => ({
      id: `saved:${index}:${entry.model}`,
      model: entry.model,
      price: priceDraft(entry.price),
    })),
  })
  return {
    claude: providerDraft('claude', claudePriceCatalog),
    codex: providerDraft('codex', codexPriceCatalog),
  }
}

export function preferencesFromPricingDraft(
  draft: AgentPricingDraft,
): ReturnType<typeof validateAgentPricingPreferences> {
  return validateAgentPricingPreferences({
    version: 1,
    ...Object.fromEntries((['claude', 'codex'] as const).map((provider) => [provider, {
      overrides: draft[provider].catalog
        .filter((entry) => entry.overridden)
        .map((entry) => ({ catalogId: entry.catalogId, price: numberPrice(entry.price) })),
      customModels: draft[provider].customModels.map((entry) => ({
        model: entry.model,
        price: numberPrice(entry.price),
      })),
    }])),
  })
}
