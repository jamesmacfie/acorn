import type { IntegrationProviderContribution } from '../types'
import type { ExternalRef } from '../../../shared/integrations'
import { isRecord } from '../codec'

export const publicProvider = (provider: Omit<IntegrationProviderContribution, 'toPublic'>): IntegrationProviderContribution => ({
  ...provider,
  toPublic: () => ({
    id: provider.id,
    label: provider.label,
    kind: provider.kind,
    glyph: provider.glyph,
    connection: {
      authKind: provider.connection.authKind,
      fields: provider.connection.fields,
      connectable: provider.connection.connectable,
      disconnectable: provider.connection.disconnectable,
    },
    capabilities: provider.capabilities,
  }),
})

export const defaultBudgets = {
  maxConcurrentRequests: 8,
  maxConcurrentRequestsPerConnection: 3,
  maxPages: 5,
  maxCachedItemBytes: 256_000,
  maxContextItems: 50,
  backoffFloorMs: 60_000,
  maxResolutionBatch: 50,
} as const

export const externalIdsFor = (providerId: string) => ({
  fromDisplay: (connectionId: string, displayId: string): ExternalRef => ({ providerId, connectionId, displayId }),
  parse(raw: unknown, fallback: ExternalRef): ExternalRef | null {
    if (!isRecord(raw)) return fallback
    if (raw.providerId !== providerId || typeof raw.connectionId !== 'string' || typeof raw.displayId !== 'string') return null
    if (raw.locator !== undefined && (!isRecord(raw.locator) || Object.values(raw.locator).some((value) => typeof value !== 'string'))) return null
    return {
      providerId,
      connectionId: raw.connectionId,
      displayId: raw.displayId,
      externalId: typeof raw.externalId === 'string' ? raw.externalId : undefined,
      url: typeof raw.url === 'string' ? raw.url : undefined,
      locator: raw.locator as Record<string, string> | undefined,
    }
  },
})
