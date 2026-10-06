import { afterEach, describe, expect, it } from 'vitest'
import { clearDashboardReadCache, dashboardSharedRead } from './readCache'

const cancelled = new Error('cancelled')
const isCancelled = (error: unknown) => error === cancelled

afterEach(() => clearDashboardReadCache())

describe('dashboardSharedRead', () => {
  it('shares one read between callers that ask for the same key', async () => {
    let loads = 0
    const load = async () => ++loads
    expect(await Promise.all([dashboardSharedRead('key', load), dashboardSharedRead('key', load)])).toEqual([1, 1])
    expect(loads).toBe(1)
  })

  it('reads again for a caller whose shared read was cancelled by the caller that started it', async () => {
    const first = dashboardSharedRead('key', () => Promise.reject(cancelled), isCancelled)
    const joined = dashboardSharedRead('key', async () => 'rows', isCancelled)
    await expect(first).rejects.toBe(cancelled)
    expect(await joined).toBe('rows')
  })

  it('passes any other failure of a shared read to every caller', async () => {
    const failure = new Error('provider-failure')
    let loads = 0
    const load = () => { loads++; return Promise.reject(failure) }
    const results = await Promise.allSettled([dashboardSharedRead('key', load, isCancelled), dashboardSharedRead('key', load, isCancelled)])
    expect(results.map(result => result.status === 'rejected' && result.reason)).toEqual([failure, failure])
    expect(loads).toBe(1)
  })
})
