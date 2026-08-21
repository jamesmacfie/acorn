// Rollbar's wire contract (docs/integrations.md): deduped error items mirrored into `issues`. Types,
// route builders, and query keys live here, not in `@acorn/protocol` (docs/architecture-overview.md:
// a plugin owns the shape of its own wire surface). Route strings and query keys are unchanged from
// the old @acorn/protocol/api.ts version, since a changed key orphans a user's persisted cache
// (docs/caching.md).
//
// The list row (summary) and the detail differ: detail adds a normalized, privacy-safe view of the
// latest occurrence. Raw upstream occurrence JSON never crosses this boundary (docs/security.md).
export type RollbarItemSummary = {
  integrationId: string
  integrationLabel: string
  identifier: string // the project-visible counter ('142')
  itemId: string // system-wide item id, a string at Acorn boundaries ('' when a legacy row predates it)
  url: string | null // Rollbar's account-independent item permalink
  title: string
  level: string
  environment: string
  status: string
  totalOccurrences: number
  firstOccurrenceAt: number | null
  lastOccurrenceAt: number | null
  framework?: string
  // Optional (like framework) so cached pre-widening rows stay valid: absent until the next list refresh.
  lastActivatedAt?: number | null // later than firstOccurrenceAt ⇒ the item regressed after a resolve
  uniqueOccurrences?: number // distinct-IP count; plan-dependent upstream
}

export type RollbarStackFrame = {
  filename: string
  line: number | null
  column: number | null
  method: string | null
  code: Array<{ line: number; text: string }>
  inProject: boolean | null
}

export type RollbarOccurrenceDetail = {
  id: string
  occurredAt: number | null
  uuid: string | null
  url: string | null // UUID redirect; null only when an upstream occurrence omitted its UUID
  kind: 'trace' | 'trace-chain' | 'message' | 'crash-report' | 'unknown'
  exceptionClass: string | null
  message: string | null
  frames: RollbarStackFrame[]
  request: { method: string | null; url: string | null } | null
  context: string | null
  environment: string | null
  codeVersion: string | null
  platform: string | null
  language: string | null
  framework: string | null
  server: { host: string | null; branch: string | null } | null
  person: { id: string | null; username: string | null; email: string | null } | null
  notifier: { name: string | null; version: string | null } | null
  truncated: boolean
}

export type RollbarItemMetadata = RollbarItemSummary & {
  resolvedInVersion: string | null
  assignedTo: string | null
}

// Person is flattened to the username only: list rows never carry emails into the cache.
export type RollbarOccurrenceSummary = Pick<
  RollbarOccurrenceDetail,
  'id' | 'occurredAt' | 'uuid' | 'url' | 'kind' | 'exceptionClass' | 'message' | 'environment' | 'codeVersion' | 'request'
> & { personUsername: string | null }

export type RollbarOccurrencesResponse = {
  occurrences: RollbarOccurrenceSummary[]
  capped: boolean
}

// Compatibility composite for the public automation API. The desktop pane uses the independently
// cached metadata / occurrence-list / occurrence-detail routes below so inactive tabs do no work.
export type RollbarItemDetail = RollbarItemMetadata & {
  latestOccurrence: RollbarOccurrenceDetail | null
}

// List responses admit partial success: a connection can fail or return the capped set while others
// succeed. The UI must not turn a transport/auth failure into "no active items".
export type RollbarItemsResponse = {
  items: RollbarItemSummary[]
  failures: Array<{ integrationId: string; code: string }>
  cappedIntegrationIds: string[]
}
export const rollbarItemsRoute = '/v2/p/rollbar/items'
export const rollbarItemsForConnectionsRoute = (integrationIds: readonly string[]) =>
  `${rollbarItemsRoute}?integrations=${encodeURIComponent([...new Set(integrationIds)].sort().join(','))}`
export const rollbarItemRoute = (integrationId: string, identifier: string, refresh = false) =>
  `/v2/p/rollbar/items/${encodeURIComponent(identifier)}?integration=${encodeURIComponent(integrationId)}${refresh ? '&refresh=true' : ''}`
export const rollbarItemMetadataRoute = (integrationId: string, identifier: string, refresh = false) =>
  `/v2/p/rollbar/items/${encodeURIComponent(identifier)}/detail?integration=${encodeURIComponent(integrationId)}${refresh ? '&refresh=true' : ''}`
export const rollbarOccurrencesRoute = (integrationId: string, identifier: string, refresh = false) =>
  `/v2/p/rollbar/items/${encodeURIComponent(identifier)}/occurrences?integration=${encodeURIComponent(integrationId)}${refresh ? '&refresh=true' : ''}`
export const rollbarOccurrenceRoute = (integrationId: string, identifier: string, occurrenceId: string, refresh = false) =>
  `/v2/p/rollbar/items/${encodeURIComponent(identifier)}/occurrences/${encodeURIComponent(occurrenceId)}?integration=${encodeURIComponent(integrationId)}${refresh ? '&refresh=true' : ''}`
export const rollbarItemsKey = (integrationIds: readonly string[]) =>
  ['rollbar-items', 'connections', ...[...new Set(integrationIds)].sort()] as const
export const rollbarItemKey = (integrationId: string, identifier: string) => ['rollbar-item', integrationId, identifier] as const
export const rollbarItemMetadataKey = (integrationId: string, identifier: string) => ['rollbar-item-metadata', integrationId, identifier] as const
export const rollbarOccurrencesKey = (integrationId: string, identifier: string) => ['rollbar-occurrences', integrationId, identifier] as const
export const rollbarOccurrenceKey = (integrationId: string, identifier: string, occurrenceId: string) =>
  ['rollbar-occurrence', integrationId, identifier, occurrenceId] as const
