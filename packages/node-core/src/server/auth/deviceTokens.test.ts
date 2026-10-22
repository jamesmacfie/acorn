import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTestDb, type TestDb } from '../../testkit/db'
import { schema } from '../db'
import { deviceService, type DeviceService } from './deviceTokens'

let harness: TestDb
let devices: DeviceService
let clock: number

beforeEach(() => {
  harness = makeTestDb()
  clock = 1_700_000_000_000
  devices = deviceService(harness.db, () => clock)
})

afterEach(() => {
  harness.cleanup()
})

describe('device tokens', () => {
  it('issues a token that authenticates back to its device', async () => {
    const { token, device } = await devices.issue("James's laptop")
    expect(token).toMatch(/^acorn_dt_[0-9a-f-]{36}_[A-Za-z0-9_-]{43}$/)
    expect(await devices.authenticate(token)).toEqual({ deviceId: device.id })
  })

  it('never stores the secret, only its hash', async () => {
    const { token } = await devices.issue('laptop')
    const secret = token.split('_').at(-1)!
    const [row] = await harness.db.select().from((await import('../db')).schema.devices)
    const stored = Buffer.from(row.secretHash as unknown as Buffer).toString('utf8')
    expect(stored).not.toContain(secret)
    expect((row.secretHash as unknown as Buffer).length).toBe(32)
  })

  // The single-null contract: distinguishing these would let a caller learn that a device id
  // exists, or that a token was revoked rather than never valid.
  it('returns an indistinguishable null for every failure mode', async () => {
    const { token, device } = await devices.issue('laptop')
    const [, , id, secret] = token.split('_')

    expect(await devices.authenticate(undefined)).toBeNull() // missing
    expect(await devices.authenticate('')).toBeNull()
    expect(await devices.authenticate('garbage')).toBeNull() // malformed
    expect(await devices.authenticate(`acorn_dt_${id}_${secret}  `)).toBeNull() // trailing whitespace
    expect(await devices.authenticate(`${token}extra`)).toBeNull() // trailing garbage
    expect(await devices.authenticate(`acorn_dt_${crypto.randomUUID()}_${secret}`)).toBeNull() // unknown id
    expect(await devices.authenticate(`acorn_dt_${id}_${'A'.repeat(43)}`)).toBeNull() // wrong secret

    await devices.revoke(device.id)
    expect(await devices.authenticate(token)).toBeNull() // revoked
  })

  it('revokes immediately and permanently', async () => {
    const { token, device } = await devices.issue('laptop')
    expect(await devices.isActive(device.id)).toBe(true)
    expect(await devices.revoke(device.id)).toBe(true)
    expect(await devices.isActive(device.id)).toBe(false)
    expect(await devices.authenticate(token)).toBeNull()
    // The row survives revocation so the device list can show what was revoked and when.
    expect((await devices.list()).find((d) => d.id === device.id)?.revokedAt).toBe(clock)
  })

  it('is idempotent on repeat revoke, and distinguishes unknown from already-revoked', async () => {
    const { device } = await devices.issue('laptop')
    const revokedAt = clock
    expect(await devices.revoke(device.id)).toBe(true)
    clock += 5_000
    expect(await devices.revoke(device.id)).toBe(true) // still true: the device existed
    expect((await devices.list())[0].revokedAt).toBe(revokedAt) // but the timestamp is not overwritten
    expect(await devices.revoke(crypto.randomUUID())).toBe(false) // never existed → the route 404s
  })

  it('notifies listeners so live sockets can close — including on a repeat revoke', async () => {
    const seen: string[] = []
    const off = devices.onRevoked((id) => seen.push(id))
    const { device } = await devices.issue('laptop')
    await devices.revoke(device.id)
    // A reconnect racing the first revoke must still be closed, so a repeat fires again.
    await devices.revoke(device.id)
    expect(seen).toEqual([device.id, device.id])
    off()
    await devices.revoke(device.id)
    expect(seen).toHaveLength(2)
  })

  it('throttles lastSeenAt writes to keep them off the hot path', async () => {
    const { token, device } = await devices.issue('laptop')
    const seenAt = async () => (await devices.list()).find((d) => d.id === device.id)?.lastSeenAt

    await devices.authenticate(token)
    expect(await seenAt()).toBe(clock)

    const first = clock
    clock += 60_000 // inside the 5-minute window
    await devices.authenticate(token)
    expect(await seenAt()).toBe(first)

    clock += 5 * 60_000
    const later = clock
    await devices.authenticate(token)
    expect(await seenAt()).toBe(later)
  })

  // Without the warm cache every authenticated request runs this `SELECT` on the node's single event
  // loop, which on a client holding a live socket makes it the most-executed statement in the process.
  it('answers a warm token from memory, with no read of the devices table', async () => {
    const { token, device } = await devices.issue('laptop')
    expect(await devices.authenticate(token)).toEqual({ deviceId: device.id })

    const select = vi.spyOn(harness.db, 'select')
    expect(await devices.authenticate(token)).toEqual({ deviceId: device.id })
    expect(await devices.authenticate(token)).toEqual({ deviceId: device.id })
    expect(select).not.toHaveBeenCalled()

    // And it is a window, not a memory: past the minute the row is read again.
    clock += 61_000
    expect(await devices.authenticate(token)).toEqual({ deviceId: device.id })
    expect(select).toHaveBeenCalled()
    select.mockRestore()
  })

  // Getting this wrong is a security bug, not a performance one: a revoked bearer that keeps working
  // for the rest of the window is a credential the owner believes they took away.
  it('forgets a warm token the moment its device is revoked', async () => {
    const { token, device } = await devices.issue('laptop')
    expect(await devices.authenticate(token)).toEqual({ deviceId: device.id })

    await devices.revoke(device.id)

    expect(await devices.authenticate(token)).toBeNull()
  })

  it('does not warm an entry for a token that failed', async () => {
    const { token, device } = await devices.issue('laptop')
    const [, , id] = token.split('_')
    const wrongSecret = `acorn_dt_${id}_${'z'.repeat(43)}`

    expect(await devices.authenticate(wrongSecret)).toBeNull()
    const select = vi.spyOn(harness.db, 'select')
    expect(await devices.authenticate(wrongSecret)).toBeNull()
    // Read again rather than answered from a cache, so a wrong secret can never become a warm one.
    expect(select).toHaveBeenCalled()
    select.mockRestore()
    expect(await devices.authenticate(token)).toEqual({ deviceId: device.id })
  })

  describe('a phone', () => {
    const DAY = 24 * 3600_000

    it('is marked in its token’s answer, its listing, and the audit row', async () => {
      const { token, device } = await devices.issue('iPhone', 'phone')
      expect(device.kind).toBe('phone')
      expect(await devices.authenticate(token)).toEqual({ deviceId: device.id, kind: 'phone' })
      expect((await devices.list())[0]).toMatchObject({ id: device.id, kind: 'phone' })
      const [row] = harness.db.select().from(schema.audit).all()
      expect(JSON.parse(row!.details!)).toEqual({ name: 'iPhone', kind: 'phone' })
    })

    it('leaves another device with no kind', async () => {
      const { token, device } = await devices.issue('laptop')
      expect(device).not.toHaveProperty('kind')
      expect(await devices.authenticate(token)).toEqual({ deviceId: device.id })
    })

    it('is revoked, with a reason, once it has gone unused for 30 days', async () => {
      const { token, device } = await devices.issue('iPhone', 'phone')
      await devices.authenticate(token)
      clock += 30 * DAY - 1
      expect(await devices.authenticate(token)).not.toBeNull()
      clock += 30 * DAY + 1
      expect(await devices.authenticate(token)).toBeNull()
      expect(await devices.isActive(device.id)).toBe(false)
      const revoked = harness.db
        .select()
        .from(schema.audit)
        .all()
        .find((row) => row.action === 'device.revoked')
      expect(JSON.parse(revoked!.details!)).toEqual({ reason: 'A phone was unused for 30 days.' })
    })

    it('counts the day it was paired when it has never been used', async () => {
      const { token } = await devices.issue('iPhone', 'phone')
      clock += 31 * DAY
      expect(await devices.authenticate(token)).toBeNull()
    })

    it('keeps a phone in daily use, and does not expire a desktop', async () => {
      const phone = await devices.issue('iPhone', 'phone')
      const laptop = await devices.issue('laptop')
      for (let day = 0; day < 40; day++) {
        clock += DAY
        expect(await devices.authenticate(phone.token)).not.toBeNull()
      }
      clock += 400 * DAY
      expect(await devices.authenticate(laptop.token)).not.toBeNull()
    })
  })

  it('lists devices newest first', async () => {
    const a = await devices.issue('first')
    clock += 1_000
    const b = await devices.issue('second')
    expect((await devices.list()).map((d) => d.id)).toEqual([b.device.id, a.device.id])
  })

  it('issues distinct tokens for distinct devices', async () => {
    const a = await devices.issue('a')
    const b = await devices.issue('b')
    expect(a.token).not.toBe(b.token)
    expect(await devices.authenticate(a.token)).toEqual({ deviceId: a.device.id })
    expect(await devices.authenticate(b.token)).toEqual({ deviceId: b.device.id })
  })
})
