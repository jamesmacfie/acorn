import type { Integration } from '@acorn/protocol/api.ts'
import { connectionProviderRegistry, type ConnectionProviderRegistry } from './connectionProviders/registry'

export type CapabilityConnection = {
  provider: string
  capabilities: string
}

const json = <T>(raw: string, fallback: T): T => {
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export const resolvedConnectionCapabilities = (
  row: CapabilityConnection,
  providers: Pick<ConnectionProviderRegistry, 'get'> = connectionProviderRegistry,
): Integration['capabilities'] => {
  const declared = providers.get(row.provider)?.capabilities ?? {}
  const defaults = Object.fromEntries(
    Object.entries(declared)
      .filter(([, value]) => value !== false && value !== undefined && value !== 'none')
      .map(([capability]) => [capability, 'available' as const]),
  )
  return { ...defaults, ...json(row.capabilities, {}) }
}

export const connectionHasCapability = (
  row: CapabilityConnection,
  capability: string,
  providers: Pick<ConnectionProviderRegistry, 'get'> = connectionProviderRegistry,
): boolean => resolvedConnectionCapabilities(row, providers)[capability] === 'available'
