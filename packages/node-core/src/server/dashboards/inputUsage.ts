import { isNotNull } from 'drizzle-orm'
import type { PluginInputGrantState } from '@acorn/protocol/api.ts'
import type { QueryContent } from '@acorn/protocol/dataQueries.ts'
import type { AppDatabase } from '../db'
import { queryStore } from '../queries/store'
import { dashboardDrafts } from './schema'
import { dashboardStore } from './store'

/**
 * How many published panels bind each of a plugin's derived source inputs, and with which accounts. It
 * reads every published plan, so the plugin page asks for it only when its Permissions tab opens.
 */
export function pluginInputUsage(db: AppDatabase, pluginId: string): PluginInputGrantState['usage'] {
  const panels = new Map<string, { sourceId: string; name: string; panels: Set<string>; connectionIds: Set<string> }>()
  const store = dashboardStore(db)
  const ids = db.select({ id: dashboardDrafts.id }).from(dashboardDrafts).where(isNotNull(dashboardDrafts.publishedRevision)).all()
  for (const { id } of ids) {
    let revision
    try { revision = store.publishedById(id) } catch { continue }
    const scope = { workspaceId: revision.workspaceId, ...(revision.projectId ? { projectId: revision.projectId } : {}) }
    for (const entry of revision.content.sources) {
      let content: QueryContent
      try {
        content = entry.reference.kind === 'inline'
          ? entry.reference.content
          : queryStore(db).published(scope, entry.reference.queryId, entry.reference.revision).content
      } catch { continue }
      const { source, scope: bound } = content.query
      if (source.pluginId !== pluginId) continue
      for (const [name, binding] of Object.entries(bound.inputs ?? {})) {
        const key = JSON.stringify([source.sourceId, name])
        const usage = panels.get(key) ?? { sourceId: source.sourceId, name, panels: new Set(), connectionIds: new Set() }
        usage.panels.add(id)
        if (binding.connectionId) usage.connectionIds.add(binding.connectionId)
        panels.set(key, usage)
      }
    }
  }
  const usage: PluginInputGrantState['usage'] = {}
  for (const entry of panels.values()) {
    usage[entry.sourceId] ??= {}
    usage[entry.sourceId]![entry.name] = { panels: entry.panels.size, connectionIds: [...entry.connectionIds].sort() }
  }
  return usage
}
