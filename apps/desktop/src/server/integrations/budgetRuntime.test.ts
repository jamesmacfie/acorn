import { describe, expect, it } from 'vitest'
import { ProviderRequestScheduler } from './budgetRuntime'
import type { ProviderBudgets } from '../../shared/integrations'

const budgets: ProviderBudgets = {
  maxConcurrentRequests: 2,
  maxConcurrentRequestsPerConnection: 1,
  maxPages: 3,
  maxCachedItemBytes: 1024,
  maxContextItems: 10,
  backoffFloorMs: 1000,
  maxResolutionBatch: 25,
}

describe('provider request budgets', () => {
  it('enforces provider and per-connection concurrency ceilings', async () => {
    const scheduler = new ProviderRequestScheduler()
    let providerActive = 0
    let providerPeak = 0
    const connectionActive = new Map<string, number>()
    const connectionPeak = new Map<string, number>()
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const operation = (connectionId: string) => scheduler.run('linear', connectionId, budgets, async () => {
      providerActive++
      providerPeak = Math.max(providerPeak, providerActive)
      const active = (connectionActive.get(connectionId) ?? 0) + 1
      connectionActive.set(connectionId, active)
      connectionPeak.set(connectionId, Math.max(connectionPeak.get(connectionId) ?? 0, active))
      await gate
      providerActive--
      connectionActive.set(connectionId, active - 1)
    })

    const pending = [operation('a'), operation('a'), operation('b'), operation('b')]
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(providerPeak).toBe(2)
    expect(connectionPeak.get('a')).toBe(1)
    expect(connectionPeak.get('b')).toBe(1)
    release()
    await Promise.all(pending)
  })
})
