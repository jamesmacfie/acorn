import { and, eq, like } from 'drizzle-orm'
import { pluginStateKey } from '@acorn/protocol/pluginState.ts'
import * as schema from './schema'
import type { AppDatabase } from './index'

// Application-level cascade for disconnecting an integration (docs/data-layer.md § External-item
// read model: the schema declares no foreign keys). If you add a table keyed by integrationId,
// delete its rows below before the integrations row.
export const cascadeDeleteIntegration = async (db: AppDatabase, userId: string, id: string) => {
  await db.batch([
    db.delete(schema.workspaceExternalProjects).where(eq(schema.workspaceExternalProjects.integrationId, id)),
    db.delete(schema.issues).where(and(eq(schema.issues.userId, userId), eq(schema.issues.integrationId, id))),
    db.delete(schema.issueResources).where(and(eq(schema.issueResources.userId, userId), eq(schema.issueResources.integrationId, id))),
    db.delete(schema.syncState).where(and(eq(schema.syncState.userId, userId), like(schema.syncState.resource, `provider:%:${id}:%`))),
    db.delete(schema.taskLinks).where(eq(schema.taskLinks.integrationId, id)),
    db.delete(schema.integrations).where(and(eq(schema.integrations.id, id), eq(schema.integrations.userId, userId))),
  ])
}

// The same shape one entity over: everything in the core database that belongs to one plugin id, for
// an uninstall the owner asked to purge (docs/plugins.md § Uninstalling).
//
// Uninstall used to delete the package directory, the lockfile and the plugin's own SQLite files, then
// audit `dataPurged: true` while leaving these behind. The prefs rows are the sharp edge: every
// sandboxed frame's state lives under `plugin:<id>:*`, and nothing could enumerate or delete that
// namespace, so a reinstall inherited the old plugin's state with no way for anyone to look at it
// first.
//
// Both key spaces are host-bound, so a LIKE on the prefix cannot reach another plugin's rows: prefs
// keys are stamped by pluginStateKey and schedule keys by `<pluginId>:<scheduleId>`
// (docs/schedules.md). `_` and `%` are not legal in a plugin id (pluginContract.ts § ID_RE), so no
// escape clause is needed.
//
// What this deliberately does not reach, and why the audit row is still honest:
// - Saved layouts. A pane id sits inside a core-owned JSON blob (`core:task-layouts`), and the layout
//   normaliser already drops an id no registered pane answers to.
// - Cached external items. Those belong to the owner's connection, not to the plugin that reads it,
//   and disconnecting the connection is what clears them (cascadeDeleteIntegration above).
export const cascadeDeletePluginData = async (db: AppDatabase, pluginId: string) => {
  await db.batch([
    db.delete(schema.prefs).where(like(schema.prefs.key, `${pluginStateKey(pluginId, '')}%`)),
    db.delete(schema.scheduleState).where(like(schema.scheduleState.key, `${pluginId}:%`)),
    db.delete(schema.scheduleRuns).where(like(schema.scheduleRuns.key, `${pluginId}:%`)),
  ])
}
