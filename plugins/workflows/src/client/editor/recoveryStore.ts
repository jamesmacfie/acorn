import type { WorkflowDef } from '../../shared/workflowContracts'

export const WORKFLOW_AUTOSAVE_MS = 750
export type WorkflowRecovery = { nodeId: string; entityId: string; baseRevision: number; base: WorkflowDef; local: WorkflowDef; savedAt: number }
const prefix = 'workflow-recovery:v1:'
export const workflowRecoveryKey = (copy: Pick<WorkflowRecovery, 'nodeId' | 'entityId' | 'baseRevision'>) => `${prefix}${JSON.stringify([copy.nodeId, copy.entityId, copy.baseRevision])}`

export function workflowRecoveryStore(storage?: Storage) {
  return {
    save(copy: WorkflowRecovery): boolean {
      try { if (!storage) return false; storage.setItem(workflowRecoveryKey(copy), JSON.stringify(copy)); return true } catch { return false }
    },
    latest(nodeId: string, entityId: string): WorkflowRecovery | undefined {
      const copies: WorkflowRecovery[] = []
      try {
        for (let i = 0; storage && i < storage.length; i++) {
          const key = storage.key(i)
          if (!key?.startsWith(prefix)) continue
          const copy = JSON.parse(storage.getItem(key) ?? 'null') as WorkflowRecovery | null
          if (copy?.nodeId === nodeId && copy.entityId === entityId && Number.isInteger(copy.baseRevision)
            && Array.isArray(copy.base?.steps) && Array.isArray(copy.local?.steps)) copies.push(copy)
        }
      } catch { /* Leave unreadable copies intact. */ }
      return copies.sort((a, b) => b.savedAt - a.savedAt)[0]
    },
    acknowledge(copy: WorkflowRecovery, revision: number, def: WorkflowDef): void {
      if (revision !== copy.baseRevision + 1 || JSON.stringify(def) !== JSON.stringify(copy.local)) return
      try {
        if (storage?.getItem(workflowRecoveryKey(copy)) !== JSON.stringify(copy)) return
        const remove: string[] = []
        for (let i = 0; storage && i < storage.length; i++) {
          const key = storage.key(i)
          if (!key?.startsWith(prefix)) continue
          const older = JSON.parse(storage.getItem(key) ?? 'null') as WorkflowRecovery | null
          if (older?.nodeId === copy.nodeId && older.entityId === copy.entityId && older.baseRevision <= copy.baseRevision && older.savedAt <= copy.savedAt) remove.push(key)
        }
        for (const key of remove) storage!.removeItem(key)
      } catch { /* Retain recovery on storage failure. */ }
    },
    discard(copy: WorkflowRecovery): void { storage?.removeItem(workflowRecoveryKey(copy)) },
  }
}
