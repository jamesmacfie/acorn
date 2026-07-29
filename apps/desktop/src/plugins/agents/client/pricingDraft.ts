import {
  claudePriceCatalog,
  validateAgentPricingPreferences,
  type AgentModelPrice,
  type AgentPricingPreferences,
} from '../shared/pricing'

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

export type AgentPricingDraft = {
  catalog: AgentPricingCatalogDraft[]
  customModels: AgentPricingCustomDraft[]
}

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
  return {
    catalog: claudePriceCatalog.map((entry) => {
      const override = preferences.claude.overrides.find((candidate) => candidate.catalogId === entry.id)
      return {
        catalogId: entry.id,
        overridden: !!override,
        price: priceDraft(override?.price ?? entry.defaultPrice(at)),
      }
    }),
    customModels: preferences.claude.customModels.map((entry, index) => ({
      id: `saved:${index}:${entry.model}`,
      model: entry.model,
      price: priceDraft(entry.price),
    })),
  }
}

export function preferencesFromPricingDraft(
  draft: AgentPricingDraft,
): ReturnType<typeof validateAgentPricingPreferences> {
  return validateAgentPricingPreferences({
    version: 1,
    claude: {
      overrides: draft.catalog
        .filter((entry) => entry.overridden)
        .map((entry) => ({ catalogId: entry.catalogId, price: numberPrice(entry.price) })),
      customModels: draft.customModels.map((entry) => ({
        model: entry.model,
        price: numberPrice(entry.price),
      })),
    },
  })
}
