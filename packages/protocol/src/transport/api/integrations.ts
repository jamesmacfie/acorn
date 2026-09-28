import type { IntegrationAuthKind, IntegrationConnectionStatus, ProviderAccountRef, ProviderErrorCode, PublicIntegrationProvider } from '../../integrations/providers.ts'

// Integrations allow multiple connections per provider (docs/integrations.md). GitHub appears as a
// synthesized row while its encrypted token stays with the node's active provider credential.
export type IntegrationProvider = string
export type Integration = {
  id: string // 'github' for the synthesized entry; opaque uuid otherwise
  providerId: IntegrationProvider
  // Seeded from the provider, rewritten on every rotate. Read `name` first when showing a connection
  // to someone: use `connectionName` rather than either field on its own.
  label: string
  // What the owner called this connection. Absent until they rename it, which is why every surface
  // has to fall back to `label`.
  name?: string
  status: IntegrationConnectionStatus
  authKind: IntegrationAuthKind
  account: ProviderAccountRef | null
  scopes: string[]
  capabilities: Record<string, 'available' | 'missing-scope' | 'degraded'>
  createdAt: number
  updatedAt: number
  lastValidatedAt?: number
  lastError?: ProviderErrorCode
}
export type IntegrationsResponse = { providers: PublicIntegrationProvider[]; integrations: Integration[] }
// Credential values are write-only: the response contains only the normalized connection summary.
export type ConnectIntegrationRequest = { providerId: IntegrationProvider; credentials: Record<string, string> }
export type RotateIntegrationRequest = { credentials: Record<string, string> }

// The same links read and written from the connection's side rather than a workspace's, which is how
// Settings shows one integration's whole map at once (docs/integrations.md § Project sources).
export type IntegrationMapping = { workspaceId: string; externalId: string; projectId?: string }
export type IntegrationMappingsResponse = { mappings: IntegrationMapping[] }
// The projects one connection offers, for core's workspace picker. `id` is what a chosen row's
// `externalId` becomes; `label` is display-only and already bounded by the node
// (integrations/projectSource.ts). The provider that produced it is not the authority on either.
export type IntegrationProject = { id: string; label: string }
export type IntegrationProjectsResponse = { projects: IntegrationProject[] }

export const integrationsRoute = '/v1/core/integrations'
export const integrationRoute = (id: string) => `/v1/core/integrations/${id}`
export const integrationTestRoute = (id: string) => `/v1/core/integrations/${id}/test`
export const integrationProjectsRoute = (id: string) => `/v1/core/integrations/${id}/projects`
export const integrationMappingsRoute = (id: string) => `/v1/core/integrations/${id}/mappings`
// The read half of the model seam: every backend a Generate control can spend, which is every
// connected key plus every agent CLI installed on this machine (@acorn/protocol/modelProviders.ts § ModelBackend).
// Device-only. A plugin frame reads its own plugin's proxy route instead, because `/v1/core/*` has no
// bridge scope (docs/integrations.md § Model providers).
export const modelBackendsRoute = '/v1/core/models/backends'

// v3 adds descriptor metadata and normalized connection summaries. A distinct key stops a persisted v2
// `{ provider, connected }` row from hiding registry-driven sources and settings.
export const integrationsKey = ['integrations', 'v3'] as const
// The suffix gives a future response-shape change its own persisted cache key.
export const modelBackendsKey = ['model-backends', 'v1'] as const
