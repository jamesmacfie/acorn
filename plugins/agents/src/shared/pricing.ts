export const agentPricingRoute = '/v2/p/agents/pricing'
export const agentPricingPreferenceKey = 'agents:pricing:v1'

const MAX_CUSTOM_MODELS = 100
const MAX_PRICE_PER_MILLION = 1_000_000

export type AgentModelPrice = {
  input: number
  output: number
  cacheWrite: number
  cacheRead: number
}

export type AgentPricingOverride = {
  catalogId: string
  price: AgentModelPrice
}

export type AgentCustomModelPrice = {
  model: string
  price: AgentModelPrice
}

export type AgentPricingProviderPreferences = {
  overrides: AgentPricingOverride[]
  customModels: AgentCustomModelPrice[]
}

export type AgentPricingPreferences = {
  version: 1
  claude: AgentPricingProviderPreferences
  codex: AgentPricingProviderPreferences
}

export type AgentPriceCatalogEntry = {
  id: string
  label: string
  models: string
  matches(model: string): boolean
  defaultPrice(at: number): AgentModelPrice
}

const fixedPrice = (price: AgentModelPrice) => () => price
const matches = (pattern: RegExp) => (model: string) => pattern.test(model)

const OPUS_CURRENT = { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 }
const PREMIUM_FIVE = { input: 10, output: 50, cacheWrite: 12.5, cacheRead: 1 }

function sonnetFivePrice(at: number): AgentModelPrice {
  const standardStarts = new Date(2026, 8, 1).getTime()
  return at < standardStarts
    ? { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 }
    : { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 }
}

// Standard global API prices per million tokens. The catalog entries are agent-plugin data: the client
// renders them in settings and the node's collector resolves local Claude JSONL model ids through
// the same definitions.
export const claudePriceCatalog: readonly AgentPriceCatalogEntry[] = [
  {
    id: 'fable-5',
    label: 'Claude Fable 5',
    models: 'claude-fable-5',
    matches: matches(/^(?:claude-)?fable-?5(?:-|$)/i),
    defaultPrice: fixedPrice(PREMIUM_FIVE),
  },
  {
    id: 'mythos-5',
    label: 'Claude Mythos 5',
    models: 'claude-mythos-5',
    matches: matches(/^(?:claude-)?mythos-?5(?:-|$)/i),
    defaultPrice: fixedPrice(PREMIUM_FIVE),
  },
  {
    id: 'opus-5',
    label: 'Claude Opus 5',
    models: 'claude-opus-5',
    matches: matches(/^(?:claude-)?opus-?5(?:-|$)/i),
    defaultPrice: fixedPrice(OPUS_CURRENT),
  },
  {
    id: 'opus-4-current',
    label: 'Claude Opus 4.5–4.8',
    models: 'claude-opus-4-5 … claude-opus-4-8',
    matches: matches(/^(?:claude-)?opus-?4[-.]?(?:8|7|6|5)(?:-|$)/i),
    defaultPrice: fixedPrice(OPUS_CURRENT),
  },
  {
    id: 'opus-4-legacy',
    label: 'Claude Opus 4 / 4.1',
    models: 'claude-opus-4, claude-opus-4-1',
    matches: matches(/^(?:claude-)?opus-?4(?:[-.]?1)?(?:-|$)/i),
    defaultPrice: fixedPrice({ input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 }),
  },
  {
    id: 'sonnet-5',
    label: 'Claude Sonnet 5',
    models: 'claude-sonnet-5',
    matches: matches(/^(?:claude-)?sonnet-?5(?:-|$)/i),
    defaultPrice: sonnetFivePrice,
  },
  {
    id: 'sonnet-4',
    label: 'Claude Sonnet 4',
    models: 'claude-sonnet-4-*',
    matches: matches(/^(?:claude-)?sonnet-?4(?:-|$)/i),
    defaultPrice: fixedPrice({ input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 }),
  },
  {
    id: 'sonnet-3-5',
    label: 'Claude Sonnet 3.5',
    models: 'claude-3.5-sonnet-*',
    matches: matches(/^(?:claude-)?3[-.]?5-sonnet(?:-|$)/i),
    defaultPrice: fixedPrice({ input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 }),
  },
  {
    id: 'haiku-4-5',
    label: 'Claude Haiku 4.5',
    models: 'claude-haiku-4-5',
    matches: matches(/^(?:claude-)?haiku-?4[-.]?5(?:-|$)/i),
    defaultPrice: fixedPrice({ input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 }),
  },
  {
    id: 'haiku-3-5',
    label: 'Claude Haiku 3.5',
    models: 'claude-3.5-haiku-*',
    matches: matches(/^(?:claude-)?3[-.]?5-haiku(?:-|$)/i),
    defaultPrice: fixedPrice({ input: 0.8, output: 4, cacheWrite: 1, cacheRead: 0.08 }),
  },
]

// Standard OpenAI API prices per million tokens. A managed Codex session may be covered by a plan,
// credits or an enterprise agreement instead, so these values produce an API-equivalent estimate,
// never a claim about the user's invoice. Cache writes use the documented 1.25x input rate.
export const codexPriceCatalog: readonly AgentPriceCatalogEntry[] = [
  {
    id: 'gpt-6-astra',
    label: 'GPT-6 Astra',
    models: 'gpt-6-astra',
    matches: matches(/^gpt-6-astra(?:-|$)/i),
    defaultPrice: fixedPrice({ input: 10, output: 50, cacheWrite: 12.5, cacheRead: 1 }),
  },
  {
    id: 'gpt-5-6-terra',
    label: 'GPT-5.6 Terra',
    models: 'gpt-5.6-terra',
    matches: matches(/^gpt-5\.6-terra(?:-|$)/i),
    defaultPrice: fixedPrice({ input: 2, output: 12, cacheWrite: 2.5, cacheRead: 0.2 }),
  },
  {
    id: 'gpt-5-6-luna',
    label: 'GPT-5.6 Luna',
    models: 'gpt-5.6-luna',
    matches: matches(/^gpt-5\.6-luna(?:-|$)/i),
    defaultPrice: fixedPrice({ input: 0.2, output: 1.2, cacheWrite: 0.25, cacheRead: 0.02 }),
  },
  {
    id: 'gpt-5-6-sol',
    label: 'GPT-5.6 Sol',
    models: 'gpt-5.6, gpt-5.6-sol',
    matches: matches(/^gpt-5\.6(?:-sol)?(?:-|$)/i),
    defaultPrice: fixedPrice({ input: 4, output: 20, cacheWrite: 5, cacheRead: 0.4 }),
  },
]

export function emptyAgentPricingPreferences(): AgentPricingPreferences {
  return {
    version: 1,
    claude: { overrides: [], customModels: [] },
    codex: { overrides: [], customModels: [] },
  }
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readPrice(value: unknown, path: string, errors: string[]): AgentModelPrice | null {
  const object = asObject(value)
  if (!object) {
    errors.push(`${path} must contain token prices.`)
    return null
  }
  const fields: Array<keyof AgentModelPrice> = ['input', 'output', 'cacheWrite', 'cacheRead']
  const price = {} as AgentModelPrice
  for (const field of fields) {
    const amount = object[field]
    if (
      typeof amount !== 'number'
      || !Number.isFinite(amount)
      || amount < 0
      || amount > MAX_PRICE_PER_MILLION
    ) {
      errors.push(`${path}.${field} must be between 0 and ${MAX_PRICE_PER_MILLION}.`)
      continue
    }
    price[field] = amount
  }
  return fields.every((field) => typeof price[field] === 'number') ? price : null
}

export function validateAgentPricingPreferences(
  value: unknown,
): { ok: true; value: AgentPricingPreferences } | { ok: false; errors: string[] } {
  const root = asObject(value)
  if (!root || root.version !== 1) {
    return { ok: false, errors: ['Pricing settings must use version 1.'] }
  }
  const claude = asObject(root.claude)
  if (!claude) return { ok: false, errors: ['Claude pricing settings are required.'] }
  const errors: string[] = []
  const readProvider = (
    label: string,
    provider: Record<string, unknown> | null,
    catalog: readonly AgentPriceCatalogEntry[],
  ): AgentPricingProviderPreferences => {
    if (!provider || !Array.isArray(provider.overrides) || !Array.isArray(provider.customModels)) {
      errors.push(`${label} overrides and custom models must be lists.`)
      return { overrides: [], customModels: [] }
    }
    if (provider.customModels.length > MAX_CUSTOM_MODELS) {
      errors.push(`At most ${MAX_CUSTOM_MODELS} custom ${label} models can be saved.`)
    }
    const catalogIds = new Set(catalog.map((entry) => entry.id))
    const seenCatalogIds = new Set<string>()
    const overrides: AgentPricingOverride[] = []
    for (const [index, candidate] of provider.overrides.entries()) {
      const object = asObject(candidate)
      const catalogId = typeof object?.catalogId === 'string' ? object.catalogId : ''
      if (!catalogIds.has(catalogId)) errors.push(`${label} override ${index + 1} has an unknown catalog id.`)
      if (seenCatalogIds.has(catalogId)) errors.push(`${label} override ${index + 1} duplicates ${catalogId}.`)
      seenCatalogIds.add(catalogId)
      const price = readPrice(object?.price, `${label} override ${index + 1}`, errors)
      if (catalogIds.has(catalogId) && price) overrides.push({ catalogId, price })
    }

    const seenModels = new Set<string>()
    const customModels: AgentCustomModelPrice[] = []
    for (const [index, candidate] of provider.customModels.entries()) {
      const object = asObject(candidate)
      const model = typeof object?.model === 'string' ? object.model.trim() : ''
      const normalized = model.toLowerCase()
      if (!/^[a-z0-9][a-z0-9._:@/-]{0,199}$/i.test(model)) {
        errors.push(`${label} custom model ${index + 1} needs a valid model id.`)
      }
      if (seenModels.has(normalized)) errors.push(`${label} custom model ${index + 1} duplicates ${model}.`)
      seenModels.add(normalized)
      const price = readPrice(object?.price, `${label} custom model ${index + 1}`, errors)
      if (model && price) customModels.push({ model, price })
    }
    overrides.sort((left, right) => left.catalogId.localeCompare(right.catalogId))
    customModels.sort((left, right) => left.model.localeCompare(right.model))
    return { overrides, customModels }
  }

  const claudePricing = readProvider('Claude', claude, claudePriceCatalog)
  // Version 1 originally held Claude alone. An absent Codex block is an old valid value, not a reason
  // to throw away the owner's Claude overrides.
  const codexPricing = root.codex === undefined
    ? { overrides: [], customModels: [] }
    : readProvider('Codex', asObject(root.codex), codexPriceCatalog)

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, value: { version: 1, claude: claudePricing, codex: codexPricing } }
}

export function parseAgentPricingPreferences(raw: string | null | undefined): AgentPricingPreferences {
  if (!raw) return emptyAgentPricingPreferences()
  try {
    const parsed = validateAgentPricingPreferences(JSON.parse(raw) as unknown)
    return parsed.ok ? parsed.value : emptyAgentPricingPreferences()
  } catch {
    return emptyAgentPricingPreferences()
  }
}

export function agentPricingFingerprint(preferences: AgentPricingPreferences): string {
  return JSON.stringify(preferences)
}

export function claudeModelPrice(
  model: string,
  at = Date.now(),
  preferences: AgentPricingPreferences = emptyAgentPricingPreferences(),
): AgentModelPrice | null {
  const custom = preferences.claude.customModels.find(
    (entry) => entry.model.toLowerCase() === model.trim().toLowerCase(),
  )
  if (custom) return custom.price
  const catalog = claudePriceCatalog.find((entry) => entry.matches(model))
  if (!catalog) return null
  return preferences.claude.overrides.find((entry) => entry.catalogId === catalog.id)?.price
    ?? catalog.defaultPrice(at)
}

export function codexModelPrice(
  model: string,
  at = Date.now(),
  preferences: AgentPricingPreferences = emptyAgentPricingPreferences(),
): AgentModelPrice | null {
  const custom = preferences.codex.customModels.find(
    (entry) => entry.model.toLowerCase() === model.trim().toLowerCase(),
  )
  if (custom) return custom.price
  const catalog = codexPriceCatalog.find((entry) => entry.matches(model))
  if (!catalog) return null
  return preferences.codex.overrides.find((entry) => entry.catalogId === catalog.id)?.price
    ?? catalog.defaultPrice(at)
}

export function agentModelPrice(
  providerId: string,
  model: string,
  at = Date.now(),
  preferences: AgentPricingPreferences = emptyAgentPricingPreferences(),
): AgentModelPrice | null {
  if (providerId === 'claude') return claudeModelPrice(model, at, preferences)
  if (providerId === 'codex') return codexModelPrice(model, at, preferences)
  return null
}
