import { expect, it, vi } from 'vitest'
import { RuntimeService, type RuntimeDeps } from './runtime'

const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}
function fixture(overrides: Partial<RuntimeDeps> = {}) {
  const live = new Set<string>()
  const listeners = new Set<(id: string, code: number | null) => void>()
  const changes: boolean[] = []
  let created = 0
  const deps: RuntimeDeps = {
    loadTargets: vi.fn(async () => ({ targets: [{ id: 'dev', command: 'fixture' }], cwd: '/tmp/fixture', repoTargetIds: ['dev'] })),
    authorizeRepoConfig: vi.fn(async () => {}),
    startSession: vi.fn(async () => { const id = `s${++created}`; live.add(id); return id }),
    isRunning: id => live.has(id), exitCode: () => 0,
    onExit: fn => { listeners.add(fn); return () => { listeners.delete(fn) } },
    killSession: vi.fn(id => { live.delete(id); for (const fn of listeners) fn(id, 0) }),
    retireSession: vi.fn(id => { live.delete(id) }),
    runScript: vi.fn(async () => ({ ok: true })),
    onChange: (_task, _target, running) => { changes.push(running) },
    ...overrides,
  }
  return { svc: new RuntimeService(deps), deps, live, changes, listeners }
}

it('joins adjacent starts before config, orders stop and later start, and keeps other keys concurrent', async () => {
  const held = deferred<Awaited<ReturnType<RuntimeDeps['loadTargets']>>>()
  const f = fixture({ loadTargets: vi.fn(task => task === 'held' ? held.promise : Promise.resolve({ targets: [{ id: 'dev', command: 'fixture' }], cwd: '/tmp', repoTargetIds: [] })) })
  const start = f.svc.start('held', 'dev')
  const joined = f.svc.start('held', 'dev')
  expect(joined).toBe(start)
  const stop = f.svc.stop('held', 'dev')
  const later = f.svc.start('held', 'dev')
  expect(later).not.toBe(start)
  expect((await f.svc.start('other', 'dev')).ok).toBe(true)
  held.resolve({ targets: [{ id: 'dev', command: 'fixture' }], cwd: '/tmp', repoTargetIds: ['dev'] })
  const [a, b, stopped, c] = await Promise.all([start, joined, stop, later])
  expect(a.sessionId).toBe(b.sessionId)
  expect(stopped.ok).toBe(true)
  expect(c.sessionId).not.toBe(a.sessionId)
  expect(f.live.size).toBe(2)
  expect(f.deps.startSession).toHaveBeenCalledTimes(3)
  expect(f.deps.authorizeRepoConfig).toHaveBeenCalledTimes(2)
  expect(f.changes).toEqual([true, true, false, true])
  f.svc.dispose()
})

it('releases vetoes, thrown authorization, and spawn failures so retry can start', async () => {
  const f = fixture()
  vi.mocked(f.deps.authorizeRepoConfig).mockRejectedValueOnce(Error('trust unavailable'))
  await expect(f.svc.start('t', 'dev')).rejects.toThrow('trust unavailable')
  f.deps.hooks = { run: vi.fn(async (_id, payload) => ({ ok: false, by: 'guard', reason: 'blocked', payload })) }
  expect((await f.svc.start('t', 'dev')).reason).toBe('guard: blocked')
  f.deps.hooks = undefined
  vi.mocked(f.deps.startSession).mockRejectedValueOnce(Error('spawn unavailable'))
  await expect(f.svc.start('t', 'dev')).rejects.toThrow('spawn unavailable')
  expect((await f.svc.start('t', 'dev')).ok).toBe(true)
  expect((f.svc as unknown as { operations: Map<string, unknown> }).operations.size).toBe(0)
  f.svc.dispose()
})

it('does not restart after an explicit stop failure and permits an absent cold start', async () => {
  const f = fixture({ loadTargets: async () => ({ targets: [{ id: 'dev', command: 'fixture', stop: 'stop' }], cwd: '/tmp', repoTargetIds: [] }), runScript: async () => ({ ok: false, reason: 'stop failed' }) })
  await f.svc.start('t', 'dev')
  expect(await f.svc.restart('t', 'dev')).toEqual({ ok: false, reason: 'stop failed' })
  expect(f.deps.startSession).toHaveBeenCalledTimes(1)
  expect(f.live.size).toBe(1)
  expect((await f.svc.restart('absent', 'dev')).ok).toBe(true)
  f.svc.dispose()
})

it.each(['config', 'trust', 'hook', 'spawn'] as const)('retires disposal during held %s and skips queued work', async phase => {
  const hold = deferred<void>()
  const f = fixture()
  if (phase === 'config') f.deps.loadTargets = async () => { await hold.promise; return { targets: [{ id: 'dev', command: 'fixture' }], cwd: '/tmp', repoTargetIds: ['dev'] } }
  if (phase === 'trust') f.deps.authorizeRepoConfig = async () => { await hold.promise }
  if (phase === 'hook') f.deps.hooks = { run: async (_id, payload) => { await hold.promise; return { ok: true, payload } } }
  if (phase === 'spawn') f.deps.startSession = vi.fn(async () => { await hold.promise; f.live.add('late'); return 'late' })
  const start = f.svc.start('t', 'dev')
  const stopped = f.svc.stop('t', 'dev')
  const observed = start.catch(() => ({ ok: false }))
  for (let i = 0; i < 12; i++) await Promise.resolve()
  f.svc.dispose()
  hold.resolve()
  expect((await observed).ok).toBe(false)
  expect((await stopped).ok).toBe(false)
  expect(f.changes).toEqual([])
  expect(f.live.size).toBe(0)
  expect(f.deps.killSession).not.toHaveBeenCalled()
  expect(f.deps.retireSession).toHaveBeenCalledTimes(phase === 'spawn' ? 1 : 0)
  expect(f.listeners.size).toBe(0)
})

it('does not publish a live instance after natural exit during held spawn', async () => {
  const f = fixture({ startSession: async () => 'already-exited' })
  expect((await f.svc.start('t', 'dev')).ok).toBe(true)
  expect(await f.svc.status('t', 'dev')).toEqual({ running: false, exitCode: 0 })
  expect(f.changes).toEqual([])
  expect(await f.svc.stop('t', 'dev')).toEqual({ ok: false, reason: 'Not running.' })
  f.svc.dispose()
})

it('clears operation and instance ownership when the exit unsubscriber throws', async () => {
  const f = fixture({ onExit: () => () => { throw Error('unsubscribe failed') } })
  await f.svc.start('t', 'dev')
  expect(() => f.svc.dispose()).toThrow('unsubscribe failed')
  expect(await f.svc.start('t', 'dev')).toEqual({ ok: false, reason: 'Run target service disposed.' })
  expect((f.svc as unknown as { instances: Map<string, unknown> }).instances.size).toBe(0)
  expect((f.svc as unknown as { operations: Map<string, unknown> }).operations.size).toBe(0)
})

it('retains an instance when killing its still-live process throws, so retry cannot cold-start another', async () => {
  const f = fixture({ killSession: vi.fn(() => { throw Error('kill failed') }) })
  await f.svc.start('t', 'dev')
  await expect(f.svc.restart('t', 'dev')).rejects.toThrow('kill failed')
  expect((await f.svc.start('t', 'dev')).sessionId).toBe('s1')
  expect(f.deps.startSession).toHaveBeenCalledTimes(1)
  expect(f.live.size).toBe(1)
  expect(f.changes).toEqual([true])
  f.svc.dispose()
})

it.each(['stop', 'restart', 'dispose'] as const)('does not publish an old discovered URL after %s', async action => {
  const hold = deferred<{ ok: boolean; output: string }>()
  const f = fixture({ loadTargets: async () => ({ targets: [{ id: 'dev', command: 'fixture', urlCommand: 'discover' }], cwd: '/tmp', repoTargetIds: [] }), runScript: () => hold.promise })
  await f.svc.start('t', 'dev')
  const status = f.svc.status('t', 'dev'), url = f.svc.defaultUrl('t')
  for (let i = 0; i < 8; i++) await Promise.resolve()
  if (action === 'dispose') f.svc.dispose()
  else await f.svc[action]('t', 'dev')
  hold.resolve({ ok: true, output: 'http://retired.fixture' })
  expect(await url).toBeUndefined()
  expect(await status).toEqual({ running: action === 'restart' })
  f.svc.dispose()
})
