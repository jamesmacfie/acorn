export type IntegrationProviderKind =
  | 'identity'
  | 'issue-tracker'
  | 'error-tracker'
  | 'doc-system'
  | 'observability'
  | 'model-provider'
  | 'generic'

export type IntegrationAuthKind = 'github-session' | 'api-key' | 'oauth' | 'installation' | 'none'
export type IntegrationConnectionStatus = 'connected' | 'needs-auth' | 'degraded' | 'disabled'
export type ProviderErrorCode =
  | 'provider_not_connected'
  | 'provider_needs_auth'
  | 'provider_missing_scope'
  | 'provider_rate_limited'
  | 'provider_unavailable'
  | 'provider_resource_not_found'
  | 'provider_resource_deleted'
  | 'provider_resource_forbidden'
  | 'provider_bad_config'
  | 'provider_secret_unreadable'

export type CapabilityState = 'available' | 'missing-scope' | 'degraded'
export type ProviderCapabilities = Record<string, boolean | string | undefined> & {
  browse?: boolean
  linkExisting?: boolean
  promoteToTask?: boolean
  comments?: 'none' | 'read' | 'write'
  statusMutation?: boolean
  assignment?: boolean
  branchSuggestion?: boolean
  repoAffinity?: 'intrinsic' | 'project' | 'workspace' | 'none'
  contextFormat?: boolean
  webhooks?: boolean
  userFeed?: boolean
  textGeneration?: boolean
}

export type CredentialField = {
  id: string
  label: string
  type: 'password' | 'text' | 'url'
  placeholder?: string
  hint?: string
  required: boolean
}

export type ProviderAccountRef = { id: string; label: string; type?: string }

export type ModelCatalogEntry = { id: string; label: string }

export type ExternalRef = {
  providerId: string
  connectionId: string
  displayId: string
  externalId?: string
  url?: string
  locator?: Record<string, string>
}

export type PublicIntegrationProvider = {
  id: string
  label: string
  kind: IntegrationProviderKind
  glyph: string
  connection: {
    authKind: IntegrationAuthKind
    fields: CredentialField[]
    connectable: boolean
    disconnectable: boolean
    maxConnections?: number
  }
  capabilities: ProviderCapabilities
  models?: ModelCatalogEntry[]
  defaultModelId?: string
}

export type IntegrationPaneIntent =
  | { type: 'show-ref'; ref: ExternalRef }
  | { type: 'show-comment'; ref: ExternalRef; commentId: string }
  | { type: 'compose-comment'; ref: ExternalRef; quotedText?: string }

export type ProviderBudgets = {
  maxConcurrentRequests: number
  maxConcurrentRequestsPerConnection: number
  maxPages: number
  maxCachedItemBytes: number
  maxContextItems: number
  backoffFloorMs: number
  maxResolutionBatch: number
}

export type MemoryEvidencePolicy = {
  linkedItems: boolean
  mutations: string[]
  triggers: string[]
  summarize: 'context-formatter' | 'none'
  acceptedWrites: false
}
