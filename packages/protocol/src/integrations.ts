export type IntegrationProviderKind =
  | 'identity'
  | 'issue-tracker'
  | 'error-tracker'
  | 'doc-system'
  | 'observability'
  | 'model-provider'
  | 'generic'

// 'github-session' is gone: it described GitHub's token being the login session itself, which stopped
// being true when GitHub became an ordinary stored connection (it is 'oauth' now, like any other).
export type IntegrationAuthKind = 'api-key' | 'oauth' | 'installation' | 'none'
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
  // The stored credential is a 1Password reference and this node could not turn it into a value.
  // One code for every cause: op missing, the switch off, the prompt declined, the item gone. The
  // reader does the same thing in all four, which is open Settings, Security, and read what is
  // actually wrong there. A wire code cannot stay that current.
  | 'provider_secret_ref_unreadable'

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

// The named capabilities above, without the index signature's `string`. Derived rather than written
// out twice, so adding a capability above is the only edit. A contribution that gates on a provider
// capability takes this, not a bare string.
export type ProviderCapabilityName = keyof {
  [K in keyof ProviderCapabilities as string extends K ? never : number extends K ? never : K]: 0
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
    // How the settings UI obtains the credential, which is a different question from `authKind` (what
    // the credential is). 'fields' renders the descriptor's form: the default, and what every provider
    // but one does. 'device-flow' means the owner supplies nothing by hand: the node fetches a code
    // from the provider, the owner approves it in a browser, and `fields` is legitimately empty.
    //
    // Defaulted rather than required so adding this did not touch five providers to say "as before".
    kind?: 'fields' | 'device-flow'
    fields: CredentialField[]
    connectable: boolean
    disconnectable: boolean
    maxConnections?: number
  }
  capabilities: ProviderCapabilities
  // Whether this provider can enumerate a connection's projects, so core's workspace picker knows
  // which connections it may ask (`GET /v2/core/integrations/:id/projects`). Absent means no, and a
  // provider with nothing to enumerate is meant to be absent from the picker rather than present and
  // empty. Not in `capabilities`: that map describes what a connection was granted after validation,
  // this is a fact about the provider's contribution.
  supportsProjects?: boolean
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
