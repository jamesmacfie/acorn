import { describe, expect, it, vi } from 'vitest'
import * as schema from '../../node/schema'
import { clock, useTriggerHarness } from './test/triggerHarness'

describe('the trigger service', () => {
  const t = useTriggerHarness()

  it('retains a deletion tombstone and leaves active workflow work untouched', async () => {
    const trigger = await t.approved()
    await t.service.dispatch(trigger.id, { reason: 'manual', requestKey: 'manual-one' })
    await t.service.remove(trigger.id)
    expect(t.service.get(trigger.id)).toMatchObject({ state: 'deleted' })
    expect(t.database.db.select().from(schema.workflowTriggerOccurrences).get()?.state).toBe('run-started')
    expect(t.database.db.select().from(schema.workflowRuns).get()?.status).toBe('running')
    expect(() =>
      t.service.save({ id: trigger.id, projectId: 'project-1', workflowId: 'workflow-1', when: clock('UTC') }),
    ).toThrow('cannot be reused')
  })

  it('keeps core cadence paused until device approval and lets Run now use a paused approval', async () => {
    let coreRow = {
      key: 'user:trigger',
      owner: 'user' as const,
      name: 'Scheduled review',
      kind: 'workflow',
      cadence: { daily: '09:00' as const },
      enabled: true,
      registered: true,
      nextRunAt: Date.now() + 60_000,
    }
    const scheduler = {
      list: vi.fn(async () => [coreRow]),
      create: vi.fn(async () => coreRow),
      patch: vi.fn(
        async (_key: string, patch: { enabled?: boolean; cadence?: typeof coreRow.cadence; name?: string }) => {
          coreRow = { ...coreRow, ...patch }
          return coreRow
        },
      ),
      runNow: vi.fn(async () => ({})),
      remove: vi.fn(async () => {}),
    }
    const managed = t.serviceFor(t.database.db, () => scheduler)
    const saved = await managed.saveManaged({
      projectId: 'project-1',
      workflowId: 'workflow-1',
      when: clock('Pacific/Auckland'),
      cadence: { daily: '09:00' },
      inputs: { count: 7 },
    })
    expect(saved.state).toBe('draft')
    expect(scheduler.patch).toHaveBeenLastCalledWith(coreRow.key, expect.objectContaining({ enabled: false }))

    await managed.approve(saved.id, 'process-current')
    expect(scheduler.patch).toHaveBeenLastCalledWith(coreRow.key, { enabled: true })
    expect(managed.get(saved.id)?.inputsJson).toBe('{"count":7}')

    expect((await managed.pause(saved.id, true)).state).toBe('paused')
    await managed.runNow(saved.id)
    expect(scheduler.runNow).toHaveBeenCalledWith(coreRow.key)
    coreRow = { ...coreRow, registered: false }
    expect((await managed.view(saved.id)).state).toBe('unavailable')
  })

  it('returns a device read model without approval hashes, epochs, tokens, or occurrence request keys', async () => {
    const trigger = await t.approved()
    await t.service.dispatch(trigger.id, { reason: 'manual', requestKey: 'private-request' })
    const encoded = JSON.stringify(await t.service.view(trigger.id))
    expect(encoded).not.toContain(trigger.epoch)
    expect(encoded).not.toContain(trigger.approvedGraphDigest!)
    expect(encoded).not.toContain('private-request')
    expect(encoded).toContain('"state":"active"')
  })
})
