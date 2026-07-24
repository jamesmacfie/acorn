import type {
  ConnectionContract,
  ConnectionProviderContribution,
  ConnectionProviderDefinition,
  IntegrationProviderContribution,
  IntegrationProviderDefinition,
  TypedConnectionContract,
} from '../types'
import type { CredentialField, ExternalRef } from '../../../shared/integrations'
import { isRecord } from '../codec'

const publicCredentialField = (field: CredentialField): CredentialField => ({
  id: field.id,
  label: field.label,
  type: field.type,
  required: field.required,
  ...(field.placeholder === undefined ? {} : { placeholder: field.placeholder }),
  ...(field.hint === undefined ? {} : { hint: field.hint }),
})

const eraseConnectionValidation = <TValidated>(
  connection: TypedConnectionContract<TValidated>,
): ConnectionContract => ({
  ...connection,
  validate: connection.validate,
  normalize: (credentials, validated) => connection.normalize(credentials, validated as TValidated),
})

export const publicConnectionProvider = <TValidated>(
  provider: ConnectionProviderDefinition<TValidated>,
): ConnectionProviderContribution => {
  const connection = eraseConnectionValidation(provider.connection)
  return {
    ...provider,
    connection,
    toPublic: () => ({
      id: provider.id,
      label: provider.label,
      kind: provider.kind,
      glyph: provider.glyph,
      connection: {
        authKind: connection.authKind,
        fields: connection.fields.map(publicCredentialField),
        connectable: connection.connectable,
        disconnectable: connection.disconnectable,
        ...(connection.maxConnections === undefined ? {} : { maxConnections: connection.maxConnections }),
      },
      capabilities: provider.capabilities,
    }),
  }
}

export const publicProvider = <TValidated>(
  provider: IntegrationProviderDefinition<TValidated>,
): IntegrationProviderContribution => {
  const connectionProvider = publicConnectionProvider(provider)
  return {
    ...provider,
    connection: connectionProvider.connection,
    toPublic: connectionProvider.toPublic,
  }
}

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
