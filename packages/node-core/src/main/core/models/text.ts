import type { AvailableModelConnection } from '@acorn/protocol/modelProviders.ts'
import { availableModelConnections } from '@acorn/protocol/modelProviders.ts'
import type { SecretService } from '../security/secrets'
import type { AppDatabase } from '../../../server/db'
import { connectionSummary, listConnections } from '../../../server/integrations/connections'
import { connectionProviderRegistry } from '../../../server/integrations/connectionRegistry'
import { generateTextForConnection, type GenerateTextForConnectionArgs } from '../../../server/modelProviders/runtime'
import type { GenerateTextResult } from '../../../server/modelProviders/types'

// Everything except the two bindings core supplies for itself.
export type GenerateTextRequest = Omit<GenerateTextForConnectionArgs, 'db' | 'secrets'>

export type ModelService = {
  // Throws ProviderOperationError with the status the caller should surface (404 not connected, 401
  // needs auth, 400 bad config, 502 unavailable) — the plugin route maps it, as it already did.
  generateText(request: GenerateTextRequest): Promise<GenerateTextResult>
  // The read half of the same seam: which connections this owner could generate WITH.
  //
  // It exists because a plugin that generates text has to be able to offer a picker, and a loaded
  // plugin's frame cannot get one any other way — `/v2/core/integrations` has no bridge scope, and
  // inventing one would hand every installed plugin the whole connection roster (including providers
  // that have nothing to do with models) to serve one dropdown. This returns only connected
  // model-providers with text generation available, and never a credential: the plugin gets ids and
  // labels, and core still resolves the key inside `generateText`.
  available(userId: string): Promise<AvailableModelConnection[]>
}

export function createModelService(db: AppDatabase, secrets: SecretService): ModelService {
  return {
    generateText: (request) => generateTextForConnection({ ...request, db, secrets }),
    available: async (userId) => {
      const rows = await listConnections(db, userId)
      // The same projection `/v2/core/integrations` serves and the same filter the renderer applies,
      // called rather than restated so a plugin's picker and the shell's cannot disagree about what
      // "available" means.
      return availableModelConnections({
        providers: connectionProviderRegistry.list().map((provider) => provider.toPublic()),
        integrations: rows.map(connectionSummary),
      })
    },
  }
}
