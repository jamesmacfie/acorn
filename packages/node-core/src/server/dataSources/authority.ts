import { eq } from 'drizzle-orm'
import { parseDataSourceInputRef, type DataSourceInput, type DataSourceInputBinding, type DataSourceRequest, type DataSourceScope } from '@acorn/protocol/dataSources.ts'
import type { Env } from '../bindings'
import { getDb, schema } from '../db'
import { getConnection } from '../integrations/connections'
import { connectionProviderRegistry } from '../integrations/connectionProviders/registry'
import type { Principal } from '../middleware/auth'
import { principalMayUseProviderCredential } from '../middleware/requireUser'
import { DataSourceError } from './validation'
import { dataSourceDiscovered, registeredDataSource, type RegisteredDataSource } from './registry'

/** A host-created principal is mandatory; request JSON can never grant provider authority. `chain`
 *  lists the derived sources this read is nested inside, outermost first. Only the host sets it, when
 *  a derived source reads an input (./inputs.ts). */
export type DataSourceInvocation = { principal: Principal; signal: AbortSignal; chain?: readonly string[] }
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

/** The scope a derived source's input runs with: the outer workspace and project, and the binding's
 *  account and parameters. */
export const inputScope = (scope: DataSourceScope, binding: DataSourceInputBinding): DataSourceScope => ({
  ...(scope.workspaceId ? { workspaceId: scope.workspaceId } : {}),
  ...(scope.projectId ? { projectId: scope.projectId } : {}),
  ...(binding.connectionId ? { connectionId: binding.connectionId } : {}),
  parameters: binding.parameters,
  ...(binding.inputs ? { inputs: binding.inputs } : {}),
})

/** The registered source an input names, if it may be one: static, not discovered. */
export function inputSource(input: DataSourceInput): RegisteredDataSource | undefined {
  const source = registeredDataSource(parseDataSourceInputRef(input.source))
  return source && !dataSourceDiscovered(source) ? source : undefined
}

/** Check a query's input bindings as a direct call to each input would be checked. `describe` needs
 *  no bindings, because the launcher lists a source before anyone picks accounts. */
export async function authorizeSourceInputs(
  env: Env,
  invocation: DataSourceInvocation,
  source: RegisteredDataSource,
  scope: DataSourceScope,
  operation: DataSourceRequest['operation'],
): Promise<void> {
  const declared = source.inputs ?? {}
  for (const name of Object.keys(scope.inputs ?? {})) {
    if (!Object.hasOwn(declared, name)) throw new DataSourceError('invalid-request', { input: name, reason: 'Not a declared input' })
  }
  for (const [name, input] of Object.entries(declared)) {
    const binding = scope.inputs?.[name]
    if (!binding) {
      if (!input.optional && operation !== 'describe') throw new DataSourceError('input-required', { input: name })
      continue
    }
    const target = inputSource(input)
    if (!target) throw new DataSourceError('input-unavailable', { input: name, reason: 'Source not installed' })
    try { await authorizeDataSource(env, invocation, inputScope(scope, binding), target.pluginId, target.providerId) }
    catch (error) {
      if (!(error instanceof DataSourceError) || error.code === 'cancelled' || error.code === 'timeout') throw error
      if (error.code === 'connection-required') throw new DataSourceError('input-required', { input: name })
      throw new DataSourceError('input-unavailable', { input: name, reason: error.code === 'forbidden' ? 'Account unavailable' : error.code })
    }
  }
}
