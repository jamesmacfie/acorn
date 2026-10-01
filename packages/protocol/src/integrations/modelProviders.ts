import type { IntegrationsResponse } from '../transport/api'
import type { ModelCatalogEntry } from './providers'

/**
 * One thing a Generate control can spend: a stored API key, or an agent CLI installed on this machine.
 *
 * Flat, and deliberately narrow. A connection's auth kind, scopes, account and timestamps do not
 * cross: no consumer reads them, and a harness has none of them. A caller that wants the connection
 * row itself still has `/v1/core/integrations`.
 */
export type ModelBackend = {
  /**
   * `connection:<uuid>` or `harness:<profileId>`. Core mints it and core parses it.
   *
   * Ids reach saved workflow steps and device prefs, so a profile id rename is a compatibility break —
   * the same rule docs/managed-agents.md § Harnesses states for harness ids.
   */
  id: string
  kind: 'connection' | 'harness'
  label: string
  /** A Lucide name or a `brand:` mark, for the surfaces that draw one. The picker is two selects and draws none. */
  glyph?: string
  /** May be empty. A harness with a failed catalog read can still offer the CLI default. */
  models: ModelCatalogEntry[]
  /** A live CLI catalog could not be refreshed. Keep an explicit saved model until it can be checked. */
  catalogUnavailable?: boolean
  /** `''` lets a harness use its CLI's configured default. */
  defaultModelId: string
}

// The two prefixes, exported so the side that mints an id and the side that reads one cannot drift.
export const CONNECTION_BACKEND_PREFIX = 'connection:'
export const HARNESS_BACKEND_PREFIX = 'harness:'

export type ParsedBackendId = { kind: ModelBackend['kind']; id: string }

/**
 * Which store a backend id names, and the id inside it.
 */
export const parseBackendId = (backendId: string): ParsedBackendId => {
  const value = backendId.trim()
  if (value.startsWith(HARNESS_BACKEND_PREFIX)) {
    const id = value.slice(HARNESS_BACKEND_PREFIX.length).trim()
    if (id) return { kind: 'harness', id }
  }
  if (value.startsWith(CONNECTION_BACKEND_PREFIX)) {
    const id = value.slice(CONNECTION_BACKEND_PREFIX.length).trim()
    if (id) return { kind: 'connection', id }
  }
  throw new Error('Backend ID must be connection:<id> or harness:<id>.')
}

/**
 * The connection half of the backend list: connected model providers with text generation available,
 * projected to ids and labels.
 *
 * The harness half is built in the node, because "is this CLI on PATH" is a question only the node can
 * answer (packages/node-core/src/server/modelProviders/harnessRuntime.ts). Connections come first in
 * the assembled list, so the palette fast path and the silent fallback keep spending the key the owner
 * configured on purpose; a CLI is picked for someone only when there is no key at all.
 */
export const availableModelConnections = (response: IntegrationsResponse): ModelBackend[] => {
  const providers = new Map(
    response.providers
      .filter((provider) => provider.kind === 'model-provider')
      .map((provider) => [provider.id, provider]),
  )

  return response.integrations.flatMap((connection) => {
    const provider = providers.get(connection.providerId)
    return provider &&
      connection.status === 'connected' &&
      connection.capabilities.textGeneration === 'available'
      ? [{
          id: `${CONNECTION_BACKEND_PREFIX}${connection.id}`,
          kind: 'connection' as const,
          label: connection.label || provider.label,
          ...(provider.glyph ? { glyph: provider.glyph } : {}),
          models: provider.models ?? [],
          defaultModelId: provider.defaultModelId ?? '',
        }]
      : []
  })
}

/**
 * Which model a backend starts on: a harness's CLI default, or a connection's declared or first model.
 *
 * Here rather than beside the picker that used to hold it, because two sides now need the same answer
 * and neither may import the other. The desktop's picker opens on it, and the Database plugin's node
 * half chooses it when the palette's `Generate SQL` generates with no picker at all — so the fast path
 * and the modal start on the same model by construction (docs/database.md § From the command palette,
 * step 3).
 *
 * `''` when the backend declares neither, which is a real answer: the caller omits the model and the
 * backend falls back to its own recommendation — an adapter's for a connection, the CLI's own
 * configured default for a harness.
 */
export const defaultModelIdFor = (backend: ModelBackend | undefined): string =>
  backend?.kind === 'harness' ? backend.defaultModelId : backend?.defaultModelId || backend?.models[0]?.id || ''

/** What `GET /v1/core/models/backends` answers. */
export type ModelBackendsResponse = {
  backends: ModelBackend[]
  /**
   * Every harness that declares a one-shot mode whose command is not on this machine. The wizard draws
   * these as "not found on this machine"; nothing else reads it.
   */
  missing: Array<{ id: string; label: string }>
}
