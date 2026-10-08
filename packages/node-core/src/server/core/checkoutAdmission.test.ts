import { expect, it } from 'vitest'
import { createCheckoutAdmission } from './checkoutAdmission'
import type { TaskService } from './tasks'
import type { ProjectService } from './projectRefs'

const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

function fixture() {
  const tasks = [
    { id: 'first', title: 'First', projectId: 'one', worktreePath: null },
    { id: 'alias', title: 'Alias', projectId: 'two', worktreePath: null },
  ]
  const service = createCheckoutAdmission({
    load: async (id) => tasks.find((task) => task.id === id), active: async () => tasks,
  } as TaskService, {
    byId: async (id) => ({ id, path: '/private/tmp/acorn-shared-checkout' }),
  } as ProjectService)
  const busy = new Set<string>()
  service.registerOwner('agents', async (ids) => ids.filter((id) => busy.has(id)).map((taskId) => ({ taskId, description: 'queued turn' })))
  service.registerOwner('workflows', async () => [])
  return { service, busy }
}

it('excludes writes after an admitted turn, including project aliases', async () => {
  const { service, busy } = fixture()
  await service.admitWork('alias', async () => { busy.add('alias') })
  await expect(service.write('first', async () => 'written')).rejects.toThrow(/alias queued turn/)
  busy.clear()
  expect(await service.write('first', async () => 'written')).toBe('written')
})

it('holds a write before work admission and releases it after failure', async () => {
  const { service, busy } = fixture()
  const held = deferred()
  const entered = deferred()
  const write = service.write('first', async () => { entered.resolve(); await held.promise; throw new Error('Git failed') })
  await entered.promise
  let admitted = false
  const work = service.admitWork('alias', async () => { busy.add('alias'); admitted = true })
  await Promise.resolve()
  expect(admitted).toBe(false)
  held.resolve()
  await expect(write).rejects.toThrow('Git failed')
  await work
  expect(admitted).toBe(true)
  await expect(service.write('first', async () => 'wrong')).rejects.toThrow(/queued turn/)
})

it('fails closed when an owner is unavailable or cannot report activity', async () => {
  const tasks = [{ id: 'first', projectId: 'one', worktreePath: null }]
  const service = createCheckoutAdmission({
    load: async () => tasks[0], active: async () => tasks,
  } as unknown as TaskService, { byId: async () => ({ path: '/private/tmp/acorn-shared-checkout' }) } as unknown as ProjectService)
  service.registerOwner('agents', async () => [])
  await expect(service.write('first', async () => 'wrong')).rejects.toMatchObject({ code: 'checkout_activity_unavailable' })
  service.registerOwner('workflows', async () => { throw new Error('Database closed') })
  await expect(service.write('first', async () => 'wrong')).rejects.toMatchObject({ code: 'checkout_activity_unavailable' })
})

it('includes archived checkout owners while their work is settling', async () => {
  const active = { id: 'active', projectId: 'one', worktreePath: null }
  const archived = { id: 'archived', projectId: 'two', worktreePath: null }
  const tasks = [active, archived]
  const service = createCheckoutAdmission({
    load: async (id: string) => tasks.find((task) => task.id === id), active: async () => [active],
  } as unknown as TaskService, {
    byId: async () => ({ path: '/private/tmp/acorn-shared-checkout' }),
  } as unknown as ProjectService, undefined, async () => tasks as Awaited<ReturnType<TaskService['active']>>)
  service.registerOwner('agents', async (ids) => ids.includes('archived')
    ? [{ taskId: 'archived', description: 'cancelling turn' }] : [])
  service.registerOwner('workflows', async () => [])
  await expect(service.write('active', async () => 'wrong')).rejects.toThrow(/archived cancelling turn/)
  await expect(service.write('archived', async () => 'wrong')).rejects.toMatchObject({ code: 'task_inactive' })
})
