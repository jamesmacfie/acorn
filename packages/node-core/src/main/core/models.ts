// The model-generation seam (CoreServices.models). `generateTextForConnection` is core's — it resolves
// a stored `integrations` row, checks its status and capabilities, reveals the credential through the
// secret service and drives the provider adapter through the shared request scheduler.
//
// A plugin owns the ROUTE and the PROMPT; core owns provider access (docs/model-providers.md). That
// split used to be expressed by the plugin handing core's own db handle and SECRETS back to core
// (`generateTextForConnection({ db: getDb(c.env), secrets: c.env.SECRETS, … })`), which meant the
// plugin held core's database to make a call that never touches its own. Here the two bindings the
// plugin has no business holding are closed over, and what crosses is the request.
//
// One caller: plugins/database's AI-SQL route.
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
