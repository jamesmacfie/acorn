import { describe, expect, it } from 'vitest'
import { pinnedPort, PreviewGrants } from './grants'

let clock = 1_000_000
const grants = (): PreviewGrants => new PreviewGrants(() => clock)
const open = (store: PreviewGrants, deviceId = 'device-a') =>
  store.open({ deviceId, ancestor: undefined, port: 5173, target: async () => 5173 })

describe('preview grants', () => {
  it('trades the entry key once, and refuses a wrong or late one', () => {
    const store = grants()
    const { id, entryKey } = open(store)
    expect(store.spendEntryKey(id, 'wrong')).toBeUndefined()
    expect(store.spendEntryKey(id, entryKey)?.id).toBe(id)
    expect(store.spendEntryKey(id, entryKey)).toBeUndefined()

    const late = open(store)
    clock += 61_000
    expect(store.spendEntryKey(late.id, late.entryKey)).toBeUndefined()
  })

  it('knows the cookie by its secret alone', () => {
    const store = grants()
    const { id } = open(store)
    const grant = store.get(id)!
    expect(store.holdsCookie(grant, grant.cookie)).toBe(true)
    expect(store.holdsCookie(grant, undefined)).toBe(false)
    expect(store.holdsCookie(grant, `${grant.cookie}x`)).toBe(false)
    expect(grant.cookie).not.toBe(id)
  })

  it('ends a grant after twelve hours, and when its device is revoked', () => {
    const store = grants()
    const kept = open(store, 'device-a')
    const revoked = open(store, 'device-b')
    store.revokeDevice('device-b')
    expect(store.get(revoked.id)).toBeUndefined()
    expect(store.get(kept.id)).toBeDefined()
    clock += 12 * 3600_000 + 1
    expect(store.get(kept.id)).toBeUndefined()
  })

  it('shows the port it opened on, and refuses once the task’s address names another', async () => {
    let target: number | null = 5173
    const store = grants()
    const { id } = store.open({ deviceId: 'device-a', ancestor: undefined, port: 5173, target: async () => target })
    const grant = store.get(id)!
    expect(await pinnedPort(grant)).toBe(5173)
    target = 5432
    expect(await pinnedPort(grant)).toBeNull()
    target = null
    expect(await pinnedPort(grant)).toBeNull()
    expect(await pinnedPort({ port: 5173, target: () => Promise.reject(new Error('gone')) })).toBeNull()
    target = 5173
    expect(await pinnedPort(grant)).toBe(5173)
  })

  it('keeps eight, dropping the oldest', () => {
    const store = grants()
    const ids = Array.from({ length: 9 }, () => open(store).id)
    expect(store.get(ids[0]!)).toBeUndefined()
    expect(ids.slice(1).every((id) => store.get(id))).toBe(true)
  })
})
