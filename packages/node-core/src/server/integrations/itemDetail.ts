// A provider's `detail` read for one item on one connection, with core's resource runtime lent to it.
// The agent's issue tools use it, and so does the cache warm when a task gains a link.
import type { AppDatabase } from '../db'
import type { SecretService } from '../core/secrets'
import { integrationProviderRegistry } from './registry'
import { runProviderResource } from './resourceRuntime'
import type { ProviderDetailContext } from './types'

export type ItemDetailDeps = { db: AppDatabase; secrets: SecretService }

export const providerDetailContext = (
  deps: ItemDetailDeps,
  userId: string,
  providerId: string,
  connectionId: string,
  force?: boolean,
): ProviderDetailContext => ({
  resource: (resourceId, input, forceThis) =>
    runProviderResource({ db: deps.db, userId, secrets: deps.secrets, providerId, connectionId, resourceId, input, force: forceThis ?? force }),
})

// Fill the cache for items a task has just linked, so the task context an agent starts from names
// each one by title and state instead of reporting it missing. Nothing waits on it, and a failure
// leaves the item as uncached as it was.
export function warmItemDetails(
  deps: ItemDetailDeps,
  userId: string,
  links: { providerId: string; connectionId: string; identifier: string }[],
): void {
  for (const link of links) {
    const detail = integrationProviderRegistry.get(link.providerId)?.detail
    if (!detail) continue
    const context = providerDetailContext(deps, userId, link.providerId, link.connectionId)
    void Promise.resolve().then(() => detail(context, link.identifier)).catch(() => {})
  }
}
