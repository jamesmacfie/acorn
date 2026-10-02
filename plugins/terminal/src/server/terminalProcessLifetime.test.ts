import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import type { IPty } from 'node-pty'
import { makeTestPluginDb } from '@acorn/plugin-api/testkit'
import { terminalSessions } from '../node/schema'

const state = vi.hoisted(() => ({ ptys: [] as IPty[], tmux: false, path: '', dir: '' }))
vi.mock('node-pty', async importOriginal => {
  const actual = await importOriginal<typeof import('node-pty')>()
  return { ...actual, spawn: (...args: Parameters<typeof actual.spawn>) => {
    const pty = actual.spawn(...args)
    state.ptys.push(pty)
    return pty
  } }
})
vi.mock('@acorn/plugin-api/node', () => ({
  getProfile: () => ({ id: 'shell', label: 'Shell', kind: 'shell', backendPreference: state.tmux ? 'tmux' : 'node-pty' }),
  interactiveProfile: () => true, resolveCommand: () => '/bin/cat', tmuxAvailable: () => state.tmux,
  buildSessionEnv: () => ({ PATH: state.path, SHELL: '/bin/sh', LANG: 'en_US.UTF-8' }), rendererBaseCheckout: () => undefined,
  taskContext: () => ({ repo: null, pull: null }), createLogger: () => ({ warn() {} }), describeError: (error: Error) => ({ message: error.message }),
  invalidateWorktreeStatus() {}, TEARDOWN_TIMEOUT_MS: 120000,
  acornMcp: () => null, launcherSpec: () => ({}), serverName: () => 'fixture', resolveMcpEntry: () => 'fixture',
  childEnv: () => ({ PATH: state.path, SHELL: '/bin/sh', LANG: 'en_US.UTF-8' }), listProfileDefs: () => [], listProfiles: () => [],
}))
import { disposeTerminal, registerTerminalChannel } from './terminal'

let databaseCleanup: (() => void) | undefined
let socket: string | undefined
let durableName: string | undefined
const realTmux = (() => { try { return execFileSync('/usr/bin/which', ['tmux'], { encoding: 'utf8' }).trim() } catch { return '' } })()
const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }
const wait = async (predicate: () => boolean) => {
  const deadline = Date.now() + 4000
  while (!predicate() && Date.now() < deadline) await new Promise(yes => setTimeout(yes, 20))
  expect(predicate()).toBe(true)
}
function fixture(tmux: boolean, failInsert = false, realDatabase = false) {
  state.dir = mkdtempSync(join(tmpdir(), 'acorn-terminal-lifetime-'))
  state.tmux = tmux
  state.path = `${state.dir}:/usr/bin:/bin:/opt/homebrew/bin`
  if (tmux) {
    socket = join(state.dir, 'fixture.socket')
    // Every call made by the actual engine selects this fixture's server, including its native PTY
    // attachment. No call lists or kills the user's default server or reads their tmux config.
    const launcher = join(state.dir, 'tmux')
    writeFileSync(launcher, `#!/bin/sh\nexec '${realTmux}' -f /dev/null -S '${socket}' "$@"\n`)
    chmodSync(launcher, 0o700)
  }
  const rows = new Map<string, Record<string, unknown>>()
  const db = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [...rows.values()] }) }) }),
    insert: () => ({ values: async (row: Record<string, unknown>) => { if (failInsert) throw Error('direct insert failed'); rows.set(row.id as string, row) } }),
    update: () => ({ set: (value: Record<string, unknown>) => ({ where: async () => { for (const row of rows.values()) Object.assign(row, value) } }) }),
    delete: () => ({ where: async () => { rows.clear() } }),
  }
  const real = realDatabase ? makeTestPluginDb('terminal') : null
  if (real) { real.db.$client.pragma('query_only = ON'); databaseCleanup = real.cleanup }
  const core = { tasks: { load: async () => ({ id: 'synthetic', projectId: null }), resolveCwd: async () => ({ cwd: state.dir, isWorktree: false }) }, projects: {}, proc: {}, git: {} }
  let rosterEvents = 0
  const { terminal } = registerTerminalChannel((real?.db ?? db) as never, core as never, {
    internalEnv: () => ({}), launchContext: async () => {}, completed() {}, seedTaskNotes: async () => {},
    reconciled: Promise.resolve(), status: () => { rosterEvents++ },
  })
  return { terminal, rows, realRows: () => real?.db.select().from(terminalSessions), events: () => rosterEvents }
}
afterEach(async () => {
  disposeTerminal()
  for (const pty of state.ptys) { if (alive(pty.pid)) { try { pty.kill() } catch {} } }
  if (socket) { try { execFileSync(realTmux, ['-S', socket, 'kill-server'], { stdio: 'ignore' }) } catch {} }
  for (const pty of state.ptys) await wait(() => !alive(pty.pid))
  state.ptys.length = 0
  if (state.dir) rmSync(state.dir, { recursive: true, force: true })
  databaseCleanup?.(); databaseCleanup = undefined
  socket = undefined; durableName = undefined; state.tmux = false
})

it('retires a real ephemeral PTY child on engine disposal', async () => {
  const f = fixture(false)
  await f.terminal.create({ taskId: 'synthetic' })
  const pty = state.ptys[0]!
  expect(alive(pty.pid)).toBe(true)
  disposeTerminal()
  await wait(() => !alive(pty.pid))
  expect(f.events()).toBe(1)
})

it.skipIf(!existsSync(realTmux))('retires the actual tmux attachment while its fixture-owned durable session and row survive', async () => {
  const f = fixture(true)
  const meta = await f.terminal.create({ taskId: 'synthetic' })
  durableName = meta.tmuxSession!
  const pty = state.ptys[0]!
  expect(alive(pty.pid)).toBe(true)
  execFileSync(realTmux, ['-S', socket!, 'has-session', '-t', durableName])
  disposeTerminal()
  await wait(() => !alive(pty.pid))
  execFileSync(realTmux, ['-S', socket!, 'has-session', '-t', durableName])
  expect(f.rows.get(meta.id)).toMatchObject({ status: 'running', tmuxSession: durableName })
  expect(f.events()).toBe(1)
  // afterEach explicitly removes only this fixture server after the durability assertion.
})

it.skipIf(!existsSync(realTmux))('rolls back only the fresh tmux session when direct metadata admission fails', async () => {
  const f = fixture(true, true, true)
  await expect(f.terminal.create({ taskId: 'synthetic' })).rejects.toThrow(/readonly|read-only/)
  expect(await f.realRows()).toEqual([])
  await wait(() => state.ptys.every(pty => !alive(pty.pid)))
  expect(f.rows.size).toBe(0)
  expect(await f.terminal.list()).toEqual([])
  expect(f.events()).toBe(0)
  // The fixture socket has no surviving session. A failing list on this owned server is absence.
  let listed = ''
  try { listed = execFileSync(realTmux, ['-S', socket!, 'list-sessions', '-F', '#{session_name}'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) } catch {}
  expect(listed.trim()).toBe('')
})
