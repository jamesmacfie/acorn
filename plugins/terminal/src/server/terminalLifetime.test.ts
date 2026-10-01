import { afterEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  ptys: [] as Array<{ data: Set<(s: string) => void>; exits: Set<(e: { exitCode: number }) => void>; kills: number; kill(): void; writes: string[]; throwDispose: boolean }>,
  tmux: false, agent: false, warnThrows: false, aliveTmux: '', failExitRegistration: false, exec: [] as string[][],
}))
vi.mock('node-pty', () => ({ spawn: () => {
  const pty = {
    data: new Set<(s: string) => void>(), exits: new Set<(e: { exitCode: number }) => void>(), kills: 0, writes: [] as string[], throwDispose: false,
    onData(fn: (s: string) => void) { this.data.add(fn); return { dispose: () => { this.data.delete(fn); if (this.throwDispose) throw Error('disposer failed') } } },
    onExit(fn: (e: { exitCode: number }) => void) { if (state.failExitRegistration) throw Error('exit registration failed'); this.exits.add(fn); return { dispose: () => { this.exits.delete(fn) } } },
    kill() { this.kills++ }, write(s: string) { this.writes.push(s) }, resize() {}, pause() {}, resume() {},
  }
  state.ptys.push(pty)
  return pty
} }))
vi.mock('node:child_process', () => ({ execFileSync: (_file: string, args: string[]) => { state.exec.push(args); return args[0] === 'list-sessions' ? state.aliveTmux : '' } }))
vi.mock('@acorn/plugin-api/node', () => ({
  getProfile: () => ({ id: 'shell', label: 'Shell', kind: state.agent ? 'agent' : 'shell', backendPreference: state.tmux ? 'tmux' : 'node-pty' }),
  interactiveProfile: () => true, resolveCommand: () => '/bin/sh', tmuxAvailable: () => state.tmux,
  buildSessionEnv: () => ({}), rendererBaseCheckout: () => undefined,
  taskContext: () => ({ repo: null, pull: null }),
  createLogger: () => ({ warn() { if (state.warnThrows) throw Error('logger failed') } }), describeError: (error: Error) => ({ message: error.message }),
  invalidateWorktreeStatus() {}, TEARDOWN_TIMEOUT_MS: 100,
  acornMcp: () => null, launcherSpec: () => ({}), serverName: () => 'fixture', resolveMcpEntry: () => 'fixture',
  childEnv: () => ({}), listProfileDefs: () => [], listProfiles: () => [],
}))
import { disposeTerminal, registerTerminalChannel, terminalRunGlue, sendToAgent, reconcileTmux } from './terminal'

const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes }); return { promise, resolve } }
function fixture(options: { load?: () => Promise<unknown>; resolveCwd?: () => Promise<unknown>; project?: () => Promise<unknown>; insert?: () => Promise<void>; remove?: () => Promise<void>; root?: () => Promise<string>; archive?: () => Promise<void>; status?: () => void } = {}) {
  const rows = new Map<string, Record<string, unknown>>()
  const mutations: string[] = []
  let rosterEvents = 0
  const db = {
    select: () => ({ from: () => Object.assign(Promise.resolve([...rows.values()]), { where: () => ({ limit: async () => [...rows.values()] }) }) }),
    insert: () => ({ values: async (row: Record<string, unknown>) => { await options.insert?.(); rows.set(row.id as string, { ...row }); mutations.push('insert') } }),
    update: () => ({ set: (value: Record<string, unknown>) => ({ where: async () => { for (const row of rows.values()) Object.assign(row, value); mutations.push('update') } }) }),
    delete: () => ({ where: async () => { mutations.push('delete'); await options.remove?.(); rows.clear() } }),
  }
  const core = {
    tasks: { load: options.load ?? (async () => ({ id: 'task', projectId: options.project ? 'project' : null })), resolveCwd: options.resolveCwd ?? (async () => ({ cwd: '/tmp/fixture', isWorktree: false })), root: options.root ?? (async () => '/tmp/fixture') },
    projects: { byId: options.project ?? (async () => null), setup: async () => ({ trigger: 'off' }) }, proc: {},
    git: { gitText: vi.fn(async () => 'synthetic diff') },
  }
  const streams = vi.fn()
  const reg = registerTerminalChannel(db as never, core as never, {
    internalEnv: () => ({}), launchContext: async () => {}, completed() {}, archiveReview: options.archive ?? (async () => {}),
    seedTaskNotes: async () => {}, reconciled: Promise.resolve(), streams, status: () => { rosterEvents++; options.status?.() },
  })
  return { ...reg, db, core, rows, mutations, events: () => rosterEvents, streams: streams.mock.calls[0][0] }
}
afterEach(() => { disposeTerminal(); vi.useRealTimers(); state.ptys.length = 0; state.exec.length = 0; state.tmux = false; state.agent = false; state.aliveTmux = ''; state.warnThrows = false; state.failExitRegistration = false })

it('publishes structure once, retires both reader sinks, and drains callbacks and output timers', async () => {
  vi.useFakeTimers()
  const f = fixture()
  const session = await f.terminal.create({ taskId: 'task' })
  const pty = state.ptys[0]!
  const first = vi.fn(), second = vi.fn()
  f.streams.attach(session.id, first); f.streams.attach(session.id, second)
  for (const data of pty.data) data('queued')
  expect(vi.getTimerCount()).toBe(2)
  pty.throwDispose = true
  state.warnThrows = true
  expect(await f.terminal.remove(session.id)).toBe(true)
  expect(f.events()).toBe(2)
  expect(await f.terminal.list()).toEqual([])
  expect(await f.terminal.remove('unknown')).toBe(false)
  expect(f.events()).toBe(2)
  expect(pty.data.size + pty.exits.size).toBe(0)
  expect(pty.kills).toBe(1)
  vi.advanceTimersByTime(20)
  expect(first.mock.calls).toHaveLength(1)
  expect(second.mock.calls).toHaveLength(1)
  expect(vi.getTimerCount()).toBe(1)
})

it('notifies the changed memory roster even when durable removal fails, and batches task drops', async () => {
  state.tmux = true
  const f = fixture({ remove: async () => { throw Error('disk unavailable') } })
  const a = await f.terminal.create({ taskId: 'task' })
  await expect(f.terminal.remove(a.id)).rejects.toThrow('disk unavailable')
  expect(f.events()).toBe(2)
  expect(await f.terminal.list()).toEqual([])
  await f.terminal.create({ taskId: 'task' }); await f.terminal.create({ taskId: 'task' })
  await expect(f.taskSessions.dropTaskSessions('task')).rejects.toThrow('disk unavailable')
  expect(await f.terminal.list()).toEqual([])
  expect(f.events()).toBe(5)
  expect(f.mutations.filter(x => x === 'delete')).toHaveLength(3)
})

it('ordinary shutdown closes a tmux attachment without destroying its session or durable metadata', async () => {
  state.tmux = true
  const f = fixture()
  await f.terminal.create({ taskId: 'task' })
  const pty = state.ptys[0]!
  const staleData = [...pty.data], staleExit = [...pty.exits]
  disposeTerminal()
  expect(pty.kills).toBe(1)
  expect(pty.data.size + pty.exits.size).toBe(0)
  expect(state.exec.some(args => args[0] === 'kill-session')).toBe(false)
  expect(f.rows.size).toBe(1)
  const next = fixture()
  for (const data of staleData) data('late')
  for (const exit of staleExit) exit({ exitCode: 0 })
  expect(next.events()).toBe(0)
  expect(await next.terminal.list()).toEqual([])
  expect(f.mutations).toEqual(['insert'])
})

it.each(['load', 'resolveCwd', 'project'] as const)('rejects a retired create held at %s before process admission', async phase => {
  const hold = deferred<unknown>()
  const f = fixture({ [phase]: () => hold.promise })
  const pending = f.terminal.create({ taskId: 'task' }).catch(error => error.message)
  for (let i = 0; i < 8; i++) await Promise.resolve()
  disposeTerminal(); const next = fixture()
  hold.resolve(phase === 'load' ? { id: 'task', projectId: null } : phase === 'resolveCwd' ? { cwd: '/tmp', isWorktree: false } : null)
  expect(await pending).toContain('disposed')
  expect(state.ptys).toHaveLength(0)
  expect(next.events()).toBe(0)
})

it('captures the insert database and preserves an early tmux exit across held durable admission', async () => {
  state.tmux = true
  const held = deferred<void>()
  const f = fixture({ insert: () => held.promise })
  const pending = f.terminal.create({ taskId: 'task' })
  for (let i = 0; i < 8; i++) await Promise.resolve()
  const pty = state.ptys[0]!
  for (const exit of [...pty.exits]) exit({ exitCode: 7 })
  expect(f.mutations).toEqual([])
  held.resolve()
  const meta = await pending
  expect(meta.status).toBe('exited')
  expect(f.mutations).toEqual(['insert', 'update'])
  expect([...f.rows.values()][0]).toMatchObject({ status: 'exited', exitCode: 7 })
  expect(f.events()).toBe(1)
})

it('retires a tmux attachment admitted before held insert, without wiring into a replacement boot', async () => {
  state.tmux = true
  const held = deferred<void>()
  const f = fixture({ insert: () => held.promise })
  const pending = f.terminal.create({ taskId: 'task' }).catch(error => error.message)
  for (let i = 0; i < 8; i++) await Promise.resolve()
  const pty = state.ptys[0]!
  disposeTerminal(); const next = fixture()
  held.resolve()
  expect(await pending).toContain('disposed')
  expect(pty.kills).toBe(1)
  expect(pty.data.size + pty.exits.size).toBe(0)
  expect(next.mutations).toEqual([])
  expect(next.events()).toBe(0)
  expect(f.rows.size).toBe(1)
})

it.each(['remove', 'dispose', 'deadline'] as const)('settles teardown and clears its deadline on %s without an exit event', async reason => {
  vi.useFakeTimers()
  const f = fixture()
  const pending = f.taskSessions.runTeardown('synthetic', '/tmp', {}, 'task')
  for (let i = 0; i < 12; i++) await Promise.resolve()
  const rows = await f.terminal.list()
  expect(rows).toHaveLength(1)
  if (reason === 'remove') await f.terminal.remove(rows[0]!.id)
  if (reason === 'dispose') disposeTerminal()
  if (reason === 'deadline') vi.advanceTimersByTime(100)
  expect(await pending).toEqual({ exitCode: null, output: '' })
  expect(state.ptys[0]!.kills).toBe(1)
  expect(state.ptys[0]!.exits.size).toBe(0)
  disposeTerminal()
  expect(vi.getTimerCount()).toBe(0)
})

it('does not invoke replacement archive services after an old root read resolves', async () => {
  const hold = deferred<string>(), oldArchive = vi.fn(async () => {}), nextArchive = vi.fn(async () => {})
  const f = fixture({ root: () => hold.promise, archive: oldArchive })
  const pending = f.taskSessions.captureArchiveReviewInput!('task').catch(error => error.message)
  disposeTerminal(); const next = fixture({ archive: nextArchive })
  hold.resolve('/tmp/fixture')
  expect(await pending).toContain('disposed')
  expect(next.core.git.gitText).not.toHaveBeenCalled()
  expect(oldArchive).not.toHaveBeenCalled(); expect(nextArchive).not.toHaveBeenCalled()
  const oldGlue = terminalRunGlue()
  disposeTerminal(); fixture()
  expect(oldGlue.isRunning('unknown')).toBe(false)
  expect(() => oldGlue.killSession('unknown')).toThrow('disposed')
})

it('keeps held admission invisible to both roster readers and stream ownership, and rolls back a failed insert', async () => {
  state.tmux = true
  const held = deferred<void>()
  const f = fixture({ insert: async () => { await held.promise; throw Error('insert failed') } })
  const pending = f.terminal.create({ taskId: 'task' }).catch(error => error.message)
  for (let i = 0; i < 8; i++) await Promise.resolve()
  expect(await f.terminal.list()).toEqual([])
  expect(await f.terminal.list()).toEqual([])
  expect(f.taskSessions.runningCount('task')).toBe(0)
  expect(f.events()).toBe(0)
  held.resolve()
  expect(await pending).toBe('insert failed')
  expect(await f.terminal.list()).toEqual([])
  expect(f.events()).toBe(0)
  expect(state.ptys[0]!.kills).toBe(1)
  expect(state.ptys[0]!.data.size + state.ptys[0]!.exits.size).toBe(0)
})

it('removes a late run-service attachment from a still-live engine roster and cannot reattach it', async () => {
  const f = fixture()
  const glue = terminalRunGlue()
  const id = await glue.startSession('task', { id: 'dev', command: 'synthetic' }, '/tmp/fixture')
  expect(glue.isRunning(id)).toBe(true)
  glue.retireSession(id)
  expect(await f.terminal.list()).toEqual([])
  expect(glue.isRunning(id)).toBe(false)
  expect(f.taskSessions.runningCount('task')).toBe(0)
  const sink = vi.fn()
  f.streams.attach(id, sink)
  expect(sink).not.toHaveBeenCalled()
  expect(state.ptys[0]!.kills).toBe(1)
})

it('keeps timed-out teardown history honestly exited and restores its output without a live producer', async () => {
  vi.useFakeTimers()
  const f = fixture()
  const pending = f.taskSessions.runTeardown('synthetic', '/tmp', {}, 'task')
  for (let i = 0; i < 12; i++) await Promise.resolve()
  const pty = state.ptys[0]!
  for (const data of pty.data) data('timeout history')
  vi.advanceTimersByTime(100)
  expect(await pending).toEqual({ exitCode: null, output: 'timeout history' })
  const rows = await f.terminal.list()
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ status: 'exited', exitCode: null })
  expect(f.taskSessions.runningCount('task')).toBe(0)
  expect(pty.data.size + pty.exits.size).toBe(0)
  vi.useRealTimers()
  const sink = vi.fn()
  f.streams.attach(rows[0]!.id, sink)
  for (let i = 0; i < 20 && sink.mock.calls.length < 2; i++) await new Promise(yes => setTimeout(yes, 5))
  expect(sink.mock.calls[0][0]).toMatchObject({ type: 'ready', session: { status: 'exited' }, replayed: true })
  expect(await f.terminal.interrupt(rows[0]!.id)).toBe(false)
})

it('preserves fresh tmux work when a rejected metadata operation actually committed its row', async () => {
  state.tmux = true
  const f = fixture()
  // A post-commit rejection is deliberately injected at the database seam.
  // The engine must inspect the captured row rather than infer absence from rejection.
  const db = { insert: () => ({ values: async (row: Record<string, unknown>) => { f.rows.set(row.id as string, row); throw Error('after commit') } }),
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [...f.rows.values()] }) }) }) }
  disposeTerminal()
  const core = { tasks: { load: async () => ({ id: 'task', projectId: null }), resolveCwd: async () => ({ cwd: '/tmp', isWorktree: false }) }, projects: {}, proc: {}, git: {} }
  const reg = registerTerminalChannel(db as never, core as never, { internalEnv: () => ({}), launchContext: async () => {}, completed() {}, archiveReview: async () => {}, seedTaskNotes: async () => {}, reconciled: Promise.resolve() })
  await expect(reg.terminal.create({ taskId: 'task' })).rejects.toThrow('after commit')
  expect(f.rows.size).toBe(1)
  expect(state.exec.some(args => args[0] === 'kill-session')).toBe(false)
  expect(state.ptys[0]!.kills).toBe(1)
})

it('clears the engine-owned delayed submit timer and refuses a stale write after disposal', async () => {
  vi.useFakeTimers()
  const f = fixture()
  const session = await f.terminal.create({ taskId: 'task' })
  const pty = state.ptys[0]!
  sendToAgent(session.id, 'synthetic', 'now')
  expect(vi.getTimerCount()).toBe(2)
  disposeTerminal()
  expect(vi.getTimerCount()).toBe(0)
  vi.advanceTimersByTime(200)
  expect(pty.writes.filter(s => s === '\r')).toHaveLength(0)
})

it('does not announce private agent activity or admit sends while a durable insert is held', async () => {
  vi.useFakeTimers(); state.tmux = true; state.agent = true
  const hold = deferred<void>()
  const f = fixture({ insert: () => hold.promise })
  const pending = f.terminal.create({ taskId: 'task' })
  for (let i = 0; i < 12; i++) await Promise.resolve()
  const args = state.exec.find(args => args[0] === 'new-session')!
  const id = args[args.indexOf('-s') + 1]!.slice('acorn-'.length)
  sendToAgent(id, 'private', 'now')
  vi.advanceTimersByTime(12000)
  expect(f.events()).toBe(0)
  expect(state.ptys[0]!.writes).toEqual([])
  expect(f.streams.streamTaskId(id)).toBeNull()
  expect(f.terminal.taskIdFor(id)).toBeNull()
  expect(await f.terminal.list()).toEqual([])
  hold.resolve(); await pending
  expect(f.events()).toBe(1)
})

it('rolls back callback registration failure without retaining an attachment or half-admitted row', async () => {
  state.failExitRegistration = true
  const f = fixture()
  await expect(f.terminal.create({ taskId: 'task' })).rejects.toThrow('exit registration failed')
  expect(state.ptys[0]!.data.size + state.ptys[0]!.exits.size).toBe(0)
  expect(state.ptys[0]!.kills).toBe(1)
  expect(await f.terminal.list()).toEqual([])
  expect(f.events()).toBe(0)
})

it('delivers the normal engine submit after 150 milliseconds through its stable session facade', async () => {
  vi.useFakeTimers()
  const f = fixture()
  const session = await f.terminal.create({ taskId: 'task' })
  sendToAgent(session.id, 'synthetic', 'now')
  expect(state.ptys[0]!.writes).toHaveLength(1)
  vi.advanceTimersByTime(149)
  expect(state.ptys[0]!.writes).toHaveLength(1)
  vi.advanceTimersByTime(1)
  expect(state.ptys[0]!.writes.at(-1)).toBe('\r')
  expect(vi.getTimerCount()).toBe(1)
})

it('retires a failed reconciliation attachment without deleting its preexisting tmux metadata or session', async () => {
  state.tmux = true
  const f = fixture()
  const meta = await f.terminal.create({ taskId: 'task' })
  disposeTerminal()
  state.aliveTmux = meta.tmuxSession!
  state.failExitRegistration = true
  const next = registerTerminalChannel(f.db as never, f.core as never, { internalEnv: () => ({}), launchContext: async () => {}, completed() {}, archiveReview: async () => {}, seedTaskNotes: async () => {}, reconciled: Promise.resolve() })
  await reconcileTmux()
  expect(state.ptys).toHaveLength(2)
  expect(state.ptys[1]!.kills).toBe(1)
  expect(state.ptys[1]!.data.size + state.ptys[1]!.exits.size).toBe(0)
  expect(await next.terminal.list()).toEqual([])
  expect(f.rows.size).toBe(1)
  expect(state.exec.some(args => args[0] === 'kill-session')).toBe(false)
})
