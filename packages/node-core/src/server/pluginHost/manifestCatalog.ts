// Manifest declarations that have no route dispatch: each lands through the same owner-bound
// context registry used by a compiled plugin. The host owns rollback of partial registration.
import type { LoadedPluginBinding } from './context'
import type { HostPluginContext, NodePluginContext } from './types'

export function registerManifestDataSources(
  ctx: Pick<NodePluginContext, 'dataSources'>,
  binding: LoadedPluginBinding | undefined,
): void {
  for (const source of binding?.dataSources ?? []) ctx.dataSources.register(source)
  for (const discovery of binding?.dataSourceDiscoveries ?? []) ctx.dataSources.discover(discovery)
}

export function registerManifestNodeActions(
  ctx: Pick<HostPluginContext, 'nodeActions'>,
  binding: LoadedPluginBinding | undefined,
): void {
  for (const command of binding?.commands ?? []) {
    if (command.kind !== undefined && command.kind !== 'action') continue
    if (command.action.verb !== 'runNodeAction') continue
    ctx.nodeActions.register({ actionId: command.id, name: command.title, path: command.action.path })
  }
}

export function registerManifestAuditActions(
  ctx: Pick<NodePluginContext, 'audit'>,
  binding: LoadedPluginBinding | undefined,
): void {
  for (const descriptor of binding?.auditActions ?? []) ctx.audit.declare(descriptor)
}
