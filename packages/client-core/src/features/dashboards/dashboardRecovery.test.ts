import { describe, expect, it } from 'vitest'
import type { DashboardRecovery } from '@acorn/protocol/dashboards.ts'
import { dashboardRecoveryStore } from './dashboardRecovery'

const memory = () => {
  const values = new Map<string, string>()
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => void values.set(key, value), removeItem: (key: string) => void values.delete(key) }
}
const content = { title: 'Panel', queries: [], mapping: { columns: [], fields: {}, values: {}, unmapped: 'catch-all' as const }, display: { view: { kind: 'list' as const }, fields: [] } }

describe('dashboard recovery', () => {
  it('retains a newer local edit after a late acknowledgement', () => {
    const storage = memory()
    const store = dashboardRecoveryStore(storage)
    const first: DashboardRecovery = { nodeId: 'node', entityId: 'panel', baseRevision: 1, baseContent: content, content, savedAt: 1 }
    const second = { ...first, content: { ...content, title: 'Newer' }, savedAt: 2 }
    store.save(first); store.save(second); store.acknowledge(first, first.content)
    expect(store.read('node', 'panel')?.content.title).toBe('Newer')
  })
})
