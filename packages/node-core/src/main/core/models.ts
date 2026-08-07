import type { SecretService } from './secrets'
import type { AppDatabase } from '../../server/db'
import { generateTextForConnection, type GenerateTextForConnectionArgs } from '../../server/modelProviders/runtime'
import type { GenerateTextResult } from '../../server/modelProviders/types'

// Everything except the two bindings core supplies for itself.
export type GenerateTextRequest = Omit<GenerateTextForConnectionArgs, 'db' | 'secrets'>

export type ModelService = {
  // Throws ProviderOperationError with the status the caller should surface (404 not connected, 401
  // needs auth, 400 bad config, 502 unavailable) — the plugin route maps it, as it already did.
  generateText(request: GenerateTextRequest): Promise<GenerateTextResult>
}

export function createModelService(db: AppDatabase, secrets: SecretService): ModelService {
  return {
    generateText: (request) => generateTextForConnection({ ...request, db, secrets }),
  }
}
