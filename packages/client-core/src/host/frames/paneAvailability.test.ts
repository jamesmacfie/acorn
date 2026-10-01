import { beforeEach, describe, expect, it, vi } from 'vitest'

const readJson = vi.fn()
vi.mock('../../infra/node/apiClient', () => ({ readJson: (route: string) => readJson(route) }))
vi.mock('../../infra/node/wsClient', () => ({ wsOnReconnect: () => () => {} }))

const { paneAvailability } = await import('./paneAvailability')

describe('paneAvailability', () => {
  beforeEach(() => readJson.mockReset())

  it('hides a task until the route lists it, keeps the answer on a failure, and fails open on a 404', async () => {
    const store = paneAvailability('test', '/v1/p/db/available')
    expect(store.available('a')).toBe(false)

    readJson.mockResolvedValueOnce({ a: true, b: false })
    await store.schedule.run()
    expect([store.available('a'), store.available('b'), store.available('c')]).toEqual([true, false, false])

    readJson.mockRejectedValueOnce(Object.assign(new Error('down'), { status: 502 }))
    await store.schedule.run()
    readJson.mockResolvedValueOnce({ a: 'yes' })
    await store.schedule.run()
    expect(store.available('a')).toBe(true)

    readJson.mockRejectedValueOnce(Object.assign(new Error('missing'), { status: 404 }))
    await store.schedule.run()
    expect(store.available('c')).toBe(true)
  })
})
