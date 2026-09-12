import {
  availableModelConnections,
  HARNESS_BACKEND_PREFIX,
  type AvailableModelConnection,
} from '@acorn/protocol/modelProviders.ts'
import type { SecretService } from '../security/secrets'
import type { AppDatabase } from '../../../server/db'
import { connectionSummary, listConnections } from '../../../server/integrations/connections'
import { connectionProviderRegistry } from '../../../server/integrations/connectionRegistry'
import { generateTextForConnection, type GenerateTextForConnectionArgs } from '../../../server/modelProviders/runtime'
import { generateTextForHarness } from '../../../server/modelProviders/harnessRuntime'
import type { GenerateTextResult } from '../../../server/modelProviders/types'

// Everything except the two bindings core supplies for itself.
export type GenerateTextRequest = Omit<GenerateTextForConnectionArgs, 'db' | 'secrets'>

export type ModelService = {
  // Throws ProviderOperationError with the status the caller should surface: 404 not connected, 401
  // needs auth, 400 bad config, 502 unavailable.
  generateText(request: GenerateTextRequest): Promise<GenerateTextResult>
  // The read half of the same seam: which connections this owner could generate with.
  //
  // A plugin that generates text has to offer a picker, and its frame cannot get one any other way.
  // `/v2/core/integrations` has no bridge scope, and adding one would hand every installed plugin
  // the whole connection roster to serve one dropdown. This returns connected model providers with
  // text generation available, ids and labels only. Core still resolves the key inside
  // `generateText`.
  available(userId: string): Promise<AvailableModelConnection[]>
}

export function createModelService(db: AppDatabase, secrets: SecretService): ModelService {
  return {
    generateText: (request) => request.connectionId.startsWith(HARNESS_BACKEND_PREFIX)
      ? generateTextForHarness({
          profileId: request.connectionId.slice(HARNESS_BACKEND_PREFIX.length),
          input: request.input,
          ...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {}),
        })
      : generateTextForConnection({ ...request, db, secrets }),
    available: async (userId) => {
      const rows = await listConnections(db, userId)
      // The projection `/v2/core/integrations` serves, called rather than restated so a plugin's
      // picker and the shell's agree on what "available" means.
      return availableModelConnections({
        providers: connectionProviderRegistry.list().map((provider) => provider.toPublic()),
        integrations: rows.map(connectionSummary),
      })
    },
  }
}
