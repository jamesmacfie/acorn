import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { deviceService } from './auth/deviceTokens'
import { AUDIT_RETENTION_MS, auditVocabulary, clearAuditActions, declareAuditAction, pruneAudit, readAudit, recordAudit } from './audit'
import { makeTestDb, type TestDb } from '../testkit/db'
import { schema } from './db'

let test: TestDb

beforeEach(() => {
  test = makeTestDb()
})
afterEach(() => test.cleanup())

// recordAudit is fire-and-forget (a logging failure must never fail a revoke), so a caller cannot
// await it. One microtask turn is enough for the insert it already started.
const settled = () => new Promise((resolve) => setTimeout(resolve, 20))

describe('recordAudit', () => {
  it('stores the actor, the action, the subject and the details', async () => {
    recordAudit(test.db, {
      actor: 'device',
      actorId: 'device-1',
      action: 'plugins.disabled.changed',
      subject: null,
      details: { disabled: 'docker, http' },
    })
    await settled()

    const [row] = await readAudit(test.db)
    expect(row).toMatchObject({
      actor: 'device',
      actorId: 'device-1',
      action: 'plugins.disabled.changed',
      subject: null,
      details: { disabled: 'docker, http' },
    })
    expect(row.at).toBeGreaterThan(0)
  })

  it('never throws into its caller, even against a closed database', async () => {
    test.db.close()
    // Refusing to revoke a stolen device because a logging insert failed would be strictly worse for
    // the owner than a missing row.
    expect(() => recordAudit(test.db, { actor: 'system', action: 'device.revoked', subject: 'd1' })).not.toThrow()
    await settled()
  })
})

describe('readAudit', () => {
  const at = (offset: number) => 1_700_000_000_000 + offset

  const seed = async (count: number) => {
    for (let index = 0; index < count; index += 1) {
      await test.db.insert(schema.audit).values({
        id: `row-${index}`,
        at: at(index),
        actor: 'system',
        actorId: null,
        action: 'device.paired',
        subject: `device-${index}`,
        details: null,
      })
    }
  }

  it('returns the most recent first and pages backwards with the cursor', async () => {
    await seed(5)

    const first = await readAudit(test.db, { limit: 2 })
    expect(first.map((row) => row.subject)).toEqual(['device-4', 'device-3'])

    // A timestamp cursor rather than an offset: rows are only appended and pruned from the far end, so
    // an offset would skip or repeat entries whenever the prune ran under a paging reader.
    const second = await readAudit(test.db, { limit: 2, before: first[first.length - 1].at })
    expect(second.map((row) => row.subject)).toEqual(['device-2', 'device-1'])
  })

  it('shows a row whose details will not parse rather than dropping it', async () => {
    await test.db.insert(schema.audit).values({
      id: 'broken',
      at: at(0),
      actor: 'system',
      actorId: null,
      action: 'backup.created',
      subject: null,
      details: '{not json',
    })

    // The action, the actor and the time are the load-bearing fields; losing the whole entry over a bad
    // blob would lose exactly the evidence someone is looking for.
    const [row] = await readAudit(test.db)
    expect(row.action).toBe('backup.created')
    expect(row.details).toBeNull()
  })
})

describe('pruneAudit', () => {
  it('deletes rows past the 90-day retention and keeps everything newer', async () => {
    const now = Date.now()
    await test.db.insert(schema.audit).values([
      { id: 'old', at: now - AUDIT_RETENTION_MS - 1_000, actor: 'system', actorId: null, action: 'device.paired', subject: 'old', details: null },
      { id: 'fresh', at: now - 1_000, actor: 'system', actorId: null, action: 'device.paired', subject: 'fresh', details: null },
    ])

    await pruneAudit(test.db, now)

    expect((await readAudit(test.db)).map((row) => row.subject)).toEqual(['fresh'])
  })
})

// The producers, driven through the real services rather than by calling recordAudit directly. The
// question is whether the actions security.md names actually reach the table, and a test that called
// recordAudit itself would answer a different one.
describe('what gets recorded', () => {
  it('records a pairing and a revocation, with the revoker as the actor', async () => {
    const devices = deviceService(test.db)
    const { device } = await devices.issue("James's laptop")
    await settled()

    // Pairing has no device actor by definition: whoever holds the code is not yet a device, and the
    // bundled local node pairs with no code at all.
    const [paired] = await readAudit(test.db)
    expect(paired).toMatchObject({ action: 'device.paired', actor: 'system', subject: device.id, details: { name: "James's laptop" } })

    await devices.revoke(device.id, { actor: 'device', actorId: 'other-device' })
    await settled()
    const [revoked] = await readAudit(test.db)
    expect(revoked).toMatchObject({ action: 'device.revoked', actor: 'device', actorId: 'other-device', subject: device.id })
  })

  it('does not record a second row for a repeat revoke', async () => {
    const devices = deviceService(test.db)
    const { device } = await devices.issue('laptop')
    await devices.revoke(device.id)
    await devices.revoke(device.id)
    await settled()

    // The repeat still notifies listeners (a reconnect racing the first revoke has to be closed too),
    // but it is not a second decision anyone made.
    const revocations = (await readAudit(test.db)).filter((row) => row.action === 'device.revoked')
    expect(revocations).toHaveLength(1)
  })
})

// ── The plugin half of the vocabulary (docs/security.md § The vocabulary is closed) ───────────────

describe('plugin-declared audit actions', () => {
  afterEach(() => clearAuditActions('demo'))

  it("qualifies a declared verb, and enumerates it with the plugin's own label", () => {
    declareAuditAction('demo', { id: 'run.finished', label: 'Demo run finished' })
    expect(auditVocabulary()).toEqual([{ action: 'demo:run.finished', pluginId: 'demo', label: 'Demo run finished' }])
  })

  it('writes a declared verb and refuses one nobody declared', async () => {
    declareAuditAction('demo', { id: 'run.finished', label: 'Demo run finished' })
    recordAudit(test.db, { actor: 'system', actorId: 'demo', action: 'demo:run.finished', subject: 'run1' })
    // Same shape, undeclared. Fail closed: no row, and no throw, because recordAudit must never fail
    // the action it describes.
    recordAudit(test.db, { actor: 'system', actorId: 'thief', action: 'thief:anything', subject: 'run1' })
    await settled()
    expect((await readAudit(test.db)).map((row) => row.action)).toEqual(['demo:run.finished'])
  })

  it('takes the declaration back with the plugin, and leaves the rows behind', async () => {
    declareAuditAction('demo', { id: 'run.finished', label: 'Demo run finished' })
    recordAudit(test.db, { actor: 'system', actorId: 'demo', action: 'demo:run.finished', subject: 'run1' })
    await settled()
    clearAuditActions('demo')
    expect(auditVocabulary()).toEqual([])
    // The row is evidence of something that happened; the settings surface draws it as its raw verb.
    expect((await readAudit(test.db)).map((row) => row.action)).toEqual(['demo:run.finished'])
  })
})
