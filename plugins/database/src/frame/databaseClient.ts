// Typed wrapper over the /v2/p/database routes, now over the frame bridge rather than core's fetch
// helpers.
//
// A frame has no network at all — `connect-src 'none'` — so there is no `readJson` to reach for and no
// CSRF envelope to share: every call is a message on the one MessagePort, and the host checks the path
// against this plugin's own namespace before forwarding it (client-core/plugins/frames/scopes.ts).
//
// `connect()` is awaited per call rather than threaded through every component, because it resolves once
// per frame and memoizes. That keeps the call sites identical to the compiled versions they replace,
// which is what makes most of this directory a move rather than a rewrite.
import type { AvailableModelConnection } from '@acorn/protocol/modelProviders.ts'
import { connect } from '@acorn/plugin-api/ui/sdk'
import {
  databaseActionRoute,
  databaseColumnsRoute,
  databaseModelConnectionsRoute,
  databaseQueriesRoute,
  databaseQueryRoute,
  databaseRowsRoute,
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

const api = async () => (await connect()).api

export const connectDb = async (taskId: string): Promise<DbConnectResult> =>
  (await api()).post(databaseActionRoute(taskId, 'connect'))

export const disconnectDb = async (taskId: string): Promise<{ ok: true }> =>
  (await api()).post(databaseActionRoute(taskId, 'disconnect'))

export const listTables = async (taskId: string): Promise<DbTablesResult> =>
  (await api()).get(databaseTablesRoute(taskId))

export const listColumns = async (taskId: string, schema: string, name: string): Promise<DbColumnsResult> =>
  (await api()).get(databaseColumnsRoute(taskId, schema, name))

export const listRows = async (taskId: string, schema: string, name: string, offset?: number): Promise<DbRowsResult> =>
  (await api()).get(databaseRowsRoute(taskId, schema, name, offset))

export const runQuery = async (taskId: string, sql: string): Promise<DbQueryResult> =>
  (await api()).post(databaseActionRoute(taskId, 'query'), { sql })

export const updateCell = async (taskId: string, schema: string, name: string, column: string, value: DbCell, pk: DbPk): Promise<DbWriteResult> =>
  (await api()).post(databaseActionRoute(taskId, 'update'), { schema, name, column, value, pk })

export const insertRow = async (taskId: string, schema: string, name: string, values: Record<string, DbCell>): Promise<DbWriteResult> =>
  (await api()).post(databaseActionRoute(taskId, 'insert'), { schema, name, values })

export const deleteRow = async (taskId: string, schema: string, name: string, pk: DbPk): Promise<DbWriteResult> =>
  (await api()).post(databaseActionRoute(taskId, 'delete'), { schema, name, pk })

export const generateSql = async (
  taskId: string,
  body: { connectionId: string; modelId?: string; prompt: string; queryIds?: string[] },
): Promise<DbGenerateResult> => (await api()).post(databaseActionRoute(taskId, 'generate'), body)

export const listSavedQueries = async (taskId: string): Promise<DbSavedQuery[]> =>
  (await api()).get(databaseQueriesRoute(taskId))

export const saveQuery = async (taskId: string, body: { name: string; notes: string; sql: string }): Promise<DbSavedQuery> =>
  (await api()).post(databaseQueriesRoute(taskId), body)

export const deleteSavedQuery = async (taskId: string, queryId: string): Promise<void> => {
  await (await api()).del(databaseQueryRoute(taskId, queryId))
}

// The Generate button's precondition, answered by this plugin's node half. A frame cannot read core's
// integrations — there is no bridge scope for them, and minting one to serve a dropdown would hand every
// installed plugin the whole connection roster. This returns ids and labels; the key never leaves the node.
export const listModelConnections = async (taskId: string): Promise<AvailableModelConnection[]> =>
  (await (await api()).get<{ connections: AvailableModelConnection[] }>(databaseModelConnectionsRoute(taskId))).connections
