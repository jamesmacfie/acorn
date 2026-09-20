import { queryContentSchema, type QueryRecovery, type QueryDraft, type QuerySaveState } from '@acorn/protocol/dataQueries.ts'

type RecoveryStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'length' | 'key'>
export const QUERY_AUTOSAVE_MS = 750
export const queryRecoveryKey = (nodeId: string, entityId: string, baseRevision: number) =>
  `query-recovery:v1:${JSON.stringify([nodeId, entityId, baseRevision])}`

/** The caller supplies host storage; a terminal host can report that no durable copy is available. */
export function queryRecoveryStore(storage?: RecoveryStorage) {
  const store = {
    save(copy: QueryRecovery): QuerySaveState {
      if (!storage) return 'not-saved'
      try {
        storage.setItem(queryRecoveryKey(copy.nodeId, copy.entityId, copy.baseRevision), JSON.stringify(copy))
        return 'saved-on-device'
      } catch { return 'not-saved' }
    },
    read(nodeId: string, entityId: string, baseRevision: number): QueryRecovery | null {
      try {
        const raw = storage?.getItem(queryRecoveryKey(nodeId, entityId, baseRevision))
        if (!raw) return null
        const copy = JSON.parse(raw) as QueryRecovery
        if (copy.nodeId !== nodeId || copy.entityId !== entityId || copy.baseRevision !== baseRevision || !Number.isFinite(copy.savedAt)) return null
        return { ...copy, baseContent: queryContentSchema.parse(copy.baseContent), content: queryContentSchema.parse(copy.content) }
      } catch { return null }
    },
    list(nodeId: string, entityId: string): QueryRecovery[] {
      const copies: QueryRecovery[] = []
      try {
        for (let index = 0; storage && index < storage.length; index++) {
          const key = storage.key(index)
          if (!key?.startsWith('query-recovery:v1:')) continue
          const parts: unknown = JSON.parse(key.slice('query-recovery:v1:'.length))
          if (!Array.isArray(parts) || parts[0] !== nodeId || parts[1] !== entityId || !Number.isInteger(parts[2])) continue
          const copy = store.read(nodeId, entityId, parts[2] as number)
          if (copy) copies.push(copy)
        }
      } catch { /* Retain valid copies even if storage becomes unavailable. */ }
      return copies.sort((a, b) => b.savedAt - a.savedAt)
    },
    reconcile(copy: QueryRecovery, remote: QueryDraft): 'retry-save' | 'conflict' {
      return remote.id === copy.entityId && remote.draftRevision === copy.baseRevision ? 'retry-save' : 'conflict'
    },
    acknowledge(copy: QueryRecovery, acknowledged: QueryDraft): boolean {
      // A late acknowledgment must not remove edits made while its request was in flight.
      if (acknowledged.id !== copy.entityId || acknowledged.draftRevision !== copy.baseRevision + 1
        || JSON.stringify(acknowledged.content) !== JSON.stringify(copy.content)) return false
      try {
        const key = queryRecoveryKey(copy.nodeId, copy.entityId, copy.baseRevision)
        if (storage?.getItem(key) !== JSON.stringify(copy)) return false
        storage.removeItem(key)
        return true
      } catch { return false }
    },
    discard(copy: QueryRecovery): void {
      storage?.removeItem(queryRecoveryKey(copy.nodeId, copy.entityId, copy.baseRevision))
    },
  }
  return store
}
