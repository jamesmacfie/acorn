// Typed wrapper over the /v1/p/database routes, over the frame bridge rather than core's fetch
// helpers.
//
// A frame has no network (`connect-src 'none'`), so there is no `readJson` and no CSRF envelope. Every
// call is a message on the mounted tree's bridge, and the host checks the path against this plugin's
// own namespace before forwarding it (client-core/host/frames/scopes.ts).
//
// Built from the bridge the tree was mounted with, never from module-level `connect()`. In a tree
// worker that one is the bundle's shared port, which the host refuses for any bundle whose SDK hands
// each tree its own bridge (client-core/host/tree/workerHost.ts).
import type { ModelBackend } from '@acorn/protocol/modelProviders.ts'
import type { AcornBridge } from '@acorn/plugin-api/ui/sdk'
import {
  databaseActionRoute,
  databaseColumnsRoute,
  databaseModelBackendsRoute,
  databaseQueriesRoute,
  databaseQueryRoute,
  databaseRowsRoute,
  databaseScratchRoute,
  databaseTablesRoute,
} from '../shared/database'
import type {
  DbCell,
  DbColumnsResult,
  DbConnectResult,
  DbGenerateResult,
  DbPk,
  DbQueryResult,
  DbRowsResult,
  DbSavedQuery,
  DbTablesResult,
  DbWriteResult,
} from '../shared/database'

export type DatabaseClient = ReturnType<typeof databaseClient>

export const databaseClient = ({ api }: AcornBridge) => ({
  connectDb: (taskId: string): Promise<DbConnectResult> =>
    api.post(databaseActionRoute(taskId, 'connect')),

  disconnectDb: (taskId: string): Promise<{ ok: true }> =>
    api.post(databaseActionRoute(taskId, 'disconnect')),

  listTables: (taskId: string): Promise<DbTablesResult> =>
    api.get(databaseTablesRoute(taskId)),

  listColumns: (taskId: string, schema: string, name: string): Promise<DbColumnsResult> =>
    api.get(databaseColumnsRoute(taskId, schema, name)),

  listRows: (taskId: string, schema: string, name: string, offset?: number): Promise<DbRowsResult> =>
    api.get(databaseRowsRoute(taskId, schema, name, offset)),

  runQuery: (taskId: string, sql: string): Promise<DbQueryResult> =>
    api.post(databaseActionRoute(taskId, 'query'), { sql }),

  updateCell: (taskId: string, schema: string, name: string, column: string, value: DbCell, pk: DbPk): Promise<DbWriteResult> =>
    api.post(databaseActionRoute(taskId, 'update'), { schema, name, column, value, pk }),

  insertRow: (taskId: string, schema: string, name: string, values: Record<string, DbCell>): Promise<DbWriteResult> =>
    api.post(databaseActionRoute(taskId, 'insert'), { schema, name, values }),

  deleteRow: (taskId: string, schema: string, name: string, pk: DbPk): Promise<DbWriteResult> =>
    api.post(databaseActionRoute(taskId, 'delete'), { schema, name, pk }),

  generateSql: (
    taskId: string,
    body: { backendId: string; modelId?: string; prompt: string; queryIds?: string[] },
  ): Promise<DbGenerateResult> => api.post(databaseActionRoute(taskId, 'generate'), body),

  // The stored scratch document, as the node holds it. Not `bridge.document.read()`, which answers with
  // what is in the editor right now: this is asked after the palette's `Generate SQL` wrote the row, so
  // the row is the question.
  readScratch: async (taskId: string): Promise<string> =>
    (await api.get<{ text?: string }>(databaseScratchRoute(taskId))).text ?? '',

  listSavedQueries: (taskId: string): Promise<DbSavedQuery[]> =>
    api.get(databaseQueriesRoute(taskId)),

  saveQuery: (taskId: string, body: { name: string; notes: string; sql: string }): Promise<DbSavedQuery> =>
    api.post(databaseQueriesRoute(taskId), body),

  deleteSavedQuery: async (taskId: string, queryId: string): Promise<void> => {
    await api.del(databaseQueryRoute(taskId, queryId))
  },

  // The Generate button's precondition, answered by this plugin's node half: the backends this owner can
  // spend, which is every connected key plus every agent CLI installed on this machine. A frame cannot
  // read core's integrations — there is no bridge scope for them, and minting one to serve a dropdown
  // would hand every installed plugin the whole roster. This returns ids and labels. The key never
  // leaves the node.
  listModelBackends: async (taskId: string): Promise<ModelBackend[]> =>
    (await api.get<{ backends: ModelBackend[] }>(databaseModelBackendsRoute(taskId))).backends,
})
