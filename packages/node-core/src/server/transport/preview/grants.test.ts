import { describe, expect, it } from 'vitest'
import { PreviewGrants } from './grants'

let clock = 1_000_000
const grants = (): PreviewGrants => new PreviewGrants(() => clock)
const open = (store: PreviewGrants, deviceId = 'device-a') =>
  store.open({ deviceId, ancestor: undefined, port: async () => 5173 })

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

  it('keeps eight, dropping the oldest', () => {
    const store = grants()
    const ids = Array.from({ length: 9 }, () => open(store).id)
    expect(store.get(ids[0]!)).toBeUndefined()
    expect(ids.slice(1).every((id) => store.get(id))).toBe(true)
  })
})
