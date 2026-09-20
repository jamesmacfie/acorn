import { eq } from 'drizzle-orm'
import type { DataSourceScope } from '@acorn/protocol/dataSources.ts'
import type { Env } from '../bindings'
import { getDb, schema } from '../db'
import { getConnection } from '../integrations/connections'
import { connectionProviderRegistry } from '../integrations/connectionRegistry'
import type { Principal } from '../middleware/auth'
import { principalMayUseProviderCredential } from '../middleware/requireUser'
import { DataSourceError } from './validation'

/** A host-created principal is mandatory; request JSON can never grant provider authority. */
export type DataSourceInvocation = { principal: Principal; signal: AbortSignal }
export async function authorizeDataSource(
  env: Env,
  invocation: DataSourceInvocation,
  scope: DataSourceScope,
  pluginId?: string,
  providerId?: string,
): Promise<void> {
  const { principal, signal } = invocation
  if (signal.aborted) throw new DataSourceError(signal.reason?.name === 'TimeoutError' ? 'timeout' : 'cancelled')
  if (!principalMayUseProviderCredential(principal) || principal.userId !== env.ACTIVE_IDENTITY.get()) {
    throw new DataSourceError('forbidden')
  }
  const db = getDb(env)
  if (scope.workspaceId) {
    const [workspace] = await db.select({ id: schema.workspaces.id }).from(schema.workspaces)
      .where(eq(schema.workspaces.id, scope.workspaceId))
    if (!workspace) throw new DataSourceError('forbidden')
  }
  if (scope.projectId) {
    const [project] = await db.select({ workspaceId: schema.projects.workspaceId })
      .from(schema.projects).where(eq(schema.projects.id, scope.projectId))
    if (!project || !scope.workspaceId || project.workspaceId !== scope.workspaceId) {
      throw new DataSourceError('forbidden')
    }
  }
  if (providerId) {
    try { connectionProviderRegistry.assertOwnedBy(providerId, pluginId!) }
    catch { throw new DataSourceError('forbidden') }
    if (!scope.connectionId) throw new DataSourceError('connection-required')
    const connection = await getConnection(db, principal.userId, scope.connectionId)
    if (!connection || connection.provider !== providerId || ['disabled', 'needs-auth'].includes(connection.status)) {
      throw new DataSourceError('forbidden')
    }
  } else if (scope.connectionId && pluginId) throw new DataSourceError('invalid-request')
}
