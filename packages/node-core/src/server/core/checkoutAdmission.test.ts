import { expect, it } from 'vitest'
import { createCheckoutAdmission } from './checkoutAdmission'
import type { TaskService } from './tasks'
import type { ProjectService } from './projectRefs'
import { makeTestDb } from '../../testkit/db'
import { schema } from '../db'
import { setupCheckoutActivity, taskScriptEvidence, taskScripts } from '../taskScripts/service'

const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function fixture() {
  const tasks = [
    { id: 'first', title: 'First', projectId: 'one', worktreePath: null },
    { id: 'alias', title: 'Alias', projectId: 'two', worktreePath: null },
  ]
  const service = createCheckoutAdmission(
    {
      load: async (id) => tasks.find((task) => task.id === id),
      active: async () => tasks,
    } as TaskService,
    {
      byId: async (id) => ({ id, path: '/private/tmp/acorn-shared-checkout' }),
    } as ProjectService,
  )
  const busy = new Set<string>()
  service.registerOwner('turns', async (ids) =>
    ids.filter((id) => busy.has(id)).map((taskId) => ({ taskId, description: 'queued turn' })),
  )
  service.registerOwner('runs', async () => [])
  service.registerOwner('setup', async () => [])
  return { service, busy }
}

it('excludes writes after an admitted turn, including project aliases', async () => {
  const { service, busy } = fixture()
  await service.admitWork('alias', async () => {
    busy.add('alias')
  })
  await expect(service.write('first', async () => 'written')).rejects.toThrow(/alias queued turn/)
  busy.clear()
  expect(await service.write('first', async () => 'written')).toBe('written')
})

it('reports activity on every task sharing the checkout without admitting anything', async () => {
  const { service, busy } = fixture()
  busy.add('alias')
  expect(await service.activity('first')).toEqual([{ taskId: 'alias', description: 'queued turn' }])
  busy.clear()
  expect(await service.activity('first')).toEqual([])
})

it('holds a write before work admission and releases it after failure', async () => {
  const { service, busy } = fixture()
  const held = deferred()
  const entered = deferred()
  const write = service.write('first', async () => {
    entered.resolve()
    await held.promise
    throw new Error('Git failed')
  })
  await entered.promise
  let admitted = false
  const work = service.admitWork('alias', async () => {
    busy.add('alias')
    admitted = true
  })
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
  const service = createCheckoutAdmission(
    {
      load: async () => tasks[0],
      active: async () => tasks,
    } as unknown as TaskService,
    { byId: async () => ({ path: '/private/tmp/acorn-shared-checkout' }) } as unknown as ProjectService,
  )
  service.registerOwner('turns', async () => [])
  await expect(service.write('first', async () => 'wrong')).rejects.toMatchObject({
    code: 'checkout_activity_unavailable',
  })
  service.registerOwner('runs', async () => {
    throw new Error('Database closed')
  })
  service.registerOwner('setup', async () => [])
  await expect(service.write('first', async () => 'wrong')).rejects.toMatchObject({
    code: 'checkout_activity_unavailable',
  })
})

it('includes archived checkout owners while their work is settling', async () => {
  const active = { id: 'active', projectId: 'one', worktreePath: null }
  const archived = { id: 'archived', projectId: 'two', worktreePath: null }
  const tasks = [active, archived]
  const service = createCheckoutAdmission(
    {
      load: async (id: string) => tasks.find((task) => task.id === id),
      active: async () => [active],
    } as unknown as TaskService,
    {
      byId: async () => ({ path: '/private/tmp/acorn-shared-checkout' }),
    } as unknown as ProjectService,
    undefined,
    async () => tasks as Awaited<ReturnType<TaskService['active']>>,
  )
  service.registerOwner('turns', async (ids) =>
    ids.includes('archived') ? [{ taskId: 'archived', description: 'cancelling turn' }] : [],
  )
  service.registerOwner('runs', async () => [])
  service.registerOwner('setup', async () => [])
  await expect(service.write('active', async () => 'wrong')).rejects.toThrow(/archived cancelling turn/)
  await expect(service.write('archived', async () => 'wrong')).rejects.toMatchObject({ code: 'task_inactive' })
})

it('blocks setup from admission through process settlement in both orderings', async () => {
  const db = makeTestDb()
  try {
    db.db
      .insert(schema.tasks)
      .values({
        id: 'task',
        title: 'Task',
        projectId: 'project',
        origin: 'local',
        status: 'active',
        createdAt: 1,
        updatedAt: 1,
      })
      .run()
    const task = { id: 'task', projectId: 'project', worktreePath: null }
    const service = createCheckoutAdmission(
      { load: async () => task, active: async () => [task] } as unknown as TaskService,
      { byId: async () => ({ path: '/private/tmp/acorn-setup-checkout' }) } as unknown as ProjectService,
    )
    service.registerOwner('turns', async () => [])
    service.registerOwner('runs', async () => [])
    service.registerOwner('setup', async (ids) => setupCheckoutActivity(db.db, ids))
    const scripts = taskScripts(db.db)
    const first = await service.admitWork('task', async () => scripts.admit('task', 'setup'))
    await expect(service.write('task', async () => 'wrong')).rejects.toThrow(/setup starting/)
    scripts.report(
      { attemptId: first.attemptId!, generation: first.generation },
      { type: 'started', terminalSessionId: 'setup-session' },
    )
    await expect(service.write('task', async () => 'wrong')).rejects.toThrow(/setup running/)
    scripts.report({ attemptId: first.attemptId!, generation: first.generation }, { type: 'exit', exitCode: 0 })
    const entered = deferred(),
      release = deferred()
    const write = service.write('task', async () => {
      entered.resolve()
      await release.promise
      return 'written'
    })
    await entered.promise
    let admitted = false
    const setup = service.admitWork('task', async () => {
      admitted = true
      return scripts.admit('task', 'setup')
    })
    await Promise.resolve()
    expect(admitted).toBe(false)
    release.resolve()
    expect(await write).toBe('written')
    const second = await setup
    expect(admitted).toBe(true)
    await expect(service.write('task', async () => 'wrong')).rejects.toThrow(/setup starting/)
    scripts.report(
      { attemptId: second.attemptId!, generation: second.generation },
      { type: 'failed', reason: 'spawn_failed' },
    )
    expect(await service.write('task', async () => 'released')).toBe('released')
    db.db
      .insert(schema.projects)
      .values({
        id: 'project',
        name: 'Project',
        workspaceId: 'workspace',
        vcs: 'git',
        setupScript: 'echo setup',
        createdAt: 1,
        updatedAt: 1,
      })
      .run()
    db.db.update(schema.tasks).set({ branch: 'task', worktreePath: '/private/tmp/acorn-setup-checkout' }).run()
    scripts.admit('task', 'setup', 'user_skipped')
    const manual = await taskScriptEvidence(db.db, (id, action) => service.admitWork(id, action)).admitManualSetup(
      'task',
    )
    expect(manual.state).toBe('starting')
    await expect(service.write('task', async () => 'wrong')).rejects.toThrow(/setup starting/)
    scripts.report({ attemptId: manual.attemptId!, generation: manual.generation }, { type: 'exit', exitCode: 0 })
    expect(await service.write('task', async () => 'settled')).toBe('settled')
  } finally {
    db.cleanup()
  }
})

it('requires the named readers and refuses checkout movement while queued', async () => {
  const task = { id: 'task', projectId: 'project', worktreePath: null }
  let path = '/private/tmp/acorn-before'
  const service = createCheckoutAdmission(
    { load: async () => task, active: async () => [task] } as unknown as TaskService,
    { byId: async () => ({ path }) } as unknown as ProjectService,
  )
  service.registerOwner('turns', async () => [])
  service.registerOwner('unrelated', async () => [])
  await expect(service.write('task', async () => 'wrong')).rejects.toMatchObject({
    code: 'checkout_activity_unavailable',
  })
  service.registerOwner('runs', async () => [])
  service.registerOwner('setup', async () => [])
  const entered = deferred(),
    release = deferred()
  const first = service.admitWork('task', async () => {
    entered.resolve()
    await release.promise
  })
  await entered.promise
  const write = service.write('task', async () => 'wrong')
  await Promise.resolve()
  path = '/private/tmp/acorn-after'
  release.resolve()
  await first
  await expect(write).rejects.toMatchObject({ code: 'checkout_moved' })
})
