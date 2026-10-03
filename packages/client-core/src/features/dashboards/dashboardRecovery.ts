import type { DashboardContent, DashboardRecovery } from '@acorn/protocol/dashboards.ts'

const PREFIX = 'acorn:dashboard-recovery:'
const key = (copy: Pick<DashboardRecovery, 'nodeId' | 'entityId'>) => `${PREFIX}${copy.nodeId}:${copy.entityId}`

export function dashboardRecoveryStore(storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>) {
  return {
    read(nodeId: string, entityId: string): DashboardRecovery | undefined {
      try {
        const raw = storage?.getItem(key({ nodeId, entityId }))
        return raw ? JSON.parse(raw) as DashboardRecovery : undefined
      } catch { return undefined }
    },
    save(copy: DashboardRecovery): 'saved-on-device' | 'not-saved' {
      try { storage?.setItem(key(copy), JSON.stringify(copy)); return storage ? 'saved-on-device' : 'not-saved' }
      catch { return 'not-saved' }
    },
    acknowledge(copy: DashboardRecovery, acknowledged: DashboardContent): void {
      const current = this.read(copy.nodeId, copy.entityId)
      if (current && current.savedAt === copy.savedAt && JSON.stringify(current.content) === JSON.stringify(acknowledged)) {
        storage?.removeItem(key(copy))
      }
    },
    discard(nodeId: string, entityId: string): void { storage?.removeItem(key({ nodeId, entityId })) },
  }
}
