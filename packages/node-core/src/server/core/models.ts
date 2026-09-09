import type { ModelBackend } from '@acorn/protocol/modelProviders.ts'
import { availableModelConnections, parseBackendId } from '@acorn/protocol/modelProviders.ts'
import type { SecretService } from './secrets'
import type { AppDatabase } from '../db'
import { connectionSummary, listConnections } from '../integrations/connections'
import { connectionProviderRegistry } from '../integrations/connectionRegistry'
import { generateTextForConnection } from '../modelProviders/runtime'
import { generateTextForHarness, harnessBackends } from '../modelProviders/harnessRuntime'
import type { GenerateTextInput, GenerateTextResult } from '../modelProviders/types'

export type GenerateTextRequest = {
  userId: string
  // `connection:<uuid>`, `harness:<profileId>`, or a bare uuid from before core minted these ids.
  backendId: string
  input: GenerateTextInput
  timeoutMs?: number
}

export type ModelService = {
  // Throws ProviderOperationError with the status the caller should surface: 404 not connected, 401
  // needs auth, 400 bad config, 502 unavailable.
  generateText(request: GenerateTextRequest): Promise<GenerateTextResult>
  // The read half of the same seam: which backends this owner could generate with — a stored API key,
  // or an agent CLI installed on this machine.
  //
  // A plugin that generates text has to offer a picker, and its frame cannot get one any other way.
  // `/v2/core/integrations` has no bridge scope, and adding one would hand every installed plugin
  // the whole connection roster to serve one dropdown. This returns ids and labels only. Core still
  // resolves the key, or the command, inside `generateText`.
  available(userId: string): Promise<ModelBackend[]>
}

export function createModelService(db: AppDatabase, secrets: SecretService): ModelService {
  return {
    generateText: ({ backendId, ...request }) => {
      const backend = parseBackendId(backendId)
      return backend.kind === 'harness'
        ? generateTextForHarness({ profileId: backend.id, input: request.input, ...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {}) })
        : generateTextForConnection({ ...request, connectionId: backend.id, db, secrets })
    },
    available: async (userId) => {
      const rows = await listConnections(db, userId)
      // The projection `/v2/core/integrations` serves, called rather than restated so a plugin's
      // picker and the shell's agree on what "available" means.
      const connections = availableModelConnections({
        providers: connectionProviderRegistry.list().map((provider) => provider.toPublic()),
        integrations: rows.map(connectionSummary),
      })
      // Connections first, in the order they already came in, then the installed CLIs in registry
      // order. The palette fast path and the changes plugin's silent fallback both take `[0]`, and
      // they must keep spending the key the owner configured on purpose; a CLI is chosen for someone
      // only when there is no key at all, which is the lock-out this list exists to fix.
      //
      // No cache. `which` costs milliseconds, and the list is read when a dialog opens.
      return [...connections, ...(await harnessBackends()).backends]
    },
  }
}
