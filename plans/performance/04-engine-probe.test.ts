// Replay: rtk proxy pnpm exec vitest run --config plans/performance/04-probe.config.ts
// Actual terminal engine, with a fake process boundary. No real process, app profile, or database.
import { it, vi } from 'vitest'
import { writeFileSync } from 'node:fs'

const state = vi.hoisted(() => ({ ptys: [] as any[] }))
vi.mock('node-pty', () => ({ spawn: () => {
  const pty = {
    data: new Set<(text: string) => void>(), exits: new Set<(event: unknown) => void>(), kills: 0,
    onData(fn: (text: string) => void) { this.data.add(fn); return { dispose: () => this.data.delete(fn) } },
    onExit(fn: (event: unknown) => void) { this.exits.add(fn); return { dispose: () => this.exits.delete(fn) } },
    write() {}, resize() {}, pause() {}, resume() {}, kill() { this.kills++ },
  }
  state.ptys.push(pty)
  return pty
} }))
vi.mock('@acorn/plugin-api/node', () => ({
  getProfile: () => ({ id: 'shell', label: 'Shell', kind: 'shell', backendPreference: 'node-pty' }),
  interactiveProfile: () => true, resolveCommand: () => '/bin/sh', tmuxAvailable: () => false,
  buildSessionEnv: () => ({}), rendererBaseCheckout: () => undefined,
  taskContext: () => ({ repo: null, pull: null }),
  createLogger: () => ({ warn() {} }), describeError: (error: Error) => ({ message: error.message }),
  invalidateWorktreeStatus() {}, TEARDOWN_TIMEOUT_MS: 120000,
  acornMcp: () => null, launcherSpec: () => ({}), serverName: () => 'fixture', resolveMcpEntry: () => 'fixture',
  childEnv: () => ({}), listProfileDefs: () => [], listProfiles: () => [],
}))
const { registerTerminalChannel, disposeTerminal } = await import('../../plugins/terminal/src/server/terminal')

it('counts roster notifications and engine teardown ownership', async () => {
  vi.useFakeTimers()
  let statuses = 0
  const core = {
    tasks: { load: async (id: string) => ({ id, projectId: null }), resolveCwd: async () => ({ cwd: '/tmp/fixture', isWorktree: false }) },
    projects: {}, proc: {}, git: {},
  }
  const init = () => registerTerminalChannel({} as never, core as never, {
    internalEnv: () => ({}), launchContext: async () => {}, completed() {}, archiveReview: async () => {},
    seedTaskNotes: async () => {}, reconciled: Promise.resolve(), status: () => { statuses++ },
  })
  const { terminal } = init()
  const first = await terminal.create({ taskId: 'task-1', profileId: 'shell' })
  const afterCreate = statuses
  const firstPty = state.ptys[0]
  await terminal.remove(first.id)
  for (const exit of firstPty.exits) exit({ exitCode: 0 })
  const afterRemoveAndExit = statuses
  const removedListeners = { data: firstPty.data.size, exit: firstPty.exits.size }
  await terminal.create({ taskId: 'task-2', profileId: 'shell' })
  const secondPty = state.ptys[1]
  disposeTerminal()
  const afterDispose = { dataListeners: secondPty.data.size, exitListeners: secondPty.exits.size, kills: secondPty.kills, timers: vi.getTimerCount() }
  for (const data of secondPty.data) data('after disposal')
  const lateOutput = { queuedTimers: vi.getTimerCount(), afterFlushTimers: 0 }
  vi.advanceTimersByTime(17)
  lateOutput.afterFlushTimers = vi.getTimerCount()
  const nextBoot = init()
  await nextBoot.terminal.create({ taskId: 'task-3', profileId: 'shell' })
  const beforeOldOutput = statuses
  for (const data of secondPty.data) data('previous boot output')
  const reboot = { newRosterCount: (await nextBoot.terminal.list()).length,
    oldListeners: secondPty.data.size, oldOutputQueuedTimer: vi.getTimerCount() - 1, statusesFromOldOutput: statuses - beforeOldOutput }
  vi.advanceTimersByTime(17)
  disposeTerminal()
  vi.clearAllTimers()
  vi.useRealTimers()
  const results = { afterCreate, afterRemoveAndExit, removedListeners, afterDispose, lateOutput, reboot }
  const tag = process.env.ACORN_TERMINAL_PROBE_TAG ?? 'replay'
  if (!/^[a-z0-9-]+$/.test(tag)) throw new Error('Use an alphanumeric probe tag.')
  writeFileSync(`plans/performance/04-engine-results-${tag}.json`, JSON.stringify(results, null, 2) + '\n')
  console.log(JSON.stringify(results, null, 2))
})
